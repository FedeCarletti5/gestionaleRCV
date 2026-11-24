import base64
import json
import mimetypes
import re
import secrets
import traceback
from datetime import datetime, timedelta
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from backend.config import (
    FRONTEND_DIR,
    ROME_TZ,
    get_attachments_dir,
    get_backups_dir,
    get_db_path,
    get_env_mode,
)
from backend.db import get_connection, init_db, log_audit, now_rome_iso
from backend.security import (
    build_otpauth_uri,
    generate_recovery_codes,
    generate_totp_secret,
    get_totp_code,
    hash_password,
    hash_token,
    verify_password,
    verify_totp_code,
)
from backend.services import (
    OUTCOME_SCALES_CATALOG,
    ConflictError,
    NotFoundError,
    ValidationError,
    add_clinical_addendum,
    compute_package_summary,
    create_appointment,
    create_encrypted_backup,
    create_package,
    create_person,
    create_physio_episode,
    create_shared_limitation,
    delete_outcome_measure,
    delete_package,
    export_calendar_ics,
    find_potential_duplicates,
    get_dashboard_overview,
    get_evaluation_with_details,
    get_fitness_program_detail,
    get_person_full_dossier,
    get_physio_episode_detail,
    record_fitness_metric,
    record_manual_package_movement,
    record_outcome_measure,
    record_payment,
    record_workout_log,
    render_person_printable_html,
    restore_and_verify_backup,
    row_to_dict,
    rows_to_list,
    save_clinical_evaluation,
    save_clinical_flag,
    save_clinical_note,
    save_consent_record,
    save_fitness_profile,
    save_fitness_program,
    save_person_anamnesis,
    store_private_attachment,
    update_appointment_or_status,
    update_person,
    update_physio_episode,
)

# Rate limit in-memory per IP sui tentativi di login
LOGIN_ATTEMPTS: Dict[str, list] = {}


def check_rate_limit(ip: str, max_attempts: int = 10, window_seconds: int = 300) -> bool:
    now_ts = datetime.now().timestamp()
    history = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now_ts - t < window_seconds]
    LOGIN_ATTEMPTS[ip] = history
    return len(history) < max_attempts


def record_failed_login(ip: str) -> None:
    now_ts = datetime.now().timestamp()
    LOGIN_ATTEMPTS.setdefault(ip, []).append(now_ts)


class GestionaleHTTPHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Evita di scrivere query string o dati clinici nei log di sistema
        pass

    def _get_db_conn(self):
        return get_connection(getattr(self.server, "db_path", None))

    def _get_attachments_dir(self) -> Path:
        return getattr(self.server, "attachments_dir", None) or get_attachments_dir()

    def _get_backups_dir(self) -> Path:
        return getattr(self.server, "backups_dir", None) or get_backups_dir()

    def _send_json(
        self,
        status_code: int,
        data: Any,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, private")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(
        self,
        status_code: int,
        body: bytes,
        content_type: str,
        extra_headers: Optional[Dict[str, str]] = None,
        is_private: bool = True,
    ) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if is_private:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, private")
            self.send_header("Pragma", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=60")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _extract_session_token(self) -> Tuple[Optional[str], bool]:
        """Restituisce (token, from_cookie)."""
        auth_header = self.headers.get("Authorization") or ""
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip(), False
        cookie_hdr = self.headers.get("Cookie")
        if cookie_hdr:
            c = cookies.SimpleCookie()
            c.load(cookie_hdr)
            if "gestionale_session" in c:
                return c["gestionale_session"].value, True
        return None, False

    def _authenticate(self, conn, require_csrf: bool = False) -> Optional[Dict[str, Any]]:
        token, from_cookie = self._extract_session_token()
        if not token:
            return None
        t_hash = hash_token(token)
        now = now_rome_iso()
        row = conn.execute(
            """
            SELECT s.id AS session_id, s.csrf_token, s.expires_at,
                   u.id AS user_id, u.username, u.display_name, u.totp_enabled, u.settings_json
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (t_hash,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < now:
            conn.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        if require_csrf and from_cookie:
            csrf_hdr = self.headers.get("X-CSRF-Token") or ""
            if not csrf_hdr or csrf_hdr != row["csrf_token"]:
                return None

        conn.execute("UPDATE sessions SET last_seen_at = ? WHERE id = ?", (now, row["session_id"]))
        conn.commit()
        return dict(row)

    # ==========================================================================
    # GESTIONE RICHIESTE GET
    # ==========================================================================

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        conn = self._get_db_conn()
        try:
            # 1. Stato autenticazione pubblico
            if path == "/api/auth/status":
                session = self._authenticate(conn, require_csrf=False)
                if not session:
                    self._send_json(
                        200,
                        {
                            "authenticated": False,
                            "env_mode": get_env_mode(),
                            "public_registration_enabled": False,
                        },
                    )
                    return
                self._send_json(
                    200,
                    {
                        "authenticated": True,
                        "env_mode": get_env_mode(),
                        "public_registration_enabled": False,
                        "user": {
                            "id": session["user_id"],
                            "username": session["username"],
                            "display_name": session["display_name"],
                            "totp_enabled": bool(session["totp_enabled"]),
                            "settings": json.loads(session["settings_json"] or "{}"),
                        },
                        "csrf_token": session["csrf_token"],
                    },
                )
                return

            # 2. Protezione rigorosa di tutte le API e degli allegati privati
            if path.startswith("/api/") or path.startswith("/attachments/"):
                session = self._authenticate(conn, require_csrf=False)
                if not session:
                    self._send_json(
                        401,
                        {
                            "error": "Accesso non autorizzato. Effettua il login per consultare dati clinici, anagrafici o allegati.",
                            "code": "UNAUTHORIZED",
                        },
                    )
                    return

                self._handle_authenticated_get(conn, session, path, query)
                return

            # 3. Asset statici della PWA (HTML, CSS, JS, Manifest, Service Worker)
            self._serve_static_asset(path)
        except NotFoundError as e:
            self._send_json(404, {"error": str(e) or "Risorsa non trovata."})
        except ValidationError as e:
            self._send_json(400, {"error": e.message, "details": e.details})
        except Exception as e:
            traceback.print_exc()
            self._send_json(500, {"error": f"Errore interno del server: {str(e)}"})
        finally:
            conn.close()

    def _handle_authenticated_get(
        self,
        conn,
        session: Dict[str, Any],
        path: str,
        query: Dict[str, list],
    ) -> None:
        actor = session["display_name"]

        # Dashboard giornaliera
        if path == "/api/dashboard":
            target_date = query.get("date", [None])[0]
            data = get_dashboard_overview(conn, target_date=target_date)
            self._send_json(200, data)
            return

        # Lista e ricerca persone con filtri Fisio/Fitness/Entrambi e Attivi/Archiviati
        if path == "/api/people":
            q = (query.get("q", [""])[0] or "").strip().lower()
            area = query.get("area", ["tutti"])[0]
            status_filter = query.get("status", ["attivo"])[0]

            sql = "SELECT * FROM people WHERE 1=1"
            params = []
            if status_filter in ("attivo", "archiviato"):
                sql += " AND status = ?"
                params.append(status_filter)
            if area == "fisio":
                sql += " AND physio_active = 1 AND fitness_active = 0"
            elif area == "fitness":
                sql += " AND fitness_active = 1 AND physio_active = 0"
            elif area == "entrambi":
                sql += " AND physio_active = 1 AND fitness_active = 1"
            elif area == "con_fisio":
                sql += " AND physio_active = 1"
            elif area == "con_fitness":
                sql += " AND fitness_active = 1"

            sql += " ORDER BY last_name ASC, first_name ASC"
            people = rows_to_list(conn.execute(sql, params).fetchall())
            bal_rows = conn.execute(
                """
                SELECT pkg.person_id,
                       SUM(MAX(0, pkg.total_sessions - COALESCE(m.consumed, 0))) AS remaining_sessions
                FROM packages pkg
                LEFT JOIN (
                    SELECT package_id, COALESCE(SUM(delta_sessions), 0) AS consumed
                    FROM package_movements
                    GROUP BY package_id
                ) m ON m.package_id = pkg.id
                WHERE pkg.status = 'attivo'
                GROUP BY pkg.person_id
                """
            ).fetchall()
            rem_map = {int(r["person_id"]): int(r["remaining_sessions"] or 0) for r in bal_rows}
            for p in people:
                p["remaining_sessions"] = rem_map.get(int(p["id"]), 0)
            if q:
                people = [
                    p
                    for p in people
                    if q in f"{p['first_name']} {p['last_name']}".lower()
                    or q in f"{p['last_name']} {p['first_name']}".lower()
                    or q in (p["phone"] or "").lower()
                    or q in (p["email"] or "").lower()
                    or q in (p["tax_code"] or "").lower()
                    or q in (p["sport_activity"] or "").lower()
                ]
            self._send_json(200, {"people": people})
            return

        # Controllo possibili duplicati pre-salvataggio
        if path == "/api/people/check-duplicates":
            dups = find_potential_duplicates(
                conn,
                first_name=query.get("first_name", [""])[0],
                last_name=query.get("last_name", [""])[0],
                birth_date=query.get("birth_date", [None])[0],
                phone=query.get("phone", [None])[0],
                email=query.get("email", [None])[0],
                tax_code=query.get("tax_code", [None])[0],
            )
            self._send_json(200, {"potential_duplicates": dups})
            return

        # Scheda completa persona (Riepilogo, Anagrafica, Fisio, Fitness, Appuntamenti, Pacchetti, Documenti, Cronologia)
        m_person = re.match(r"^/api/people/(\d+)$", path)
        if m_person:
            person_id = int(m_person.group(1))
            dossier = get_person_full_dossier(conn, person_id)
            self._send_json(200, dossier)
            return

        # Esportazione JSON strutturato portabile della persona
        m_export_json = re.match(r"^/api/people/(\d+)/export\.json$", path)
        if m_export_json:
            person_id = int(m_export_json.group(1))
            dossier = get_person_full_dossier(conn, person_id)
            log_audit(conn, "EXPORT_PERSON_JSON", "people", person_id, person_id, "Esportati dati persona in JSON strutturato", actor=actor)
            conn.commit()
            body = json.dumps(dossier, ensure_ascii=False, indent=2).encode("utf-8")
            p = dossier["person"]
            fname = f"scheda_{p['last_name']}_{p['first_name']}.json".replace(" ", "_")
            self._send_bytes(
                200,
                body,
                "application/json; charset=utf-8",
                extra_headers={"Content-Disposition": f'attachment; filename="{fname}"'},
                is_private=True,
            )
            return

        # Esportazione HTML/PDF stampabile della scheda personale
        m_export_pdf = re.match(r"^/api/people/(\d+)/export-pdf$", path)
        if m_export_pdf:
            person_id = int(m_export_pdf.group(1))
            dossier = get_person_full_dossier(conn, person_id)
            log_audit(conn, "EXPORT_PERSON_PDF", "people", person_id, person_id, "Generata vista PDF/stampa scheda persona", actor=actor)
            conn.commit()
            html_doc = render_person_printable_html(dossier).encode("utf-8")
            self._send_bytes(200, html_doc, "text/html; charset=utf-8", is_private=True)
            return

        # Dettaglio singolo episodio fisioterapico
        m_ep = re.match(r"^/api/physio/episodes/(\d+)$", path)
        if m_ep:
            ep = get_physio_episode_detail(conn, int(m_ep.group(1)))
            self._send_json(200, ep)
            return

        # Dettaglio singola valutazione clinica
        m_ev = re.match(r"^/api/physio/evaluations/(\d+)$", path)
        if m_ev:
            ev = get_evaluation_with_details(conn, int(m_ev.group(1)))
            self._send_json(200, ev)
            return

        # Catalogo scale di esito e modelli personalizzabili
        if path == "/api/catalogs":
            templates = rows_to_list(conn.execute("SELECT * FROM custom_templates ORDER BY id ASC").fetchall())
            for t in templates:
                t["schema"] = json.loads(t["schema_json"])
            self._send_json(
                200,
                {
                    "outcome_scales": OUTCOME_SCALES_CATALOG,
                    "templates": templates,
                },
            )
            return

        # Agenda appuntamenti
        if path == "/api/appointments":
            start_from = query.get("from", [None])[0]
            end_to = query.get("to", [None])[0]
            area = query.get("area", ["tutti"])[0]
            sql = """
                SELECT a.*, p.first_name, p.last_name, p.phone, p.physio_active, p.fitness_active,
                       pkg.name AS package_name
                FROM appointments a
                JOIN people p ON p.id = a.person_id
                LEFT JOIN packages pkg ON pkg.id = a.package_id
                WHERE 1=1
            """
            params = []
            if start_from:
                sql += " AND substr(a.start_at, 1, 10) >= ?"
                params.append(start_from[:10])
            if end_to:
                sql += " AND substr(a.start_at, 1, 10) <= ?"
                params.append(end_to[:10])
            if area in ("fisio", "fitness"):
                sql += " AND a.service_area = ?"
                params.append(area)
            sql += " ORDER BY a.start_at ASC"
            appts = rows_to_list(conn.execute(sql, params).fetchall())
            self._send_json(200, {"appointments": appts, "timezone": "Europe/Rome"})
            return

        # Esportazione iCalendar (.ics) privacy-safe per Apple Calendar
        if path == "/api/appointments/export.ics":
            mode = query.get("privacy", ["initials_only"])[0]
            ics_text = export_calendar_ics(conn, privacy_mode=mode)
            log_audit(conn, "EXPORT_CALENDAR_ICS", "appointments", None, None, f"Esportato calendario .ics (privacy={mode})", actor=actor)
            conn.commit()
            self._send_bytes(
                200,
                ics_text.encode("utf-8"),
                "text/calendar; charset=utf-8",
                extra_headers={"Content-Disposition": 'attachment; filename="agenda_studio_privacy.ics"'},
                is_private=True,
            )
            return

        # Lista pacchetti e riepilogo amministrativo
        if path == "/api/packages":
            person_id = query.get("person_id", [None])[0]
            sql = """
                SELECT pkg.*, p.first_name, p.last_name
                FROM packages pkg
                JOIN people p ON p.id = pkg.person_id
            """
            params = []
            if person_id:
                sql += " WHERE pkg.person_id = ?"
                params.append(int(person_id))
            sql += " ORDER BY pkg.purchased_date DESC, pkg.id DESC"
            rows = rows_to_list(conn.execute(sql, params).fetchall())
            packages = [compute_package_summary(conn, r) for r in rows]
            self._send_json(200, {"packages": packages})
            return

        # Dettaglio singolo pacchetto
        m_pkg = re.match(r"^/api/packages/(\d+)$", path)
        if m_pkg:
            pkg_row = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (int(m_pkg.group(1)),)).fetchone())
            if not pkg_row:
                raise NotFoundError("Pacchetto non trovato.")
            self._send_json(200, compute_package_summary(conn, pkg_row))
            return

        # Download allegato privato autenticato (/attachments/<id> o /api/attachments/<id>)
        m_att = re.match(r"^/(?:api/)?attachments/(\d+)$", path)
        if m_att:
            att_id = int(m_att.group(1))
            att = row_to_dict(conn.execute("SELECT * FROM attachments WHERE id = ?", (att_id,)).fetchone())
            if not att:
                raise NotFoundError("Allegato non trovato.")
            file_path = self._get_attachments_dir() / att["stored_filename"]
            if not file_path.exists():
                raise NotFoundError("File allegato non presente nello storage privato.")
            raw_bytes = file_path.read_bytes()
            log_audit(
                conn,
                "READ_PRIVATE_ATTACHMENT",
                "attachments",
                att_id,
                att["person_id"],
                f"Accesso autenticato all'allegato '{att['original_filename']}'",
                actor=actor,
            )
            conn.commit()
            disp = "inline" if query.get("inline", ["1"])[0] == "1" else "attachment"
            self._send_bytes(
                200,
                raw_bytes,
                att["mime_type"],
                extra_headers={"Content-Disposition": f'{disp}; filename="{att["original_filename"]}"'},
                is_private=True,
            )
            return

        # Sicurezza: info 2FA TOTP e lista backup cifrati + audit log
        if path == "/api/security/overview":
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone())
            bkp_dir = self._get_backups_dir()
            backups = []
            for mf in sorted(bkp_dir.glob("*.meta.json"), reverse=True):
                try:
                    backups.append(json.loads(mf.read_text(encoding="utf-8")))
                except Exception:
                    pass
            recent_audits = rows_to_list(
                conn.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 60").fetchall()
            )
            self._send_json(
                200,
                {
                    "env_mode": get_env_mode(),
                    "username": user["username"],
                    "display_name": user["display_name"],
                    "totp_enabled": bool(user["totp_enabled"]),
                    "totp_secret": user["totp_secret"],
                    "otpauth_uri": build_otpauth_uri(user["totp_secret"], user["username"]),
                    "current_totp_demo_hint": get_totp_code(user["totp_secret"]) if get_env_mode() != "prod" else None,
                    "backups": backups,
                    "recent_audits": recent_audits,
                },
            )
            return

        self._send_json(404, {"error": f"Endpoint GET non trovato: {path}"})

    # ==========================================================================
    # GESTIONE RICHIESTE POST / PUT / DELETE
    # ==========================================================================

    def do_POST(self) -> None:
        self._handle_write_request("POST")

    def do_PUT(self) -> None:
        self._handle_write_request("PUT")

    def do_DELETE(self) -> None:
        self._handle_write_request("DELETE")

    def _handle_write_request(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        conn = self._get_db_conn()
        try:
            # 1. Login (con password PBKDF2 + 2FA TOTP quando abilitato)
            if path == "/api/auth/login" and method == "POST":
                client_ip = self.client_address[0] if self.client_address else "local"
                if not check_rate_limit(client_ip):
                    self._send_json(429, {"error": "Troppi tentativi di accesso. Riprova tra qualche minuto."})
                    return

                payload = self._read_json_body()
                username = (payload.get("username") or "admin").strip()
                password = payload.get("password") or ""
                totp_code = (payload.get("totp_code") or "").strip()

                user = row_to_dict(conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone())
                if not user or not verify_password(password, user["password_hash"]):
                    record_failed_login(client_ip)
                    self._send_json(401, {"error": "Credenziali non valide."})
                    return

                if user["totp_enabled"]:
                    if not totp_code:
                        self._send_json(
                            401,
                            {
                                "error": "Inserisci il codice a 6 cifre del secondo fattore (2FA TOTP).",
                                "require_totp": True,
                            },
                        )
                        return
                    totp_ok = verify_totp_code(user["totp_secret"], totp_code)
                    if not totp_ok:
                        # Controlla codici di recupero monouso
                        rec_hashes = json.loads(user.get("recovery_codes_json") or "[]")
                        cand_hash = hash_token(totp_code.upper())
                        if cand_hash in rec_hashes:
                            rec_hashes.remove(cand_hash)
                            conn.execute(
                                "UPDATE users SET recovery_codes_json = ? WHERE id = ?",
                                (json.dumps(rec_hashes), user["id"]),
                            )
                        else:
                            record_failed_login(client_ip)
                            self._send_json(401, {"error": "Codice 2FA TOTP non valido.", "require_totp": True})
                            return

                raw_token = secrets.token_urlsafe(32)
                csrf_token = secrets.token_hex(24)
                now_dt = datetime.now(ROME_TZ)
                expires_dt = now_dt + timedelta(hours=12)

                conn.execute(
                    """
                    INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, last_seen_at, user_agent, ip_address)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        hash_token(raw_token),
                        user["id"],
                        csrf_token,
                        now_dt.isoformat(timespec="seconds"),
                        expires_dt.isoformat(timespec="seconds"),
                        now_dt.isoformat(timespec="seconds"),
                        (self.headers.get("User-Agent") or "")[:200],
                        client_ip,
                    ),
                )
                log_audit(conn, "LOGIN_SUCCESS", "users", user["id"], None, f"Accesso effettuato da {username}", actor=user["display_name"])
                conn.commit()

                cookie_val = f"gestionale_session={raw_token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200"
                self._send_json(
                    200,
                    {
                        "authenticated": True,
                        "token": raw_token,
                        "csrf_token": csrf_token,
                        "user": {
                            "id": user["id"],
                            "username": user["username"],
                            "display_name": user["display_name"],
                            "totp_enabled": bool(user["totp_enabled"]),
                        },
                    },
                    extra_headers={"Set-Cookie": cookie_val},
                )
                return

            # 2. Registrazione pubblica disabilitata esplicitamente
            if path == "/api/auth/register":
                self._send_json(
                    403,
                    {
                        "error": "La registrazione pubblica è disabilitata. Questo gestionale consente solo l'account personale del professionista."
                    },
                )
                return

            # 3. Logout
            if path == "/api/auth/logout" and method == "POST":
                token, _ = self._extract_session_token()
                if token:
                    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
                    conn.commit()
                self._send_json(
                    200,
                    {"authenticated": False},
                    extra_headers={"Set-Cookie": "gestionale_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"},
                )
                return

            # 4. Verifica autenticazione e CSRF per tutte le altre rotte di scrittura
            session = self._authenticate(conn, require_csrf=True)
            if not session:
                self._send_json(
                    401,
                    {
                        "error": "Sessione non valida, scaduta o token CSRF mancante.",
                        "code": "UNAUTHORIZED",
                    },
                )
                return

            payload = self._read_json_body()
            actor = session["display_name"]

            # --- ANAGRAFICA ---
            if path == "/api/people" and method == "POST":
                person = create_person(conn, payload, actor=actor)
                self._send_json(201, person)
                return

            m_person = re.match(r"^/api/people/(\d+)$", path)
            if m_person and method == "PUT":
                person = update_person(conn, int(m_person.group(1)), payload, actor=actor)
                self._send_json(200, person)
                return

            if m_person and method == "DELETE":
                person_id = int(m_person.group(1))
                # Cancellazione completa secondo diritto alla cancellazione / pulizia dati fittizi, con traccia audit
                p_row = conn.execute("SELECT first_name, last_name FROM people WHERE id = ?", (person_id,)).fetchone()
                if not p_row:
                    raise NotFoundError("Persona non trovata.")
                atts = conn.execute("SELECT stored_filename FROM attachments WHERE person_id = ?", (person_id,)).fetchall()
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("DELETE FROM people WHERE id = ?", (person_id,))
                log_audit(conn, "DELETE_PERSON", "people", person_id, None, f"Cancellata scheda personale #{person_id}", actor=actor)
                conn.commit()
                for a in atts:
                    fp = self._get_attachments_dir() / a["stored_filename"]
                    if fp.exists():
                        fp.unlink()
                self._send_json(200, {"deleted": True, "person_id": person_id})
                return

            m_anam = re.match(r"^/api/people/(\d+)/anamnesis$", path)
            if m_anam and method in ("PUT", "POST"):
                res = save_person_anamnesis(conn, int(m_anam.group(1)), payload, actor=actor)
                self._send_json(200, res)
                return

            # --- PONTE LIMITAZIONI CONDIVISE ---
            if path == "/api/shared-limitations" and method == "POST":
                lim = create_shared_limitation(conn, payload, actor=actor)
                self._send_json(201, lim)
                return

            m_lim = re.match(r"^/api/shared-limitations/(\d+)/toggle$", path)
            if m_lim and method == "POST":
                lim_id = int(m_lim.group(1))
                row = conn.execute("SELECT * FROM shared_limitations WHERE id = ?", (lim_id,)).fetchone()
                if not row:
                    raise NotFoundError("Limitazione non trovata.")
                new_active = 0 if row["is_active"] else 1
                conn.execute(
                    "UPDATE shared_limitations SET is_active = ?, updated_at = ? WHERE id = ?",
                    (new_active, now_rome_iso(), lim_id),
                )
                conn.commit()
                self._send_json(200, row_to_dict(conn.execute("SELECT * FROM shared_limitations WHERE id = ?", (lim_id,)).fetchone()))
                return

            # --- AREA FISIOTERAPIA ---
            if path == "/api/physio/episodes" and method == "POST":
                ep = create_physio_episode(conn, payload, actor=actor)
                self._send_json(201, ep)
                return

            m_ep = re.match(r"^/api/physio/episodes/(\d+)$", path)
            if m_ep and method == "PUT":
                ep = update_physio_episode(conn, int(m_ep.group(1)), payload, actor=actor)
                self._send_json(200, ep)
                return

            if path == "/api/physio/evaluations" and method == "POST":
                ev = save_clinical_evaluation(conn, payload, evaluation_id=None, actor=actor)
                self._send_json(201, ev)
                return

            m_ev = re.match(r"^/api/physio/evaluations/(\d+)$", path)
            if m_ev and method == "PUT":
                ev = save_clinical_evaluation(conn, payload, evaluation_id=int(m_ev.group(1)), actor=actor)
                self._send_json(200, ev)
                return

            if path == "/api/physio/flags" and method in ("POST", "PUT"):
                fl = save_clinical_flag(conn, payload, actor=actor)
                self._send_json(200, fl)
                return

            if path == "/api/physio/outcome-measures" and method == "POST":
                om = record_outcome_measure(conn, payload, actor=actor)
                self._send_json(201, om)
                return

            m_om = re.match(r"^/api/physio/outcome-measures/(\d+)$", path)
            if m_om and method == "DELETE":
                res = delete_outcome_measure(conn, int(m_om.group(1)), actor=actor)
                self._send_json(200, res)
                return

            if path == "/api/physio/notes" and method == "POST":
                note = save_clinical_note(conn, payload, note_id=None, actor=actor)
                self._send_json(201, note)
                return

            m_note = re.match(r"^/api/physio/notes/(\d+)$", path)
            if m_note and method == "PUT":
                note = save_clinical_note(conn, payload, note_id=int(m_note.group(1)), actor=actor)
                self._send_json(200, note)
                return

            if path == "/api/physio/addenda" and method == "POST":
                add = add_clinical_addendum(conn, payload, actor=actor)
                self._send_json(201, add)
                return

            # --- AREA FITNESS ---
            m_fit_prof = re.match(r"^/api/people/(\d+)/fitness-profile$", path)
            if m_fit_prof and method in ("POST", "PUT"):
                prof = save_fitness_profile(conn, int(m_fit_prof.group(1)), payload, actor=actor)
                self._send_json(200, prof)
                return

            if path == "/api/fitness/metrics" and method == "POST":
                met = record_fitness_metric(conn, payload, actor=actor)
                self._send_json(201, met)
                return

            if path == "/api/fitness/programs" and method == "POST":
                prog = save_fitness_program(conn, payload, program_id=None, actor=actor)
                self._send_json(201, prog)
                return

            m_prog = re.match(r"^/api/fitness/programs/(\d+)$", path)
            if m_prog and method == "PUT":
                prog = save_fitness_program(conn, payload, program_id=int(m_prog.group(1)), actor=actor)
                self._send_json(200, prog)
                return

            if path == "/api/fitness/workout-logs" and method == "POST":
                wlog = record_workout_log(conn, payload, actor=actor)
                self._send_json(201, wlog)
                return

            # --- PACCHETTI E PAGAMENTI ---
            if path == "/api/packages" and method == "POST":
                pkg = create_package(conn, payload, actor=actor)
                self._send_json(201, pkg)
                return

            m_pkg_mov = re.match(r"^/api/packages/(\d+)/movements$", path)
            if m_pkg_mov and method == "POST":
                pkg = record_manual_package_movement(conn, int(m_pkg_mov.group(1)), payload, actor=actor)
                self._send_json(200, pkg)
                return

            m_pkg_del = re.match(r"^/api/packages/(\d+)$", path)
            if m_pkg_del and method == "DELETE":
                res = delete_package(conn, int(m_pkg_del.group(1)), actor=actor)
                self._send_json(200, res)
                return

            m_pkg_susp = re.match(r"^/api/packages/(\d+)/status$", path)
            if m_pkg_susp and method == "POST":
                pkg_id = int(m_pkg_susp.group(1))
                curr_pkg = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (pkg_id,)).fetchone())
                if not curr_pkg:
                    raise NotFoundError("Pacchetto non trovato.")
                new_status = payload.get("status") or curr_pkg["status"]
                suspensions = json.loads(curr_pkg.get("suspensions_json") or "[]")
                if new_status == "sospeso":
                    suspensions.append(
                        {
                            "date": now_rome_iso()[:10],
                            "reason": payload.get("reason") or "Sospensione temporanea concordata",
                        }
                    )
                conn.execute(
                    "UPDATE packages SET status = ?, valid_until = ?, suspensions_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
                    (
                        new_status,
                        payload.get("valid_until", curr_pkg["valid_until"]),
                        json.dumps(suspensions, ensure_ascii=False),
                        now_rome_iso(),
                        pkg_id,
                    ),
                )
                conn.commit()
                updated_pkg = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (pkg_id,)).fetchone())
                self._send_json(200, compute_package_summary(conn, updated_pkg))
                return

            if path == "/api/payments" and method == "POST":
                pay = record_payment(conn, payload, actor=actor)
                self._send_json(201, pay)
                return

            # --- AGENDA E STATO SEDUTA ---
            if path == "/api/appointments" and method == "POST":
                appt = create_appointment(conn, payload, actor=actor)
                self._send_json(201, appt)
                return

            m_appt = re.match(r"^/api/appointments/(\d+)$", path)
            if m_appt and method in ("PUT", "POST"):
                appt = update_appointment_or_status(conn, int(m_appt.group(1)), payload, actor=actor)
                self._send_json(200, appt)
                return

            # --- CONSENSI E ALLEGATI PRIVATI ---
            if path == "/api/consents" and method == "POST":
                c = save_consent_record(conn, payload, actor=actor)
                self._send_json(201, c)
                return

            if path == "/api/attachments" and method == "POST":
                person_id = int(payload["person_id"])
                filename = payload.get("filename") or "allegato.pdf"
                mime_type = payload.get("mime_type") or "application/pdf"
                b64_data = payload.get("content_base64") or ""
                if "," in b64_data:
                    b64_data = b64_data.split(",", 1)[1]
                raw_bytes = base64.b64decode(b64_data)
                att = store_private_attachment(
                    conn,
                    person_id=person_id,
                    original_filename=filename,
                    file_bytes=raw_bytes,
                    mime_type=mime_type,
                    category=payload.get("category") or "Referto / Documento",
                    description=payload.get("description") or "",
                    episode_id=payload.get("episode_id"),
                    program_id=payload.get("program_id"),
                    evaluation_id=payload.get("evaluation_id"),
                    actor=actor,
                    attachments_dir=self._get_attachments_dir(),
                )
                self._send_json(201, att)
                return

            # --- SICUREZZA, 2FA TOTP, BACKUP E RIPRISTINO DI PROVA ---
            if path == "/api/security/totp" and method == "POST":
                enable = bool(payload.get("enable"))
                code = (payload.get("code") or "").strip()
                user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone())
                if enable:
                    if not verify_totp_code(user["totp_secret"], code):
                        raise ValidationError("Codice TOTP a 6 cifre non valido. Verifica l'ora del dispositivo o usa il codice mostrato.")
                    plain_codes, hashed_codes = generate_recovery_codes()
                    conn.execute(
                        "UPDATE users SET totp_enabled = 1, recovery_codes_json = ?, updated_at = ? WHERE id = ?",
                        (json.dumps(hashed_codes), now_rome_iso(), user["id"]),
                    )
                    log_audit(conn, "ENABLE_2FA_TOTP", "users", user["id"], None, "Abilitato secondo fattore TOTP", actor=actor)
                    conn.commit()
                    self._send_json(200, {"totp_enabled": True, "recovery_codes": plain_codes})
                    return
                else:
                    conn.execute(
                        "UPDATE users SET totp_enabled = 0, updated_at = ? WHERE id = ?",
                        (now_rome_iso(), user["id"]),
                    )
                    log_audit(conn, "DISABLE_2FA_TOTP", "users", user["id"], None, "Disabilitato secondo fattore TOTP", actor=actor)
                    conn.commit()
                    self._send_json(200, {"totp_enabled": False})
                    return

            if path == "/api/security/password" and method == "POST":
                curr_pwd = payload.get("current_password") or ""
                new_pwd = payload.get("new_password") or ""
                if len(new_pwd) < 10:
                    raise ValidationError("La nuova password deve contenere almeno 10 caratteri.")
                user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone())
                if not verify_password(curr_pwd, user["password_hash"]):
                    raise ValidationError("La password attuale non è corretta.")
                conn.execute(
                    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                    (hash_password(new_pwd), now_rome_iso(), user["id"]),
                )
                log_audit(conn, "CHANGE_PASSWORD", "users", user["id"], None, "Password account aggiornata", actor=actor)
                conn.commit()
                self._send_json(200, {"updated": True})
                return

            if path == "/api/security/credentials" and method == "POST":
                curr_pwd = payload.get("current_password") or ""
                user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone())
                if not verify_password(curr_pwd, user["password_hash"]):
                    raise ValidationError("La password attuale non è corretta.")

                new_username = (payload.get("username") or "").strip()
                new_display_name = (payload.get("display_name") or "").strip()
                new_pwd = payload.get("new_password") or ""

                if not new_username:
                    raise ValidationError("Il nome utente non può essere vuoto.")
                if len(new_username) < 3 or any(ch.isspace() for ch in new_username):
                    raise ValidationError("Il nome utente deve avere almeno 3 caratteri e non contenere spazi.")
                if new_username != user["username"]:
                    existing = conn.execute(
                        "SELECT id FROM users WHERE username = ? AND id != ?",
                        (new_username, user["id"]),
                    ).fetchone()
                    if existing:
                        raise ValidationError("Questo nome utente è già in uso.")

                if new_pwd and len(new_pwd) < 10:
                    raise ValidationError("La nuova password deve contenere almeno 10 caratteri.")

                final_display_name = new_display_name or user["display_name"]
                final_pwd_hash = hash_password(new_pwd) if new_pwd else user["password_hash"]

                changed_fields = []
                if new_username != user["username"]:
                    changed_fields.append(f"username -> {new_username}")
                if final_display_name != user["display_name"]:
                    changed_fields.append(f"nome visualizzato -> {final_display_name}")
                if new_pwd:
                    changed_fields.append("password")

                if not changed_fields:
                    raise ValidationError("Nessuna modifica rilevata: aggiorna username, nome visualizzato o nuova password.")

                conn.execute(
                    "UPDATE users SET username = ?, display_name = ?, password_hash = ?, updated_at = ? WHERE id = ?",
                    (new_username, final_display_name, final_pwd_hash, now_rome_iso(), user["id"]),
                )
                log_audit(
                    conn,
                    "UPDATE_CREDENTIALS",
                    "users",
                    user["id"],
                    None,
                    f"Aggiornate credenziali account ({', '.join(changed_fields)})",
                    actor=final_display_name,
                )
                conn.commit()
                self._send_json(
                    200,
                    {
                        "updated": True,
                        "username": new_username,
                        "display_name": final_display_name,
                    },
                )
                return

            if path == "/api/security/backups" and method == "POST":
                meta = create_encrypted_backup(
                    db_path=getattr(self.server, "db_path", None),
                    attachments_dir=self._get_attachments_dir(),
                    backups_dir=self._get_backups_dir(),
                    actor=actor,
                )
                self._send_json(201, meta)
                return

            if path == "/api/security/backups/verify-restore" and method == "POST":
                backup_filename = payload.get("encrypted_filename")
                bkp_dir = self._get_backups_dir()
                if backup_filename:
                    bkp_path = bkp_dir / Path(backup_filename).name
                else:
                    candidates = sorted(bkp_dir.glob("*.zip.enc"), reverse=True)
                    if not candidates:
                        raise ValidationError("Nessun backup cifrato presente. Crea prima un backup.")
                    bkp_path = candidates[0]
                if not bkp_path.exists():
                    raise NotFoundError("File di backup cifrato non trovato.")

                import tempfile
                with tempfile.TemporaryDirectory() as tmp_restore:
                    verification = restore_and_verify_backup(bkp_path, Path(tmp_restore))
                log_audit(
                    conn,
                    "VERIFY_BACKUP_RESTORE",
                    "backups",
                    None,
                    None,
                    f"Verificato ripristino in ambiente di prova per {bkp_path.name}",
                    actor=actor,
                )
                conn.commit()
                self._send_json(200, verification)
                return

            self._send_json(404, {"error": f"Endpoint {method} non trovato: {path}"})
        except ConflictError as e:
            self._send_json(
                409,
                {
                    "error": e.message,
                    "code": "CONFLICT",
                    "server_record": e.server_record,
                },
            )
        except NotFoundError as e:
            self._send_json(404, {"error": str(e) or "Risorsa non trovata."})
        except ValidationError as e:
            self._send_json(400, {"error": e.message, "details": e.details})
        except Exception as e:
            traceback.print_exc()
            self._send_json(500, {"error": f"Errore interno del server: {str(e)}"})
        finally:
            conn.close()

    def _serve_static_asset(self, path: str) -> None:
        if path in ("/", "/index.html"):
            target = FRONTEND_DIR / "index.html"
        else:
            rel = path.lstrip("/")
            target = (FRONTEND_DIR / rel).resolve()
            if not str(target).startswith(str(FRONTEND_DIR.resolve())):
                self._send_json(403, {"error": "Accesso negato."})
                return

        if not target.exists() or not target.is_file():
            # SPA fallback per navigazione client
            target = FRONTEND_DIR / "index.html"

        mime, _ = mimetypes.guess_type(str(target))
        if target.suffix == ".webmanifest":
            mime = "application/manifest+json; charset=utf-8"
        elif target.suffix == ".js":
            mime = "application/javascript; charset=utf-8"
        elif target.suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif target.suffix == ".svg":
            mime = "image/svg+xml"
        elif not mime:
            mime = "text/html; charset=utf-8"

        self._send_bytes(200, target.read_bytes(), mime, is_private=False)


def create_http_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    db_path: Optional[Path] = None,
    attachments_dir: Optional[Path] = None,
    backups_dir: Optional[Path] = None,
) -> ThreadingHTTPServer:
    init_db(db_path)
    srv = ThreadingHTTPServer((host, port), GestionaleHTTPHandler)
    srv.db_path = db_path or get_db_path()
    srv.attachments_dir = attachments_dir or get_attachments_dir()
    srv.backups_dir = backups_dir or get_backups_dir()
    return srv
