import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.config import ROME_TZ, get_db_path
from backend.security import generate_recovery_codes, generate_totp_secret, hash_password


def now_rome_iso() -> str:
    return datetime.now(ROME_TZ).isoformat(timespec="seconds")


def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or get_db_path()
    conn = sqlite3.connect(str(path), timeout=15.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 10000;")
    return conn


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    recovery_codes_json TEXT NOT NULL DEFAULT '[]',
    settings_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT
);

CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    birth_date TEXT,
    tax_code TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    profession TEXT,
    sport_activity TEXT,
    gender TEXT,
    height_cm INTEGER,
    weight_kg REAL,
    weight_updated_at TEXT,
    medical_history TEXT,
    current_pain_notes TEXT,
    goals TEXT,
    training_frequency TEXT,
    training_location TEXT,
    general_notes TEXT,
    physio_active INTEGER NOT NULL DEFAULT 0,
    fitness_active INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'archiviato')),
    is_fictitious INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_name ON people(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_people_status ON people(status);

CREATE TABLE IF NOT EXISTS physio_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    chief_complaint TEXT NOT NULL,
    body_region TEXT,
    laterality TEXT DEFAULT 'N/A',
    start_date TEXT NOT NULL,
    end_date TEXT,
    reassessment_due_date TEXT,
    status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'in_pausa', 'concluso')),
    patient_goals TEXT,
    therapist_goals TEXT,
    closure_summary TEXT,
    closure_outcome TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shared_limitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    physio_episode_id INTEGER REFERENCES physio_episodes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    body_region TEXT,
    laterality TEXT,
    source_type TEXT NOT NULL DEFAULT 'Valutazione Fisioterapica',
    source_reference TEXT,
    recorded_date TEXT NOT NULL,
    recorded_by TEXT NOT NULL DEFAULT 'Professionista',
    is_active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES physio_episodes(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    eval_type TEXT NOT NULL DEFAULT 'prima_valutazione' CHECK (eval_type IN ('prima_valutazione', 'rivalutazione')),
    eval_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza', 'finalizzata')),
    finalized_at TEXT,
    template_name TEXT DEFAULT 'Standard Muscoloscheletrico',
    consult_reason TEXT,
    patient_goals TEXT,
    important_activities TEXT,
    symptom_onset TEXT,
    symptom_distribution TEXT,
    symptom_behavior TEXT,
    aggravating_factors TEXT,
    easing_factors TEXT,
    pattern_24h TEXT,
    functional_impact TEXT,
    medical_history TEXT,
    surgeries_traumas TEXT,
    associated_conditions TEXT,
    medications TEXT,
    imaging_reports TEXT,
    sleep_quality TEXT,
    work_sport_load TEXT,
    psychosocial_factors TEXT,
    objective_measurements_json TEXT NOT NULL DEFAULT '[]',
    special_tests TEXT,
    clinical_observations TEXT,
    clinical_reasoning TEXT,
    treatment_plan TEXT,
    assigned_exercises_json TEXT NOT NULL DEFAULT '[]',
    home_advice TEXT,
    next_reassessment_date TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS body_map_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL REFERENCES clinical_evaluations(id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES physio_episodes(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    view_side TEXT NOT NULL CHECK (view_side IN ('anterior', 'posterior')),
    marker_kind TEXT NOT NULL DEFAULT 'point' CHECK (marker_kind IN ('point', 'area')),
    x_norm REAL NOT NULL,
    y_norm REAL NOT NULL,
    radius_norm REAL NOT NULL DEFAULT 22.0,
    polygon_json TEXT DEFAULT '[]',
    anatomical_region TEXT NOT NULL,
    laterality TEXT NOT NULL CHECK (laterality IN ('DX', 'SX', 'Centrale', 'Bilaterale')),
    symptom_type TEXT NOT NULL,
    intensity INTEGER NOT NULL CHECK (intensity >= 0 AND intensity <= 10),
    notes TEXT,
    recorded_date TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES physio_episodes(id) ON DELETE CASCADE,
    evaluation_id INTEGER REFERENCES clinical_evaluations(id) ON DELETE SET NULL,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    flag_type TEXT NOT NULL CHECK (flag_type IN ('red', 'yellow')),
    category TEXT NOT NULL,
    item_label TEXT NOT NULL,
    guideline_source TEXT NOT NULL,
    guideline_version TEXT NOT NULL,
    context_of_use TEXT,
    status TEXT NOT NULL DEFAULT 'non_valutato' CHECK (status IN ('presente', 'assente', 'non_valutato')),
    notes TEXT,
    source_info TEXT,
    action_taken TEXT,
    recorded_date TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcome_measures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES physio_episodes(id) ON DELETE CASCADE,
    evaluation_id INTEGER REFERENCES clinical_evaluations(id) ON DELETE SET NULL,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    scale_code TEXT NOT NULL,
    scale_name TEXT NOT NULL,
    scale_version TEXT NOT NULL,
    source_mode TEXT NOT NULL CHECK (source_mode IN ('internal_verified', 'external_score')),
    context_label TEXT,
    responses_json TEXT NOT NULL DEFAULT '[]',
    completed_items INTEGER NOT NULL DEFAULT 1,
    total_items INTEGER NOT NULL DEFAULT 1,
    missing_items INTEGER NOT NULL DEFAULT 0,
    score_value REAL,
    score_unit TEXT NOT NULL DEFAULT 'pt',
    clinical_note TEXT,
    recorded_date TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES physio_episodes(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    appointment_id INTEGER,
    note_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza', 'finalizzata')),
    finalized_at TEXT,
    copied_from_note_id INTEGER REFERENCES clinical_notes(id) ON DELETE SET NULL,
    copied_from_date TEXT,
    subjective_response TEXT,
    objective_findings TEXT,
    interventions_performed TEXT,
    exercises_performed TEXT,
    plan_next_steps TEXT,
    pain_pre INTEGER,
    pain_post INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_note_addenda (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER REFERENCES clinical_notes(id) ON DELETE CASCADE,
    evaluation_id INTEGER REFERENCES clinical_evaluations(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL DEFAULT 'Professionista',
    addendum_text TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fitness_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
    primary_goals TEXT,
    experience_level TEXT DEFAULT 'Intermedio',
    preferences TEXT,
    weekly_availability TEXT,
    available_equipment TEXT,
    general_limitations_note TEXT,
    initial_assessment_notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fitness_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    recorded_date TEXT NOT NULL,
    metric_category TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value_num REAL NOT NULL,
    unit TEXT NOT NULL,
    side TEXT DEFAULT 'N/A',
    protocol_notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fitness_programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    phase_name TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    frequency_per_week INTEGER DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'in_pausa', 'concluso')),
    workouts_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fitness_program_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES fitness_programs(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    workouts_json TEXT NOT NULL,
    notes TEXT,
    change_note TEXT,
    saved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    program_id INTEGER REFERENCES fitness_programs(id) ON DELETE SET NULL,
    program_version INTEGER DEFAULT 1,
    appointment_id INTEGER,
    workout_day_name TEXT NOT NULL,
    session_date TEXT NOT NULL,
    planned_exercises_json TEXT NOT NULL DEFAULT '[]',
    actual_exercises_json TEXT NOT NULL DEFAULT '[]',
    session_rpe REAL,
    duration_minutes INTEGER DEFAULT 60,
    client_feedback TEXT,
    reported_symptoms TEXT,
    symptom_severity INTEGER DEFAULT 0,
    next_session_notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    service_area TEXT NOT NULL CHECK (service_area IN ('fisio', 'fitness', 'misto')),
    name TEXT NOT NULL,
    total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    purchased_date TEXT NOT NULL,
    valid_until TEXT,
    status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'sospeso', 'esaurito', 'scaduto', 'annullato')),
    late_cancel_policy TEXT NOT NULL DEFAULT 'charge' CHECK (late_cancel_policy IN ('charge', 'no_charge', 'manual')),
    no_show_policy TEXT NOT NULL DEFAULT 'charge' CHECK (no_show_policy IN ('charge', 'no_charge', 'manual')),
    suspensions_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS package_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    appointment_id INTEGER,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('CONSUME', 'REVERSAL', 'ADJUSTMENT')),
    delta_sessions INTEGER NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    reversed_movement_id INTEGER REFERENCES package_movements(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'Professionista'
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    appointment_id INTEGER,
    amount_cents INTEGER NOT NULL,
    payment_date TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Bonifico', 'POS/Carta', 'Contanti', 'Satispay/Altro')),
    reference_note TEXT,
    is_refund INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    service_area TEXT NOT NULL CHECK (service_area IN ('fisio', 'fitness')),
    service_name TEXT NOT NULL,
    episode_id INTEGER REFERENCES physio_episodes(id) ON DELETE SET NULL,
    program_id INTEGER REFERENCES fitness_programs(id) ON DELETE SET NULL,
    package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    out_of_package INTEGER NOT NULL DEFAULT 0,
    single_price_cents INTEGER NOT NULL DEFAULT 0,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    buffer_minutes INTEGER NOT NULL DEFAULT 10,
    location TEXT NOT NULL DEFAULT 'Studio Principale',
    status TEXT NOT NULL DEFAULT 'prenotato' CHECK (status IN ('prenotato', 'confermato', 'svolto', 'annullato', 'assente')),
    charge_override TEXT CHECK (charge_override IN ('charge', 'no_charge', NULL)),
    recurrence_group_id TEXT,
    recurrence_rule TEXT,
    is_recurrence_exception INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_person ON appointments(person_id);
CREATE INDEX IF NOT EXISTS idx_appointments_package ON appointments(package_id, status);

CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('informativa_privacy', 'consenso_trattamento_sanitario', 'consenso_comunicazioni', 'altro')),
    doc_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('acquisito', 'revocato', 'in_attesa')),
    signed_date TEXT,
    acquisition_method TEXT NOT NULL DEFAULT 'Modulo cartaceo/digitale firmato',
    revoked_date TEXT,
    attachment_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    episode_id INTEGER REFERENCES physio_episodes(id) ON DELETE SET NULL,
    program_id INTEGER REFERENCES fitness_programs(id) ON DELETE SET NULL,
    evaluation_id INTEGER REFERENCES clinical_evaluations(id) ON DELETE SET NULL,
    category TEXT NOT NULL DEFAULT 'Referto / Allegato Clinico',
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    description TEXT,
    uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_type TEXT NOT NULL CHECK (template_type IN ('physio_eval', 'clinical_flags', 'workout')),
    name TEXT NOT NULL,
    description TEXT,
    schema_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    person_id INTEGER,
    summary TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_person ON audit_logs(person_id, timestamp DESC);
"""


DEFAULT_TEMPLATES = [
    {
        "template_type": "physio_eval",
        "name": "Valutazione Muscoloscheletrica & Sportiva (Standard)",
        "description": "Modello strutturato ICF / IFOMPT con anamnesi sintomatologica, comportamento 24h, carico abituale, esame obiettivo e ragionamento clinico.",
        "schema_json": json.dumps(
            {
                "sections": [
                    "Motivo della consultazione, obiettivi e attività importanti (PSFS)",
                    "Esordio, andamento, distribuzione, fattori aggravanti/allevianti, 24h",
                    "Storia clinica, chirurgia, traumi, farmaci, esami e referti",
                    "Sonno, lavoro, sport, carico abituale e fattori psicosociali",
                    "Esame obiettivo (ROM, forza, test speciali, palpazione/osservazione)",
                    "Ragionamento clinico, piano terapeutico, esercizi e rivalutazione",
                ],
                "default_measurements": [
                    {"name": "Flessione attiva", "unit": "°", "side": "DX"},
                    {"name": "Abduzione attiva", "unit": "°", "side": "DX"},
                    {"name": "Forza isometrica", "unit": "kg", "side": "DX"},
                ],
            },
            ensure_ascii=False,
        ),
    },
    {
        "template_type": "clinical_flags",
        "name": "Checklist Red & Yellow Flags Muscoloscheletriche",
        "description": "Fonti: IFOMPT International Framework for Red Flags (Finucane et al., JOSPT 2020) / NICE NG59; Yellow Flags psicosociali (Kendall et al. / Nicholas et al., Physical Therapy 2011). Personalizzabile dal clinico.",
        "schema_json": json.dumps(
            {
                "disclaimer": "Checklist di supporto alla documentazione clinica. L'assenza di una segnalazione non costituisce diagnosi automatica né conferma automatica di sicurezza o idoneità allo sport.",
                "red_flags": [
                    {
                        "category": "Sistemico / Oncologico",
                        "item_label": "Perdita di peso inspiegata, febbre/brividi notturni, anamnesi oncologica positiva",
                        "guideline_source": "IFOMPT Framework (Finucane et al., JOSPT)",
                        "guideline_version": "2020 v1",
                    },
                    {
                        "category": "Neurologico / Cauda Equina / Mielopatia",
                        "item_label": "Deficit neurologico progressivo, anestesia a sella, disturbi sfinterici o disturbi della marcia",
                        "guideline_source": "IFOMPT Framework / NICE NG59",
                        "guideline_version": "2020",
                    },
                    {
                        "category": "Traumatico / Frattura",
                        "item_label": "Trauma ad alta energia o trauma minore in soggetto con osteoporosi/uso prolungato corticosteroidi",
                        "guideline_source": "IFOMPT Framework / Canadian C-Spine & Ottawa Rules",
                        "guideline_version": "2020",
                    },
                    {
                        "category": "Cardiovascolare / Vascolare",
                        "item_label": "Dolore non meccanico ingravescente, segni di TVP, sincope o dispnea anomala da sforzo",
                        "guideline_source": "IFOMPT Vascular & Systemic Screening",
                        "guideline_version": "2020",
                    },
                ],
                "yellow_flags": [
                    {
                        "category": "Credenze e Catastrofizzazione",
                        "item_label": "Convinzione che il dolore equivalga sempre a danno tissutale o timore marcato del movimento (kinesiofobia)",
                        "guideline_source": "Nicholas et al. / Kendall Yellow Flags Framework",
                        "guideline_version": "2011",
                    },
                    {
                        "category": "Umore, Sonno e Stress",
                        "item_label": "Tono dell'umore deflesso, ansia elevata o disturbo severo del sonno associato al sintomo",
                        "guideline_source": "Kendall et al. Psychosocial Flags",
                        "guideline_version": "2011",
                    },
                    {
                        "category": "Contesto Lavorativo / Sportivo",
                        "item_label": "Pressione eccessiva sul rientro immediato o scarso supporto nell'ambiente lavorativo/sportivo",
                        "guideline_source": "Blue/Yellow Flags Occupational & Sport Context",
                        "guideline_version": "2011",
                    },
                ],
            },
            ensure_ascii=False,
        ),
    },
]


def log_audit(
    conn: sqlite3.Connection,
    action: str,
    entity_type: str,
    entity_id: Optional[int],
    person_id: Optional[int],
    summary: str,
    actor: str = "Professionista",
) -> None:
    conn.execute(
        """
        INSERT INTO audit_logs (timestamp, actor, action, entity_type, entity_id, person_id, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (now_rome_iso(), actor, action, entity_type, entity_id, person_id, summary),
    )


def init_db(db_path: Optional[Path] = None) -> None:
    conn = get_connection(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        # Migrazione incrementale colonne anagrafica/anamnesi per DB SQLite esistenti
        existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(people)").fetchall()}
        for col_name, col_type in [
            ("gender", "TEXT"),
            ("height_cm", "INTEGER"),
            ("weight_kg", "REAL"),
            ("weight_updated_at", "TEXT"),
            ("medical_history", "TEXT"),
            ("current_pain_notes", "TEXT"),
            ("goals", "TEXT"),
            ("training_frequency", "TEXT"),
            ("training_location", "TEXT"),
        ]:
            if col_name not in existing_cols:
                conn.execute(f"ALTER TABLE people ADD COLUMN {col_name} {col_type}")
        now = now_rome_iso()
        # Assicura l'esistenza dell'account personale (registrazione pubblica disabilitata)
        user_row = conn.execute("SELECT id FROM users LIMIT 1").fetchone()
        if not user_row:
            default_pwd = hash_password("FisioFitness2026!")
            totp_secret = generate_totp_secret()
            _, hashed_codes = generate_recovery_codes()
            settings = {
                "studio_name": "Studio Fisio & Performance Personale",
                "practitioner_name": "Dott. Federico Carletti — Fisioterapista & PT",
                "timezone": "Europe/Rome",
                "default_buffer_minutes": 10,
                "default_late_cancel_policy": "charge",
                "default_no_show_policy": "charge",
                "calendar_export_privacy_mode": "initials_only",
            }
            conn.execute(
                """
                INSERT INTO users (username, display_name, password_hash, totp_secret, totp_enabled, recovery_codes_json, settings_json, version, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, ?)
                """,
                (
                    "admin",
                    "Dott. Federico Carletti",
                    default_pwd,
                    totp_secret,
                    json.dumps(hashed_codes),
                    json.dumps(settings, ensure_ascii=False),
                    now,
                    now,
                ),
            )

        # Popola template di default se vuoti
        tmpl_count = conn.execute("SELECT COUNT(*) AS c FROM custom_templates").fetchone()["c"]
        if tmpl_count == 0:
            for t in DEFAULT_TEMPLATES:
                conn.execute(
                    """
                    INSERT INTO custom_templates (template_type, name, description, schema_json, version, updated_at)
                    VALUES (?, ?, ?, ?, 1, ?)
                    """,
                    (t["template_type"], t["name"], t["description"], t["schema_json"], now),
                )
    finally:
        conn.close()
