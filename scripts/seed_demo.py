"""
Popola il database DEMO (`data/demo/gestionale_demo.sqlite`) con dati interamente fittizi,
chiaramente contrassegnati e separati dall'ambiente reale (`prod`).
"""
from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import ROME_TZ, get_attachments_dir, get_db_path
from backend.db import get_connection, init_db, now_rome_iso
from backend.services import (
    create_appointment,
    create_package,
    create_person,
    create_physio_episode,
    create_shared_limitation,
    record_fitness_metric,
    record_outcome_measure,
    record_workout_log,
    save_clinical_evaluation,
    save_clinical_flag,
    save_clinical_note,
    save_consent_record,
    save_fitness_profile,
    save_fitness_program,
    store_private_attachment,
    update_appointment_or_status,
)


def seed_fictitious_data(db_path: Path = None, attachments_dir: Path = None) -> None:
    init_db(db_path)
    conn = get_connection(db_path)
    try:
        existing = conn.execute("SELECT COUNT(*) AS c FROM people").fetchone()["c"]
        if existing > 0:
            return

        today = datetime.now(ROME_TZ).date()
        d_minus_20 = (today - timedelta(days=20)).isoformat()
        d_minus_14 = (today - timedelta(days=14)).isoformat()
        d_minus_7 = (today - timedelta(days=7)).isoformat()
        d_minus_2 = (today - timedelta(days=2)).isoformat()
        d_today = today.isoformat()
        d_plus_2 = (today + timedelta(days=2)).isoformat()
        d_plus_5 = (today + timedelta(days=5)).isoformat()

        # ----------------------------------------------------------------------
        # 1. MARCO ROSSI — Persona unica con ENTRAMBI i percorsi (Fisio + Fitness)
        # ----------------------------------------------------------------------
        marco = create_person(
            conn,
            {
                "first_name": "Marco",
                "last_name": "Rossi",
                "birth_date": "1988-04-12",
                "tax_code": "RSSMRC88D12F205X",
                "phone": "+39 340 0001122",
                "email": "marco.rossi.fittizio@example.it",
                "address": "Via Torino 14, Milano (DATO FITTIZIO)",
                "profession": "Product Manager (lavoro sedentario al PC 8h/gg)",
                "sport_activity": "Running mezza maratona (3 uscite/sett) + Palestra",
                "general_notes": "[ANAGRAFICA FITTIZIA DI TEST] Segue percorso integrato: riabilitazione tendinopatia rotulea DX e programma di forza personal training.",
                "physio_active": True,
                "fitness_active": True,
                "is_fictitious": True,
            },
        )
        marco_id = marco["id"]

        # Consensi distinti: Informativa Privacy + Consenso Trattamento Sanitario
        # Allegato PDF fittizio privato
        minimal_pdf = (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
            b"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n"
        )
        att_marco = store_private_attachment(
            conn,
            person_id=marco_id,
            original_filename="RMN_Ginocchio_DX_MarcoRossi_Fittizio.pdf",
            file_bytes=minimal_pdf,
            mime_type="application/pdf",
            category="Referto Diagnostico",
            description="Referto RMN ginocchio DX (fittizio di prova): lieve ispessimento terzo prossimale tendine rotuleo.",
            attachments_dir=attachments_dir,
        )

        save_consent_record(
            conn,
            {
                "person_id": marco_id,
                "doc_type": "informativa_privacy",
                "doc_version": "Informativa v2026.1",
                "status": "acquisito",
                "signed_date": d_minus_20,
                "acquisition_method": "Modulo firmato in studio",
                "attachment_id": att_marco["id"],
            },
        )
        save_consent_record(
            conn,
            {
                "person_id": marco_id,
                "doc_type": "consenso_trattamento_sanitario",
                "doc_version": "Consenso Sanitario v2026.1",
                "status": "acquisito",
                "signed_date": d_minus_20,
                "acquisition_method": "Consenso informato firmato previa spiegazione clinica",
            },
        )

        # Episodio Fisioterapico Marco
        ep_marco = create_physio_episode(
            conn,
            {
                "person_id": marco_id,
                "title": "Tendinopatia rotulea ginocchio DX",
                "chief_complaint": "Dolore localizzato al polo inferiore della rotula DX durante corsa in discesa e squat profondo",
                "body_region": "Ginocchio",
                "laterality": "DX",
                "start_date": d_minus_20,
                "reassessment_due_date": d_plus_2,
                "patient_goals": "Tornare a correre 15 km senza dolore entro 8 settimane.",
                "therapist_goals": "Gestione del carico tendineo, recupero forza isometrica/isotonica quadricipite e controllo catena cinetica.",
                "init_default_flags": True,
            },
        )
        ep_marco_id = ep_marco["id"]

        # Aggiorna alcune Red/Yellow Flags per mostrare stati 'assente', 'presente' e 'non_valutato'
        flags = ep_marco["flags"]
        if len(flags) >= 4:
            save_clinical_flag(
                conn,
                {
                    "id": flags[0]["id"],
                    "status": "assente",
                    "notes": "Nessun segno sistemico o perdita di peso.",
                    "source_info": "Colloquio anamnestico iniziale",
                    "action_taken": "Nessuna azione necessaria",
                    "recorded_date": d_minus_20,
                },
            )
            save_clinical_flag(
                conn,
                {
                    "id": flags[2]["id"],
                    "status": "assente",
                    "notes": "Esordio da sovraccarico progressivo, nessun trauma acuto.",
                    "source_info": "Anamnesi",
                    "action_taken": "Proseguire esame funzionale",
                    "recorded_date": d_minus_20,
                },
            )
            # Yellow flag presente
            yf_list = [f for f in flags if f["flag_type"] == "yellow"]
            if yf_list:
                save_clinical_flag(
                    conn,
                    {
                        "id": yf_list[0]["id"],
                        "status": "presente",
                        "notes": "Preoccupazione di dover sospendere completamente la corsa; tendenza ad aumentare bruscamente i km nei weekend.",
                        "source_info": "Colloquio clinico",
                        "action_taken": "Educazione terapeutica sul monitoraggio del dolore 24h (semaforo del carico 0-3/10).",
                        "recorded_date": d_minus_20,
                    },
                )

        # Prima Valutazione con Mappa del Dolore 2D
        ev1_marco = save_clinical_evaluation(
            conn,
            {
                "episode_id": ep_marco_id,
                "eval_type": "prima_valutazione",
                "eval_date": d_minus_20,
                "status": "finalizzata",
                "consult_reason": "Dolore anteriore ginocchio DX insorto dopo incremento volume di corsa (+40% in 2 settimane).",
                "patient_goals": "Correre 10-15 km su strada senza dolore post-allenamento.",
                "important_activities": "1. Corsa a 4'50\"/km; 2. Scendere le scale la mattina; 3. Squat con bilanciere.",
                "symptom_onset": "Insorto gradualmente 4 settimane fa.",
                "symptom_distribution": "Ben localizzato al polo inferiore della rotula DX (1 dito), non irradiato.",
                "symptom_behavior": "Fenomeno di warm-up presente (migliora dopo 10 min di riscaldamento, peggiora il giorno successivo).",
                "aggravating_factors": "Corsa in discesa, balzi, single-leg decline squat, scendere le scale.",
                "easing_factors": "Riposo relativo, contrazioni isometriche a 60° di flessione.",
                "pattern_24h": "Rigidità e dolenzia mattutina per 15 minuti dopo le giornate di corsa.",
                "functional_impact": "Ridotto volume di corsa a 5 km con fastidio finale.",
                "medical_history": "Nessuna patologia internistica rilevante.",
                "surgeries_traumas": "Distorsione caviglia DX 5 anni fa completamente risolta.",
                "medications": "Nessuno.",
                "imaging_reports": "Ecografia/RMN: segni compatibili con tendinopatia reattiva prossimale rotulea DX.",
                "sleep_quality": "Buona (7.5h/notte).",
                "work_sport_load": "Seduto 8h/gg; 3 allenamenti running + 2 sedute pesi/settimana.",
                "psychosocial_factors": "Alta motivazione, timore di perdere la condizione aerobica.",
                "objective_measurements": [
                    {"name": "ROM Flessione Ginocchio attiva", "value": "135", "unit": "°", "side": "DX", "notes": "Completa, lieve fastidio a fine range"},
                    {"name": "ROM Flessione Ginocchio attiva", "value": "140", "unit": "°", "side": "SX", "notes": "Asintomatica"},
                    {"name": "Single Leg Decline Squat (angolo comparsa dolore)", "value": "45", "unit": "°", "side": "DX", "notes": "NPRS 6/10 sul polo rotuleo"},
                    {"name": "Forza Isometrica Estensione Ginocchio 60°", "value": "38", "unit": "kg", "side": "DX", "notes": "Deficit ~18% vs SX (46 kg)"},
                ],
                "special_tests": "Royal London Hospital Test positivo al polo inferiore rotula DX; test meniscali e legamentosi negativi.",
                "clinical_observations": "Lieve valgo dinamico dell'arto inferiore DX durante single-leg squat.",
                "clinical_reasoning": "Quadro coerente con tendinopatia rotulea prossimale DX da sovraccarico meccanico (load-related tendon pain).",
                "treatment_plan": "Fase 1: Spanish Squat isometrico + Heavy Slow Resistance (HSR) progressivo + modulazione chilometraggio corsa.",
                "assigned_exercises": [
                    {"name": "Spanish Squat Isometrico con banda", "dosage": "5 x 45 sec @ 70% MVC, rec 90s"},
                    {"name": "Leg Press Monopodalica (3s ecc - 3s conc)", "dosage": "4 x 8 rip @ RPE 7"},
                ],
                "home_advice": "Monitorare il dolore a 24 ore (accettabile fino a 3/10 se stabile il mattino dopo).",
                "next_reassessment_date": d_plus_2,
                "body_map_markers": [
                    {
                        "view_side": "anterior",
                        "marker_kind": "point",
                        "x_norm": 445.0,
                        "y_norm": 655.0,
                        "radius_norm": 22.0,
                        "anatomical_region": "Tendine rotuleo / Polo inferiore rotula",
                        "laterality": "DX",
                        "symptom_type": "Dolore acuto",
                        "intensity": 6,
                        "notes": "Dolore puntiforme sotto carico (Single Leg Decline Squat)",
                        "recorded_date": d_minus_20,
                    },
                    {
                        "view_side": "anterior",
                        "marker_kind": "area",
                        "x_norm": 442.0,
                        "y_norm": 575.0,
                        "radius_norm": 46.0,
                        "anatomical_region": "Vasto mediale / Quadricipite distale",
                        "laterality": "DX",
                        "symptom_type": "Rigidità",
                        "intensity": 3,
                        "notes": "Sensazione di affaticamento post-corsa",
                        "recorded_date": d_minus_20,
                    },
                ],
            },
        )

        # Misure di esito iniziali (T0)
        record_outcome_measure(
            conn,
            {
                "episode_id": ep_marco_id,
                "evaluation_id": ev1_marco["id"],
                "scale_code": "NPRS",
                "context_label": "Single-leg decline squat (T0)",
                "score_value": 6.0,
                "recorded_date": d_minus_20,
                "clinical_note": "Dolore al polo inferiore rotula DX durante test provocativo.",
            },
        )
        record_outcome_measure(
            conn,
            {
                "episode_id": ep_marco_id,
                "evaluation_id": ev1_marco["id"],
                "scale_code": "PSFS",
                "context_label": "Valutazione iniziale (T0)",
                "responses": [
                    {"activity": "Corsa 10 km su strada", "score": 4},
                    {"activity": "Scendere le scale al mattino", "score": 6},
                    {"activity": "Squat sotto il parallelo", "score": 5},
                ],
                "recorded_date": d_minus_20,
            },
        )

        # Rivalutazione intermedia (T1) conservando la precedente
        ev2_marco = save_clinical_evaluation(
            conn,
            {
                "episode_id": ep_marco_id,
                "eval_type": "rivalutazione",
                "eval_date": d_minus_7,
                "status": "finalizzata",
                "consult_reason": "Rivalutazione a 2 settimane dall'inizio del protocollo HSR.",
                "patient_goals": "Riprendere uscite da 10 km continuativi.",
                "symptom_behavior": "Ridotta rigidità mattutina (meno di 5 minuti). Buona tolleranza alla Leg Press.",
                "objective_measurements": [
                    {"name": "Single Leg Decline Squat (angolo comparsa dolore)", "value": "65", "unit": "°", "side": "DX", "notes": "NPRS sceso a 3/10"},
                    {"name": "Forza Isometrica Estensione Ginocchio 60°", "value": "43", "unit": "kg", "side": "DX", "notes": "Deficit ridotto a ~8% vs SX"},
                ],
                "clinical_reasoning": "Progressione positiva della capacità di carico tendinea.",
                "treatment_plan": "Introduzione lavoro pliometrico a basso impatto e progressione carichi in area Fitness.",
                "next_reassessment_date": d_plus_2,
                "body_map_markers": [
                    {
                        "view_side": "anterior",
                        "marker_kind": "point",
                        "x_norm": 445.0,
                        "y_norm": 655.0,
                        "radius_norm": 18.0,
                        "anatomical_region": "Tendine rotuleo / Polo inferiore rotula",
                        "laterality": "DX",
                        "symptom_type": "Dolore sordo/profondo",
                        "intensity": 3,
                        "notes": "Fastidio lieve solo oltre 65° di flessione monopodalica",
                        "recorded_date": d_minus_7,
                    }
                ],
            },
        )

        # Misure di esito T1 (stessa versione, confronto diretto)
        record_outcome_measure(
            conn,
            {
                "episode_id": ep_marco_id,
                "evaluation_id": ev2_marco["id"],
                "scale_code": "NPRS",
                "context_label": "Single-leg decline squat (T1)",
                "score_value": 3.0,
                "recorded_date": d_minus_7,
                "clinical_note": "Riduzione del dolore al test provocativo.",
            },
        )
        record_outcome_measure(
            conn,
            {
                "episode_id": ep_marco_id,
                "evaluation_id": ev2_marco["id"],
                "scale_code": "PSFS",
                "context_label": "Rivalutazione intermedia (T1)",
                "responses": [
                    {"activity": "Corsa 10 km su strada", "score": 7},
                    {"activity": "Scendere le scale al mattino", "score": 8},
                    {"activity": "Squat sotto il parallelo", "score": 7},
                ],
                "recorded_date": d_minus_7,
            },
        )

        # Nota SOAP seduta precedente (finalizzata)
        save_clinical_note(
            conn,
            {
                "episode_id": ep_marco_id,
                "note_date": d_minus_7,
                "status": "finalizzata",
                "subjective_response": "Ha tollerato bene la corsa di 7 km a ritmo blando; NPRS 2/10 il mattino successivo.",
                "objective_findings": "Tonotrofismo quadricipite DX in miglioramento, nessun gonfiore perirotuleo.",
                "interventions_performed": "Terapia manuale tessuti molli quadricipite + progressione HSR.",
                "exercises_performed": "Spanish Squat 4x45s, Split Squat 4x8 @ 24kg, Calf Raise monopodalico 3x12.",
                "plan_next_steps": "Passare a 8.5 km nel weekend e coordinare la scheda di forza nell'area Fitness.",
                "pain_pre": 3,
                "pain_post": 1,
            },
        )

        # PONTE CONTROLLATO FISIO -> FITNESS: Limitazione condivisa con fonte e data
        create_shared_limitation(
            conn,
            {
                "person_id": marco_id,
                "physio_episode_id": ep_marco_id,
                "title": "Gestione carico tendine rotuleo DX (evitare pliometria ad alto impatto non dosata)",
                "description": "Consentito Squat/Leg Press con tempo controllato (3s eccentrica) mantenendo dolore <= 3/10. Evitare box jump massimali o affondi balistici fino a prossima rivalutazione.",
                "body_region": "Ginocchio",
                "laterality": "DX",
                "source_type": "Rivalutazione Fisioterapica",
                "source_reference": f"Episodio #{ep_marco_id} - Rivalutazione del {d_minus_7}",
                "recorded_date": d_minus_7,
            },
        )

        # AREA FITNESS di Marco Rossi
        save_fitness_profile(
            conn,
            marco_id,
            {
                "primary_goals": "Forza arti inferiori/core a supporto della mezza maratona e prevenzione recidive tendinee.",
                "experience_level": "Intermedio-Avanzato",
                "preferences": "Lavoro con bilanciere, manubri e kettlebell; gradisce feedback su RPE e velocità esecutiva.",
                "weekly_availability": "Martedì e Giovedì ore 13:00 o 18:30",
                "available_equipment": "Studio PT completo (Rack, Bilanciere olimpico, Leg Press, Kettlebell, Cavi)",
                "general_limitations_note": "Vedi limitazione attiva da Area Fisio su ginocchio DX.",
                "initial_assessment_notes": "Buona mobilità d'anca e caviglia; ottima tenuta del core.",
            },
        )

        record_fitness_metric(
            conn,
            {
                "person_id": marco_id,
                "recorded_date": d_minus_14,
                "metric_category": "Forza",
                "metric_name": "Trap Bar Deadlift 5RM",
                "value_num": 110.0,
                "unit": "kg",
                "side": "Bilaterale",
                "protocol_notes": "Esecuzione pulita @ RPE 8",
            },
        )

        prog_marco = save_fitness_program(
            conn,
            {
                "person_id": marco_id,
                "title": "Forza Specifica Runner & Heavy Slow Resistance",
                "goal": "Aumento forza massimale/submassimale arti inferiori e resilienza muscolo-tendinea",
                "phase_name": "Mesociclo 1 - Accumulo Controllato",
                "start_date": d_minus_14,
                "frequency_per_week": 2,
                "status": "attivo",
                "notes": "Rispettare rigorosamente il tempo eccentrico di 3 secondi sugli esercizi di accosciata.",
                "workouts": [
                    {
                        "day_name": "Giorno A — Lower Body HSR & Core",
                        "exercises": [
                            {"name": "Spanish Squat Isometrico", "sets": 4, "reps": "45 sec", "load": "BW + Banda", "rest": "90s", "rpe": "7", "notes": "Attivazione analgesica"},
                            {"name": "Trap Bar Deadlift", "sets": 4, "reps": "6", "load": "100 kg", "rest": "150s", "rpe": "7.5", "notes": "Focus spinta simmetrica"},
                            {"name": "Bulgarian Split Squat (eccentrica 3s)", "sets": 3, "reps": "8 per lato", "load": "2x16 kg", "rest": "120s", "rpe": "7.5", "notes": "Monitorare NPRS ginocchio DX <= 3/10"},
                            {"name": "Seated Calf Raise", "sets": 4, "reps": "10", "load": "45 kg", "rest": "90s", "rpe": "8", "notes": "Pausa 1s in massimo allungamento"},
                        ],
                    },
                    {
                        "day_name": "Giorno B — Upper Body & Catena Posteriore",
                        "exercises": [
                            {"name": "Romanian Deadlift (RDL)", "sets": 4, "reps": "8", "load": "80 kg", "rest": "120s", "rpe": "7.5", "notes": ""},
                            {"name": "Bench Press con Manubri", "sets": 4, "reps": "8", "load": "2x26 kg", "rest": "120s", "rpe": "8", "notes": ""},
                            {"name": "Chest Supported Row", "sets": 4, "reps": "10", "load": "55 kg", "rest": "90s", "rpe": "8", "notes": ""},
                            {"name": "Pallof Press al cavo", "sets": 3, "reps": "12 per lato", "load": "15 kg", "rest": "60s", "rpe": "7", "notes": ""},
                        ],
                    },
                ],
            },
        )

        # Registra una seduta fitness svolta (Programmato vs Svolto)
        record_workout_log(
            conn,
            {
                "person_id": marco_id,
                "program_id": prog_marco["id"],
                "workout_day_name": "Giorno A — Lower Body HSR & Core",
                "session_date": d_minus_2,
                "planned_exercises": prog_marco["workouts"][0]["exercises"],
                "actual_exercises": [
                    {"name": "Spanish Squat Isometrico", "sets": 4, "reps": "45 sec", "load": "BW + Banda", "rpe": "7", "done": True},
                    {"name": "Trap Bar Deadlift", "sets": 4, "reps": "6", "load": "105 kg (+5kg)", "rpe": "7.5", "done": True},
                    {"name": "Bulgarian Split Squat (eccentrica 3s)", "sets": 3, "reps": "8 per lato", "load": "2x16 kg", "rpe": "7.5", "done": True},
                    {"name": "Seated Calf Raise", "sets": 4, "reps": "10", "load": "45 kg", "rpe": "8", "done": True},
                ],
                "session_rpe": 7.5,
                "duration_minutes": 60,
                "client_feedback": "Ottime sensazioni, spinta fluida nella Trap Bar.",
                "reported_symptoms": "Lieve percezione sul tendine rotuleo DX solo nella 1a serie di Split Squat (2/10), poi scomparsa.",
                "symptom_severity": 2,
                "next_session_notes": "Confermare 105 kg su Trap Bar e provare 2x18 kg sullo Split Squat.",
            },
        )

        # PACCHETTO DA 10 SEDUTE DI MARCO ROSSI:
        # Scenario criterio d'accettazione: 10 sedute acquistate, 3 svolte (residue 7), 2 prenotate (disponibili 5).
        pkg_marco = create_package(
            conn,
            {
                "person_id": marco_id,
                "service_area": "misto",
                "name": "Pacchetto Integrato 10 Sedute (Fisio + PT)",
                "total_sessions": 10,
                "price_eur": 550.0,
                "purchased_date": d_minus_20,
                "valid_until": (today + timedelta(days=90)).isoformat(),
                "initial_payment_eur": 550.0,
                "payment_method": "Bonifico",
            },
        )
        pkg_marco_id = pkg_marco["id"]

        # 3 sedute svolte
        for idx, day_iso in enumerate([d_minus_20, d_minus_14, d_minus_7], start=1):
            create_appointment(
                conn,
                {
                    "person_id": marco_id,
                    "service_area": "fisio" if idx <= 2 else "fitness",
                    "service_name": "Seduta Fisioterapia" if idx <= 2 else "Seduta Personal Training",
                    "episode_id": ep_marco_id if idx <= 2 else None,
                    "program_id": prog_marco["id"] if idx > 2 else None,
                    "package_id": pkg_marco_id,
                    "start_at": f"{day_iso}T10:00:00",
                    "duration_minutes": 60,
                    "status": "svolto",
                },
            )

        # 2 sedute prenotate (1 oggi, 1 tra 2 giorni)
        create_appointment(
            conn,
            {
                "person_id": marco_id,
                "service_area": "fitness",
                "service_name": "Personal Training — Lower Body HSR",
                "program_id": prog_marco["id"],
                "package_id": pkg_marco_id,
                "start_at": f"{d_today}T15:00:00",
                "duration_minutes": 60,
                "status": "confermato",
                "notes": "Controllare risposta post-corsa prima di caricare lo Split Squat.",
            },
        )
        create_appointment(
            conn,
            {
                "person_id": marco_id,
                "service_area": "fisio",
                "service_name": "Rivalutazione Fisioterapica + Terapia",
                "episode_id": ep_marco_id,
                "package_id": pkg_marco_id,
                "start_at": f"{d_plus_2}T11:00:00",
                "duration_minutes": 60,
                "status": "prenotato",
            },
        )

        # ----------------------------------------------------------------------
        # 2. ELENA BIANCHI — Paziente Fisioterapia (con nota in bozza e rivalutazione oggi)
        # ----------------------------------------------------------------------
        elena = create_person(
            conn,
            {
                "first_name": "Elena",
                "last_name": "Bianchi",
                "birth_date": "1980-09-23",
                "tax_code": "BNCLNE80P63F205K",
                "phone": "+39 333 9988776",
                "email": "elena.bianchi.fittizia@example.it",
                "profession": "Architetto",
                "sport_activity": "Nuoto e Pilates",
                "general_notes": "[ANAGRAFICA FITTIZIA DI TEST] Paziente solo area Fisioterapia.",
                "physio_active": True,
                "fitness_active": False,
                "is_fictitious": True,
            },
        )
        ep_elena = create_physio_episode(
            conn,
            {
                "person_id": elena["id"],
                "title": "Cervicalgia meccanica e dolore periscapolare SX",
                "chief_complaint": "Tensione e dolore cervicale basso con irradiazione al margine mediale scapola SX dopo ore al CAD",
                "body_region": "Rachide Cervicale / Spalla",
                "laterality": "SX",
                "start_date": d_minus_14,
                "reassessment_due_date": d_today,
                "patient_goals": "Lavorare al tavolo da disegno e nuotare a stile libero senza dolore cervicale.",
            },
        )
        save_clinical_note(
            conn,
            {
                "episode_id": ep_elena["id"],
                "note_date": d_today,
                "status": "bozza",
                "subjective_response": "Bozza da completare a fine giornata: riferisce netto miglioramento nella rotazione cervicale SX.",
                "objective_findings": "ROM rotazione SX 75° (era 55°).",
                "interventions_performed": "Mobilizzazione C5-C7 e rinforzo flessori profondi cervicali.",
                "pain_pre": 4,
                "pain_post": 1,
            },
        )
        pkg_elena = create_package(
            conn,
            {
                "person_id": elena["id"],
                "service_area": "fisio",
                "name": "Ciclo 5 Sedute Fisioterapia",
                "total_sessions": 5,
                "price_eur": 300.0,
                "purchased_date": d_minus_14,
                "initial_payment_eur": 150.0,  # Pagamento parziale (150€ da incassare)
                "payment_method": "POS/Carta",
            },
        )
        create_appointment(
            conn,
            {
                "person_id": elena["id"],
                "service_area": "fisio",
                "service_name": "Seduta Fisioterapia + Rivalutazione",
                "episode_id": ep_elena["id"],
                "package_id": pkg_elena["id"],
                "start_at": f"{d_today}T17:30:00",
                "duration_minutes": 60,
                "status": "prenotato",
            },
        )

        # ----------------------------------------------------------------------
        # 3. LUCA VERDI — Cliente solo Fitness (con pacchetto quasi esaurito)
        # ----------------------------------------------------------------------
        luca = create_person(
            conn,
            {
                "first_name": "Luca",
                "last_name": "Verdi",
                "birth_date": "1996-02-18",
                "phone": "+39 349 5544332",
                "email": "luca.verdi.fittizio@example.it",
                "profession": "Ingegnere Informatico",
                "sport_activity": "Tennis agonistico amatoriale",
                "general_notes": "[ANAGRAFICA FITTIZIA DI TEST] Cliente solo area Personal Training.",
                "physio_active": False,
                "fitness_active": True,
                "is_fictitious": True,
            },
        )
        pkg_luca = create_package(
            conn,
            {
                "person_id": luca["id"],
                "service_area": "fitness",
                "name": "Pacchetto 5 Sedute Personal Training",
                "total_sessions": 5,
                "price_eur": 250.0,
                "purchased_date": d_minus_20,
                "initial_payment_eur": 150.0,  # 100€ da incassare
                "payment_method": "Contanti",
            },
        )
        # 4 sedute già svolte -> 1 sola seduta residua (pacchetto quasi esaurito!)
        for offset in [18, 14, 10, 5]:
            day_s = (today - timedelta(days=offset)).isoformat()
            create_appointment(
                conn,
                {
                    "person_id": luca["id"],
                    "service_area": "fitness",
                    "service_name": "Personal Training Tennis Conditioning",
                    "package_id": pkg_luca["id"],
                    "start_at": f"{day_s}T19:00:00",
                    "duration_minutes": 60,
                    "status": "svolto",
                },
            )
    finally:
        conn.close()


if __name__ == "__main__":
    seed_fictitious_data()
    print("Database DEMO inizializzato con dati fittizi di prova.")
