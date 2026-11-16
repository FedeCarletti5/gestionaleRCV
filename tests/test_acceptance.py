import base64
import io
import json
import tempfile
import unittest
from email.parser import BytesParser
from pathlib import Path

from backend.db import get_connection, init_db
from backend.security import get_totp_code
from backend.server import GestionaleHTTPHandler
from backend.services import restore_and_verify_backup


class DummyServer:
    def __init__(self, db_path: Path, attachments_dir: Path, backups_dir: Path):
        self.db_path = db_path
        self.attachments_dir = attachments_dir
        self.backups_dir = backups_dir


class InMemoryHTTPTransport(GestionaleHTTPHandler):
    """
    Esegue il vero GestionaleHTTPHandler su stream HTTP/1.1 reali in-memory,
    consentendo l'esecuzione completa dei test HTTP anche in ambienti sandbox privi di rete TCP.
    """

    def __init__(self, raw_request: bytes, server_obj: DummyServer):
        self.rfile = io.BytesIO(raw_request)
        self.wfile = io.BytesIO()
        self.server = server_obj
        self.client_address = ("127.0.0.1", 54321)
        self.raw_requestline = self.rfile.readline(65537)
        if self.parse_request():
            mname = "do_" + self.command
            if hasattr(self, mname):
                getattr(self, mname)()


class GestionaleAcceptanceTestSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp_dir = tempfile.TemporaryDirectory()
        base = Path(cls.tmp_dir.name)
        cls.db_path = base / "test_gestionale.sqlite"
        cls.att_dir = base / "attachments"
        cls.bkp_dir = base / "backups"
        cls.att_dir.mkdir(parents=True, exist_ok=True)
        cls.bkp_dir.mkdir(parents=True, exist_ok=True)
        init_db(cls.db_path)
        cls.dummy_server = DummyServer(cls.db_path, cls.att_dir, cls.bkp_dir)

    @classmethod
    def tearDownClass(cls):
        cls.tmp_dir.cleanup()

    def _request(self, method: str, path: str, body: dict = None, token: str = None, csrf: str = None):
        headers = {"Host": "127.0.0.1:8080"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if csrf:
            headers["X-CSRF-Token"] = csrf
        payload_bytes = b""
        if body is not None:
            headers["Content-Type"] = "application/json"
            payload_bytes = json.dumps(body).encode("utf-8")
            headers["Content-Length"] = str(len(payload_bytes))

        req_lines = [f"{method} {path} HTTP/1.1"]
        for k, v in headers.items():
            req_lines.append(f"{k}: {v}")
        raw_req = ("\r\n".join(req_lines) + "\r\n\r\n").encode("utf-8") + payload_bytes

        handler = InMemoryHTTPTransport(raw_req, self.dummy_server)
        raw_resp = handler.wfile.getvalue()
        head_part, _, body_part = raw_resp.partition(b"\r\n\r\n")
        head_lines = head_part.split(b"\r\n")
        status_line = head_lines[0].decode("iso-8859-1")
        status_code = int(status_line.split(" ")[1])

        header_bytes = b"\r\n".join(head_lines[1:]) + b"\r\n\r\n"
        parsed_headers = BytesParser().parsebytes(header_bytes)
        resp_headers = {k.lower(): v for k, v in parsed_headers.items()}
        ctype = resp_headers.get("content-type", "")
        data = json.loads(body_part.decode("utf-8")) if "application/json" in ctype and body_part else body_part
        return status_code, data, resp_headers

    def _login_device(self, password: str = "FisioFitness2026!", totp_code: str = None) -> dict:
        status, data, _ = self._request(
            "POST",
            "/api/auth/login",
            {"username": "admin", "password": password, "totp_code": totp_code},
        )
        self.assertEqual(status, 200, f"Login fallito: {data}")
        return data

    def test_01_all_9_acceptance_scenarios_and_extensions(self):
        # ======================================================================
        # SCENARIO 7 (Parte 1): Accesso non autenticato bloccato ovunque
        # ======================================================================
        for protected_url in [
            "/api/people",
            "/api/dashboard",
            "/api/appointments",
            "/api/packages",
            "/attachments/1",
        ]:
            st, data, _ = self._request("GET", protected_url)
            self.assertEqual(st, 401, f"L'URL {protected_url} doveva restituire 401 senza login")

        # Registrazione pubblica disabilitata
        st_reg, _, _ = self._request("POST", "/api/auth/register", {"username": "hacker"})
        self.assertEqual(st_reg, 403)

        # Login Dispositivo 1 (es. Mac) e Dispositivo 2 (es. iPad)
        mac_session = self._login_device()
        ipad_session = self._login_device()
        mac_token = mac_session["token"]
        ipad_token = ipad_session["token"]

        # ======================================================================
        # SCENARIO 1: Una persona, più percorsi (Fisio + Fitness su unica anagrafica)
        # ======================================================================
        st, person, hdrs = self._request(
            "POST",
            "/api/people",
            {
                "first_name": "Giulia",
                "last_name": "Bianchi",
                "birth_date": "1991-06-15",
                "phone": "+39 347 1122334",
                "sport_activity": "Pallavolo",
                "physio_active": True,
                "fitness_active": False,
            },
            token=mac_token,
        )
        self.assertEqual(st, 201)
        self.assertIn("no-store", hdrs.get("cache-control", ""))
        person_id = person["id"]

        # Verifica rilevazione duplicati senza unione automatica
        st_dup, dup_err, _ = self._request(
            "POST",
            "/api/people",
            {
                "first_name": "Giulia",
                "last_name": "Bianchi",
                "birth_date": "1991-06-15",
            },
            token=mac_token,
        )
        self.assertEqual(st_dup, 400)
        self.assertTrue(len(dup_err["details"]["potential_duplicates"]) >= 1)

        # Attivo anche il percorso Fitness sulla stessa persona senza duplicare l'anagrafica
        st_upd, person_upd, _ = self._request(
            "PUT",
            f"/api/people/{person_id}",
            {
                "expected_version": person["version"],
                "physio_active": True,
                "fitness_active": True,
            },
            token=mac_token,
        )
        self.assertEqual(st_upd, 200)
        self.assertEqual(person_upd["id"], person_id)
        self.assertEqual(person_upd["physio_active"], 1)
        self.assertEqual(person_upd["fitness_active"], 1)

        # Verifica che esista 1 sola anagrafica nel database
        _, people_list, _ = self._request("GET", "/api/people?area=entrambi", token=mac_token)
        self.assertEqual(len(people_list["people"]), 1)
        self.assertEqual(people_list["people"][0]["id"], person_id)

        # ======================================================================
        # SCENARIO 2: Prima valutazione + Mappa del dolore 2D salvata su Mac
        # e ritrovata identica riaprendo l'app da un altro dispositivo (iPad)
        # ======================================================================
        st_ep, ep, _ = self._request(
            "POST",
            "/api/physio/episodes",
            {
                "person_id": person_id,
                "title": "Sindrome dolorosa subacromiale spalla DX",
                "chief_complaint": "Dolore in abduzione oltre 90° e gesto di schiacciata",
                "body_region": "Spalla",
                "laterality": "DX",
                "start_date": "2026-11-01",
            },
            token=mac_token,
        )
        self.assertEqual(st_ep, 201)
        ep_id = ep["id"]

        markers_payload = [
            {
                "view_side": "anterior",
                "marker_kind": "point",
                "x_norm": 388.5,
                "y_norm": 235.0,
                "radius_norm": 22.0,
                "anatomical_region": "Spalla Anteriore / Tendine Sovraspinato",
                "laterality": "DX",
                "symptom_type": "Dolore acuto",
                "intensity": 7,
                "notes": "Dolore all'arco doloroso 80°-120°",
                "recorded_date": "2026-11-01",
            },
            {
                "view_side": "posterior",
                "marker_kind": "area",
                "x_norm": 572.0,
                "y_norm": 265.0,
                "radius_norm": 50.0,
                "anatomical_region": "Regione Scapolare / Infraspinato",
                "laterality": "DX",
                "symptom_type": "Rigidità",
                "intensity": 4,
                "notes": "Affaticamento muscolare post-allenamento",
                "recorded_date": "2026-11-01",
            },
        ]

        st_ev1, ev1, _ = self._request(
            "POST",
            "/api/physio/evaluations",
            {
                "episode_id": ep_id,
                "eval_type": "prima_valutazione",
                "eval_date": "2026-11-01",
                "status": "finalizzata",
                "consult_reason": "Dolore spalla DX nella schiacciata",
                "body_map_markers": markers_payload,
            },
            token=mac_token,
        )
        self.assertEqual(st_ev1, 201)
        ev1_id = ev1["id"]

        # Riapertura dall'altro dispositivo (iPad session)
        st_ipad_get, ev1_from_ipad, _ = self._request(
            "GET",
            f"/api/physio/evaluations/{ev1_id}",
            token=ipad_token,
        )
        self.assertEqual(st_ipad_get, 200)
        self.assertEqual(len(ev1_from_ipad["body_map_markers"]), 2)
        self.assertAlmostEqual(ev1_from_ipad["body_map_markers"][0]["x_norm"], 388.5)
        self.assertEqual(ev1_from_ipad["body_map_markers"][0]["laterality"], "DX")
        self.assertEqual(ev1_from_ipad["body_map_markers"][1]["view_side"], "posterior")
        self.assertEqual(ev1_from_ipad["body_map_markers"][1]["intensity"], 4)

        # Verifica che la valutazione finalizzata sia immutabile ma accetti rettifiche datate
        st_imm, _, _ = self._request(
            "PUT",
            f"/api/physio/evaluations/{ev1_id}",
            {"consult_reason": "Tentativo modifica diretta su finalizzata"},
            token=mac_token,
        )
        self.assertEqual(st_imm, 400)

        st_add, addendum, _ = self._request(
            "POST",
            "/api/physio/addenda",
            {
                "evaluation_id": ev1_id,
                "reason": "Integrazione referto ecografico",
                "addendum_text": "Paziente consegna ecografia del 02/11/2026: borsite subacromiale reattiva.",
            },
            token=mac_token,
        )
        self.assertEqual(st_add, 201)

        # Verifica Note SOAP: salvataggio, richiamo nota precedente come bozza con data originaria
        st_n1, n1, _ = self._request(
            "POST",
            "/api/physio/notes",
            {
                "episode_id": ep_id,
                "note_date": "2026-11-05",
                "status": "finalizzata",
                "subjective_response": "Dolore ridotto dopo esercizi isometrici",
                "interventions_performed": "Terapia manuale + isometria extrarotatori",
            },
            token=mac_token,
        )
        self.assertEqual(st_n1, 201)

        st_n2, n2, _ = self._request(
            "POST",
            "/api/physio/notes",
            {
                "episode_id": ep_id,
                "note_date": "2026-11-12",
                "status": "bozza",
                "copied_from_note_id": n1["id"],
            },
            token=mac_token,
        )
        self.assertEqual(st_n2, 201)
        self.assertEqual(n2["copied_from_date"], "2026-11-05")
        self.assertEqual(n2["subjective_response"], "Dolore ridotto dopo esercizi isometrici")

        # Verifica Ponte Limitazioni Condivise e Programmi Fitness con Storico Versioni
        st_lim, lim, _ = self._request(
            "POST",
            "/api/shared-limitations",
            {
                "person_id": person_id,
                "physio_episode_id": ep_id,
                "title": "Evitare Military Press sopra i 90° di flessione",
                "description": "Utilizzare Landmine Press fino a recupero completo controllo scapolare.",
                "laterality": "DX",
                "source_type": "Prima Valutazione Fisioterapica",
                "recorded_date": "2026-11-01",
            },
            token=mac_token,
        )
        self.assertEqual(st_lim, 201)

        st_fp1, fp1, _ = self._request(
            "POST",
            "/api/fitness/programs",
            {
                "person_id": person_id,
                "title": "Programma Forza Pallavolo",
                "goal": "Rinforzo cingolo scapolare e arti inferiori",
                "workouts": [{"day_name": "Giorno 1", "exercises": [{"name": "Landmine Press", "sets": 4, "reps": "8", "load": "20 kg"}]}],
            },
            token=mac_token,
        )
        self.assertEqual(st_fp1, 201)
        self.assertEqual(fp1["version"], 1)

        st_fp2, fp2, _ = self._request(
            "PUT",
            f"/api/fitness/programs/{fp1['id']}",
            {
                "expected_version": 1,
                "change_note": "Aumento carico Landmine Press a 25 kg",
                "workouts": [{"day_name": "Giorno 1", "exercises": [{"name": "Landmine Press", "sets": 4, "reps": "8", "load": "25 kg"}]}],
            },
            token=mac_token,
        )
        self.assertEqual(st_fp2, 200)
        self.assertEqual(fp2["version"], 2)
        self.assertEqual(len(fp2["version_history"]), 2)

        # ======================================================================
        # SCENARIO 3: Rivalutazione conservando la precedente e confrontando
        # misure della stessa versione (con dato mancante != 0)
        # ======================================================================
        st_om1, om1, _ = self._request(
            "POST",
            "/api/physio/outcome-measures",
            {
                "episode_id": ep_id,
                "evaluation_id": ev1_id,
                "scale_code": "PSFS",
                "recorded_date": "2026-11-01",
                "responses": [
                    {"activity": "Schiacciata a pallavolo", "score": 4},
                    {"activity": "Sollevare oggetto su mensola alta", "score": 6},
                    {"activity": "Dormire sul fianco DX", "score": None},
                ],
            },
            token=mac_token,
        )
        self.assertEqual(st_om1, 201)
        self.assertEqual(om1["score_value"], 5.0)
        self.assertEqual(om1["completed_items"], 2)
        self.assertEqual(om1["missing_items"], 1)

        # Registra Rivalutazione (T1)
        st_ev2, ev2, _ = self._request(
            "POST",
            "/api/physio/evaluations",
            {
                "episode_id": ep_id,
                "eval_type": "rivalutazione",
                "eval_date": "2026-11-15",
                "status": "finalizzata",
                "consult_reason": "Rivalutazione a 2 settimane",
                "body_map_markers": [
                    {
                        "view_side": "anterior",
                        "marker_kind": "point",
                        "x_norm": 388.5,
                        "y_norm": 235.0,
                        "radius_norm": 18.0,
                        "anatomical_region": "Spalla Anteriore",
                        "laterality": "DX",
                        "symptom_type": "Dolore sordo/profondo",
                        "intensity": 3,
                        "notes": "Netto miglioramento",
                        "recorded_date": "2026-11-15",
                    }
                ],
            },
            token=mac_token,
        )
        self.assertEqual(st_ev2, 201)

        # Seconda misura PSFS (T1) della stessa versione -> media 8.0
        st_om2, om2, _ = self._request(
            "POST",
            "/api/physio/outcome-measures",
            {
                "episode_id": ep_id,
                "evaluation_id": ev2["id"],
                "scale_code": "PSFS",
                "recorded_date": "2026-11-15",
                "responses": [
                    {"activity": "Schiacciata a pallavolo", "score": 7.5},
                    {"activity": "Sollevare oggetto su mensola alta", "score": 8.5},
                ],
            },
            token=mac_token,
        )
        self.assertEqual(st_om2, 201)
        self.assertEqual(om2["score_value"], 8.0)

        # Verifica che l'episodio conservi entrambe le valutazioni (1a + rivalutazione) e confronti la stessa versione
        _, ep_detail, _ = self._request("GET", f"/api/physio/episodes/{ep_id}", token=mac_token)
        self.assertEqual(len(ep_detail["evaluations"]), 2)
        self.assertEqual(ep_detail["evaluations"][0]["eval_type"], "prima_valutazione")
        self.assertEqual(ep_detail["evaluations"][1]["eval_type"], "rivalutazione")
        psfs_comp = [c for c in ep_detail["outcome_comparisons"] if c["scale_code"] == "PSFS"][0]
        self.assertEqual(psfs_comp["initial_score"], 5.0)
        self.assertEqual(psfs_comp["latest_score"], 8.0)
        self.assertEqual(psfs_comp["numeric_delta"], 3.0)

        # ======================================================================
        # SCENARIO 4: Pacchetto da 10 sedute:
        # 3 svolte -> residuo 7; altre 2 prenotate -> 7 residue, 2 riservate, 5 disponibili
        # ======================================================================
        st_pkg, pkg, _ = self._request(
            "POST",
            "/api/packages",
            {
                "person_id": person_id,
                "service_area": "misto",
                "name": "Pacchetto 10 Sedute Test Accettazione",
                "total_sessions": 10,
                "price_eur": 500.0,
                "initial_payment_eur": 200.0,
            },
            token=mac_token,
        )
        self.assertEqual(st_pkg, 201)
        pkg_id = pkg["id"]

        # Registra 3 sedute svolte
        for day in ["2026-11-02", "2026-11-05", "2026-11-09"]:
            st_a, _, _ = self._request(
                "POST",
                "/api/appointments",
                {
                    "person_id": person_id,
                    "service_area": "fisio",
                    "service_name": "Seduta Fisio",
                    "package_id": pkg_id,
                    "start_at": f"{day}T10:00:00",
                    "duration_minutes": 60,
                    "status": "svolto",
                },
                token=mac_token,
            )
            self.assertEqual(st_a, 201)

        _, pkg_after_3, _ = self._request("GET", f"/api/packages/{pkg_id}", token=mac_token)
        self.assertEqual(pkg_after_3["total_sessions"], 10)
        self.assertEqual(pkg_after_3["consumed_sessions"], 3)
        self.assertEqual(pkg_after_3["remaining_sessions"], 7)

        # Prenota altre 2 sedute
        booked_ids = []
        for day in ["2026-11-18", "2026-11-21"]:
            st_b, b_appt, _ = self._request(
                "POST",
                "/api/appointments",
                {
                    "person_id": person_id,
                    "service_area": "fitness",
                    "service_name": "Seduta PT",
                    "package_id": pkg_id,
                    "start_at": f"{day}T15:00:00",
                    "duration_minutes": 60,
                    "status": "prenotato",
                },
                token=mac_token,
            )
            self.assertEqual(st_b, 201)
            booked_ids.append(b_appt["id"])

        _, pkg_after_2_booked, _ = self._request("GET", f"/api/packages/{pkg_id}", token=mac_token)
        self.assertEqual(pkg_after_2_booked["total_sessions"], 10)
        self.assertEqual(pkg_after_2_booked["consumed_sessions"], 3)
        self.assertEqual(pkg_after_2_booked["remaining_sessions"], 7)
        self.assertEqual(pkg_after_2_booked["reserved_sessions"], 2)
        self.assertEqual(pkg_after_2_booked["available_to_book"], 5)
        self.assertEqual(pkg_after_2_booked["due_cents"], 30000)

        # ======================================================================
        # SCENARIO 5: Spostamento, doppio clic su "svolta" (idempotenza) e storno tracciato
        # ======================================================================
        target_appt_id = booked_ids[0]
        # 5a. Sposta orario dell'appuntamento prenotato -> non consuma sedute
        st_mv, moved_appt, _ = self._request(
            "PUT",
            f"/api/appointments/{target_appt_id}",
            {
                "start_at": "2026-11-19T16:30:00",
                "duration_minutes": 60,
            },
            token=mac_token,
        )
        self.assertEqual(st_mv, 200)
        _, pkg_check_mv, _ = self._request("GET", f"/api/packages/{pkg_id}", token=mac_token)
        self.assertEqual(pkg_check_mv["consumed_sessions"], 3)
        self.assertEqual(pkg_check_mv["remaining_sessions"], 7)
        self.assertEqual(pkg_check_mv["reserved_sessions"], 2)
        self.assertEqual(pkg_check_mv["available_to_book"], 5)

        # 5b. Doppio clic rapido su "svolta" -> produce UN SOLO movimento di consumo!
        idem_key = f"double_click_test_{target_appt_id}"
        st_c1, _, _ = self._request(
            "PUT",
            f"/api/appointments/{target_appt_id}",
            {"status": "svolto", "idempotency_key": idem_key},
            token=mac_token,
        )
        st_c2, c2_resp, _ = self._request(
            "PUT",
            f"/api/appointments/{target_appt_id}",
            {"status": "svolto", "idempotency_key": idem_key},
            token=mac_token,
        )
        self.assertEqual(st_c1, 200)
        self.assertEqual(st_c2, 200)

        _, pkg_after_dbl, _ = self._request("GET", f"/api/packages/{pkg_id}", token=mac_token)
        self.assertEqual(pkg_after_dbl["consumed_sessions"], 4)
        self.assertEqual(pkg_after_dbl["remaining_sessions"], 6)
        self.assertEqual(pkg_after_dbl["reserved_sessions"], 1)
        self.assertEqual(pkg_after_dbl["available_to_book"], 5)

        # 5c. Correzione / annullamento non addebitato di una seduta già segnata come svolta -> genera REVERSAL tracciato
        st_rev, _, _ = self._request(
            "PUT",
            f"/api/appointments/{target_appt_id}",
            {"status": "annullato", "charge_override": "no_charge"},
            token=mac_token,
        )
        self.assertEqual(st_rev, 200)
        _, pkg_after_rev, _ = self._request("GET", f"/api/packages/{pkg_id}", token=mac_token)
        self.assertEqual(pkg_after_rev["consumed_sessions"], 3)
        self.assertEqual(pkg_after_rev["remaining_sessions"], 7)
        self.assertEqual(pkg_after_rev["reserved_sessions"], 1)
        self.assertEqual(pkg_after_rev["available_to_book"], 6)
        self.assertTrue(any(m["movement_type"] == "REVERSAL" for m in pkg_after_rev["movements"]))

        # ======================================================================
        # SCENARIO 6: Modifica contemporanea da due dispositivi (409 Conflict)
        # senza sovrascrittura silenziosa
        # ======================================================================
        _, p_mac, _ = self._request("GET", f"/api/people/{person_id}", token=mac_token)
        _, p_ipad, _ = self._request("GET", f"/api/people/{person_id}", token=ipad_token)
        shared_version = p_mac["person"]["version"]
        self.assertEqual(shared_version, p_ipad["person"]["version"])

        # Il Mac salva per primo (versione passa a shared_version + 1)
        st_mac_save, _, _ = self._request(
            "PUT",
            f"/api/people/{person_id}",
            {
                "expected_version": shared_version,
                "general_notes": "Nota aggiornata dal Mac",
            },
            token=mac_token,
        )
        self.assertEqual(st_mac_save, 200)

        # L'iPad tenta di salvare basandosi sulla versione obsoleta shared_version -> riceve 409 Conflict!
        st_ipad_save, conflict_data, _ = self._request(
            "PUT",
            f"/api/people/{person_id}",
            {
                "expected_version": shared_version,
                "general_notes": "Nota concorrente dall'iPad che non deve sovrascrivere in silenzio",
            },
            token=ipad_token,
        )
        self.assertEqual(st_ipad_save, 409)
        self.assertEqual(conflict_data["code"], "CONFLICT")
        self.assertEqual(conflict_data["server_record"]["general_notes"], "Nota aggiornata dal Mac")

        # ======================================================================
        # SCENARIO 7 (Parte 2) + SCENARIO 8: Allegati privati autenticati +
        # Backup cifrato AES-256 e Ripristino verificato in ambiente di prova
        # ======================================================================
        pdf_bytes = (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
            b"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n"
        )
        st_att, att_rec, _ = self._request(
            "POST",
            "/api/attachments",
            {
                "person_id": person_id,
                "filename": "referto_ecografia_spalla.pdf",
                "mime_type": "application/pdf",
                "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
                "category": "Referto Diagnostico",
            },
            token=mac_token,
        )
        self.assertEqual(st_att, 201)
        att_id = att_rec["id"]

        # Accesso diretto all'URL dell'allegato SENZA autenticazione -> DEVE fallire con 401!
        st_unauth_att, _, _ = self._request("GET", f"/attachments/{att_id}", token=None)
        self.assertEqual(st_unauth_att, 401)

        # Accesso con sessione autenticata -> 200 OK e contenuto identico
        st_auth_att, downloaded_bytes, _ = self._request("GET", f"/attachments/{att_id}", token=mac_token)
        self.assertEqual(st_auth_att, 200)
        self.assertEqual(downloaded_bytes, pdf_bytes)

        # Verifica esportazioni PDF/HTML, JSON strutturato e .ics privacy-safe
        st_pdf, pdf_html, _ = self._request("GET", f"/api/people/{person_id}/export-pdf", token=mac_token)
        self.assertEqual(st_pdf, 200)
        self.assertIn(b"Giulia Bianchi", pdf_html)

        st_ics, ics_bytes, _ = self._request("GET", "/api/appointments/export.ics?privacy=initials_only", token=mac_token)
        self.assertEqual(st_ics, 200)
        self.assertIn(b"G. B.", ics_bytes)
        self.assertNotIn(b"Sindrome dolorosa subacromiale", ics_bytes)

        # Creazione Backup Cifrato AES-256 e Ripristino in ambiente di prova isolato
        st_bkp, bkp_meta, _ = self._request("POST", "/api/security/backups", {}, token=mac_token)
        self.assertEqual(st_bkp, 201)
        self.assertTrue(Path(bkp_meta["encrypted_path"]).exists())

        with tempfile.TemporaryDirectory() as restore_test_dir:
            verify_res = restore_and_verify_backup(
                Path(bkp_meta["encrypted_path"]),
                Path(restore_test_dir),
                expected_hmac=bkp_meta["hmac_sha256"],
            )
            self.assertTrue(verify_res["verified"])
            self.assertEqual(verify_res["sqlite_integrity"], "ok")
            self.assertEqual(verify_res["people_count"], 1)
            self.assertEqual(verify_res["evaluations_count"], 2)
            self.assertEqual(verify_res["packages_count"], 1)
            self.assertEqual(verify_res["attachments_verified"], 1)

        # Verifica 2FA TOTP (attivazione e login con secondo fattore)
        _, sec_ov, _ = self._request("GET", "/api/security/overview", token=mac_token)
        valid_totp = get_totp_code(sec_ov["totp_secret"])
        st_2fa, totp_res, _ = self._request(
            "POST",
            "/api/security/totp",
            {"enable": True, "code": valid_totp},
            token=mac_token,
        )
        self.assertEqual(st_2fa, 200)
        self.assertTrue(totp_res["totp_enabled"])

        # Login senza codice 2FA ora viene bloccato con 401 require_totp
        st_no_totp, err_2fa, _ = self._request(
            "POST",
            "/api/auth/login",
            {"username": "admin", "password": "FisioFitness2026!"},
        )
        self.assertEqual(st_no_totp, 401)
        self.assertTrue(err_2fa.get("require_totp"))

        # Login con codice 2FA valido riesce
        iphone_session = self._login_device(totp_code=get_totp_code(sec_ov["totp_secret"]))
        self.assertTrue(iphone_session["authenticated"])

        # ======================================================================
        # SCENARIO 9: Verifica asset PWA e layout multi-dispositivo (Mac, iPad, iPhone)
        # ======================================================================
        st_sw, sw_raw, _ = self._request("GET", "/sw.js")
        self.assertEqual(st_sw, 200)
        self.assertIn(b"/api/", sw_raw)

        st_css, css_raw, _ = self._request("GET", "/assets/styles.css")
        self.assertEqual(st_css, 200)
        self.assertIn(b"@media (max-width: 1023px)", css_raw)
        self.assertIn(b"@media (max-width: 767px)", css_raw)
        self.assertIn(b".mobile-bottom-nav", css_raw)


if __name__ == "__main__":
    unittest.main()
