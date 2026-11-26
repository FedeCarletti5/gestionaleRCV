import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.config import (
    ROME_TZ,
    get_attachments_dir,
    get_backups_dir,
    get_db_path,
    load_or_create_secrets,
)
from backend.db import get_connection, init_db, log_audit, now_rome_iso
from backend.security import decrypt_file_aes256, encrypt_file_aes256


class ValidationError(Exception):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ConflictError(Exception):
    def __init__(self, message: str, server_record: Dict[str, Any]):
        super().__init__(message)
        self.message = message
        self.server_record = server_record


class NotFoundError(Exception):
    pass


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]


def normalize_phone(phone: Optional[str]) -> str:
    if not phone:
        return ""
    return re.sub(r"\D+", "", phone)


def parse_rome_datetime(dt_str: str) -> datetime:
    """Interpreta una stringa ISO o YYYY-MM-DDTHH:MM nel fuso Europe/Rome gestendo correttamente l'ora legale (CET/CEST)."""
    clean = dt_str.strip()
    if clean.endswith("Z"):
        clean = clean[:-1] + "+00:00"
    dt = datetime.fromisoformat(clean)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ROME_TZ)
    else:
        dt = dt.astimezone(ROME_TZ)
    return dt


# ==============================================================================
# 1. ANAGRAFICA UNICA E RILEVAZIONE DUPLICATI
# ==============================================================================

def find_potential_duplicates(
    conn: sqlite3.Connection,
    first_name: str,
    last_name: str,
    birth_date: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    tax_code: Optional[str] = None,
    exclude_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Individua possibili duplicati senza mai unire persone automaticamente.
    Controlla: nome+cognome (case-insensitive), codice fiscale, telefono o email.
    """
    fn = (first_name or "").strip().lower()
    ln = (last_name or "").strip().lower()
    norm_ph = normalize_phone(phone)
    em = (email or "").strip().lower()
    tc = (tax_code or "").strip().upper()

    rows = conn.execute("SELECT * FROM people").fetchall()
    duplicates = []
    for r in rows:
        if exclude_id and r["id"] == exclude_id:
            continue
        reasons = []
        if r["first_name"].strip().lower() == fn and r["last_name"].strip().lower() == ln:
            if birth_date and r["birth_date"] == birth_date:
                reasons.append("Stesso nome, cognome e data di nascita")
            else:
                reasons.append("Omonimia nome e cognome")
        if tc and r["tax_code"] and r["tax_code"].strip().upper() == tc:
            reasons.append("Stesso codice fiscale")
        if norm_ph and len(norm_ph) >= 6 and normalize_phone(r["phone"]) == norm_ph:
            reasons.append("Stesso numero di telefono")
        if em and r["email"] and r["email"].strip().lower() == em:
            reasons.append("Stesso indirizzo email")

        if reasons:
            d = dict(r)
            d["duplicate_reasons"] = reasons
            duplicates.append(d)
    return duplicates


def create_person(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    first_name = (payload.get("first_name") or "").strip()
    last_name = (payload.get("last_name") or "").strip()
    if not first_name or not last_name:
        raise ValidationError("Nome e cognome sono gli unici campi obbligatori per creare l'anagrafica.")

    duplicates = find_potential_duplicates(
        conn,
        first_name=first_name,
        last_name=last_name,
        birth_date=payload.get("birth_date"),
        phone=payload.get("phone"),
        email=payload.get("email"),
        tax_code=payload.get("tax_code"),
    )
    if duplicates and not payload.get("confirm_duplicate_override"):
        raise ValidationError(
            "Possibile anagrafica duplicata rilevata. Verifica le persone segnalate oppure conferma la creazione.",
            {"potential_duplicates": duplicates},
        )

    now = now_rome_iso()
    physio_active = 1 if payload.get("physio_active") else 0
    fitness_active = 1 if payload.get("fitness_active") else 0
    status = payload.get("status") or "attivo"
    if status not in ("attivo", "archiviato"):
        status = "attivo"

    def _parse_int(val):
        if val is None or str(val).strip() == "":
            return None
        try:
            return int(float(str(val).replace(",", ".").strip()))
        except ValueError:
            return None

    def _parse_float(val):
        if val is None or str(val).strip() == "":
            return None
        try:
            return round(float(str(val).replace(",", ".").strip()), 2)
        except ValueError:
            return None

    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO people (
                first_name, last_name, birth_date, tax_code, phone, email, address,
                profession, sport_activity, gender, height_cm, weight_kg, weight_updated_at,
                medical_history, current_pain_notes, goals, training_frequency, training_location,
                general_notes, prior_sessions_count, physio_active, fitness_active,
                status, is_fictitious, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                first_name,
                last_name,
                (payload.get("birth_date") or "").strip() or None,
                (payload.get("tax_code") or "").strip().upper() or None,
                (payload.get("phone") or "").strip() or None,
                (payload.get("email") or "").strip() or None,
                (payload.get("address") or "").strip() or None,
                (payload.get("profession") or "").strip() or None,
                (payload.get("sport_activity") or "").strip() or None,
                (payload.get("gender") or "").strip() or None,
                _parse_int(payload.get("height_cm")),
                _parse_float(payload.get("weight_kg")),
                (payload.get("weight_updated_at") or "").strip() or (now[:10] if _parse_float(payload.get("weight_kg")) is not None else None),
                (payload.get("medical_history") or "").strip() or None,
                (payload.get("current_pain_notes") or "").strip() or None,
                (payload.get("goals") or "").strip() or None,
                (payload.get("training_frequency") or "").strip() or None,
                (payload.get("training_location") or "").strip() or None,
                (payload.get("general_notes") or "").strip() or None,
                max(0, _parse_int(payload.get("prior_sessions_count")) or 0),
                physio_active,
                fitness_active,
                status,
                1 if payload.get("is_fictitious", True) else 0,
                now,
                now,
            ),
        )
        person_id = cur.lastrowid

        if fitness_active:
            conn.execute(
                """
                INSERT OR IGNORE INTO fitness_profiles (person_id, primary_goals, experience_level, version, created_at, updated_at)
                VALUES (?, ?, 'Intermedio', 1, ?, ?)
                """,
                (person_id, payload.get("fitness_initial_goal") or "", now, now),
            )

        log_audit(
            conn,
            "CREATE_PERSON",
            "people",
            person_id,
            person_id,
            f"Creata anagrafica unica {first_name} {last_name} (Fisio={bool(physio_active)}, Fitness={bool(fitness_active)})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    person = row_to_dict(conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone())
    person["potential_duplicates"] = duplicates
    return person


def update_person(
    conn: sqlite3.Connection, person_id: int, payload: Dict[str, Any], actor: str = "Professionista"
) -> Dict[str, Any]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        current = row_to_dict(conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone())
        if not current:
            conn.rollback()
            raise NotFoundError("Persona non trovata.")

        expected_version = payload.get("expected_version")
        if expected_version is not None and int(expected_version) != int(current["version"]):
            conn.rollback()
            raise ConflictError(
                "La scheda anagrafica è stata modificata da un altro dispositivo o sessione.",
                current,
            )

        first_name = (payload.get("first_name", current["first_name"]) or "").strip()
        last_name = (payload.get("last_name", current["last_name"]) or "").strip()
        if not first_name or not last_name:
            conn.rollback()
            raise ValidationError("Nome e cognome sono obbligatori.")

        physio_active = int(bool(payload.get("physio_active", current["physio_active"])))
        fitness_active = int(bool(payload.get("fitness_active", current["fitness_active"])))
        status = payload.get("status", current["status"])
        if status not in ("attivo", "archiviato"):
            status = current["status"]

        now = now_rome_iso()
        new_version = int(current["version"]) + 1

        def _parse_int_opt(val, fallback):
            if val is None:
                return fallback
            if str(val).strip() == "":
                return None
            try:
                return int(float(str(val).replace(",", ".").strip()))
            except ValueError:
                return fallback

        def _parse_float_opt(val, fallback):
            if val is None:
                return fallback
            if str(val).strip() == "":
                return None
            try:
                return round(float(str(val).replace(",", ".").strip()), 2)
            except ValueError:
                return fallback

        new_height = _parse_int_opt(payload.get("height_cm"), current.get("height_cm")) if "height_cm" in payload else current.get("height_cm")
        new_weight = _parse_float_opt(payload.get("weight_kg"), current.get("weight_kg")) if "weight_kg" in payload else current.get("weight_kg")
        new_prior_sessions = (
            max(0, _parse_int_opt(payload.get("prior_sessions_count"), int(current.get("prior_sessions_count") or 0)) or 0)
            if "prior_sessions_count" in payload
            else int(current.get("prior_sessions_count") or 0)
        )
        if "weight_updated_at" in payload:
            new_weight_updated = (payload.get("weight_updated_at") or "").strip() or None
        elif "weight_kg" in payload and new_weight != current.get("weight_kg") and new_weight is not None:
            new_weight_updated = now[:10]
        else:
            new_weight_updated = current.get("weight_updated_at")

        conn.execute(
            """
            UPDATE people SET
                first_name = ?, last_name = ?, birth_date = ?, tax_code = ?,
                phone = ?, email = ?, address = ?, profession = ?,
                sport_activity = ?, gender = ?, height_cm = ?, weight_kg = ?,
                weight_updated_at = ?, medical_history = ?, current_pain_notes = ?,
                goals = ?, training_frequency = ?, training_location = ?,
                general_notes = ?, prior_sessions_count = ?, physio_active = ?,
                fitness_active = ?, status = ?, version = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                first_name,
                last_name,
                payload.get("birth_date", current["birth_date"]),
                payload.get("tax_code", current["tax_code"]),
                payload.get("phone", current["phone"]),
                payload.get("email", current["email"]),
                payload.get("address", current["address"]),
                payload.get("profession", current["profession"]),
                payload.get("sport_activity", current["sport_activity"]),
                payload.get("gender", current.get("gender")),
                new_height,
                new_weight,
                new_weight_updated,
                payload.get("medical_history", current.get("medical_history")),
                payload.get("current_pain_notes", current.get("current_pain_notes")),
                payload.get("goals", current.get("goals")),
                payload.get("training_frequency", current.get("training_frequency")),
                payload.get("training_location", current.get("training_location")),
                payload.get("general_notes", current["general_notes"]),
                new_prior_sessions,
                physio_active,
                fitness_active,
                status,
                new_version,
                now,
                person_id,
            ),
        )

        # Se viene attivata l'area fitness, inizializza il profilo fitness (senza copiare la cartella clinica)
        if fitness_active and not current["fitness_active"]:
            conn.execute(
                """
                INSERT OR IGNORE INTO fitness_profiles (person_id, primary_goals, experience_level, version, created_at, updated_at)
                VALUES (?, '', 'Intermedio', 1, ?, ?)
                """,
                (person_id, now, now),
            )

        log_audit(
            conn,
            "UPDATE_PERSON",
            "people",
            person_id,
            person_id,
            f"Aggiornata anagrafica (v{new_version}, Fisio={bool(physio_active)}, Fitness={bool(fitness_active)}, Stato={status})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return row_to_dict(conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone())


# ==============================================================================
# 2. PACCHETTI, SALDI SEDUTE, SALDI ECONOMICI, CONSUMI IDEMPOTENTI E STORNI
# ==============================================================================

def compute_package_summary(conn: sqlite3.Connection, pkg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calcola in modo rigoroso e separato:
    - total_sessions (Acquistate)
    - consumed_sessions (Consumate: somma algebrica di package_movements)
    - remaining_sessions (Residue = Acquistate - Consumate)
    - reserved_sessions (Prenotate/Riservate = appuntamenti 'prenotato' o 'confermato' su questo pacchetto)
    - available_to_book (Disponibili per nuove prenotazioni = Residue - Prenotate)
    - Saldo economico (price_cents, paid_cents, due_cents, payment_status) distinto dal saldo sedute.
    """
    pkg_id = pkg["id"]
    mov_row = conn.execute(
        "SELECT COALESCE(SUM(delta_sessions), 0) AS consumed FROM package_movements WHERE package_id = ?",
        (pkg_id,),
    ).fetchone()
    consumed = int(mov_row["consumed"] if mov_row else 0)

    res_row = conn.execute(
        """
        SELECT COUNT(*) AS reserved
        FROM appointments
        WHERE package_id = ? AND out_of_package = 0 AND status IN ('prenotato', 'confermato')
        """,
        (pkg_id,),
    ).fetchone()
    reserved = int(res_row["reserved"] if res_row else 0)

    total = int(pkg["total_sessions"])
    is_open_single = total == 0
    remaining = 0 if is_open_single else max(0, total - consumed)
    available_to_book = 0 if is_open_single else max(0, remaining - reserved)

    pay_row = conn.execute(
        """
        SELECT COALESCE(SUM(CASE WHEN is_refund = 1 THEN -amount_cents ELSE amount_cents END), 0) AS paid
        FROM payments
        WHERE package_id = ?
        """,
        (pkg_id,),
    ).fetchone()
    paid_cents = int(pay_row["paid"] if pay_row else 0)
    price_cents = int(pkg["price_cents"])
    due_cents = max(0, price_cents - paid_cents)

    if price_cents == 0 or due_cents == 0:
        payment_status = "saldato"
    elif paid_cents > 0:
        payment_status = "parziale"
    else:
        payment_status = "non_pagato"

    movements = rows_to_list(
        conn.execute(
            "SELECT * FROM package_movements WHERE package_id = ? ORDER BY id DESC",
            (pkg_id,),
        ).fetchall()
    )
    payments = rows_to_list(
        conn.execute(
            "SELECT * FROM payments WHERE package_id = ? ORDER BY payment_date DESC, id DESC",
            (pkg_id,),
        ).fetchall()
    )

    result = dict(pkg)
    result.update(
        {
            "total_sessions": total,
            "is_open_single": is_open_single,
            "consumed_sessions": consumed,
            "remaining_sessions": remaining,
            "reserved_sessions": reserved,
            "available_to_book": available_to_book,
            "paid_cents": paid_cents,
            "due_cents": due_cents,
            "payment_status": payment_status,
            "suspensions": json.loads(pkg.get("suspensions_json") or "[]"),
            "movements": movements,
            "payments": payments,
        }
    )
    return result


def create_package(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    person_id = int(payload["person_id"])
    total_sessions = int(payload["total_sessions"])
    price_cents = int(round(float(payload.get("price_eur", payload.get("price_cents", 0) / 100.0)) * 100))
    if "price_cents" in payload and "price_eur" not in payload:
        price_cents = int(payload["price_cents"])

    if total_sessions < 0:
        raise ValidationError("Il numero di sedute del pacchetto non può essere negativo.")
    if price_cents < 0:
        raise ValidationError("Il prezzo non può essere negativo.")

    service_area = payload.get("service_area") or "fisio"
    if service_area not in ("fisio", "fitness", "misto"):
        raise ValidationError("Area di servizio non valida.")

    now = now_rome_iso()
    purchased_date = payload.get("purchased_date") or now[:10]
    valid_until = (payload.get("valid_until") or "").strip() or None
    default_name = (
        f"Sedute singole ({service_area.capitalize()})"
        if total_sessions == 0
        else f"Pacchetto {total_sessions} sedute ({service_area.capitalize()})"
    )
    name = (payload.get("name") or default_name).strip()

    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO packages (
                person_id, service_area, name, total_sessions, price_cents,
                purchased_date, valid_until, status, late_cancel_policy, no_show_policy,
                suspensions_json, notes, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'attivo', ?, ?, '[]', ?, 1, ?, ?)
            """,
            (
                person_id,
                service_area,
                name,
                total_sessions,
                price_cents,
                purchased_date,
                valid_until,
                payload.get("late_cancel_policy") or "charge",
                payload.get("no_show_policy") or "charge",
                payload.get("notes") or "",
                now,
                now,
            ),
        )
        pkg_id = cur.lastrowid

        initial_sessions = max(0, min(50, int(payload.get("initial_sessions") or 0)))
        if initial_sessions > 0 and (total_sessions == 0 or initial_sessions <= total_sessions):
            init_ts = f"{purchased_date}T{now[11:]}" if len(purchased_date) == 10 and purchased_date[4] == "-" else now
            for idx in range(initial_sessions):
                conn.execute(
                    """
                    INSERT INTO package_movements (
                        package_id, person_id, appointment_id, movement_type, delta_sessions,
                        reason, idempotency_key, reversed_movement_id, created_at, created_by
                    ) VALUES (?, ?, NULL, 'CONSUME', 1, ?, ?, NULL, ?, ?)
                    """,
                    (
                        pkg_id,
                        person_id,
                        "Seduta singola svolta" if total_sessions == 0 else "Seduta svolta",
                        f"init_{pkg_id}_{idx}_{secrets.token_hex(5)}",
                        init_ts,
                        actor,
                    ),
                )
            if total_sessions > 0 and initial_sessions >= total_sessions:
                conn.execute("UPDATE packages SET status = 'esaurito', updated_at = ? WHERE id = ?", (now, pkg_id))

        initial_payment_cents = int(round(float(payload.get("initial_payment_eur", 0)) * 100))
        if "initial_payment_cents" in payload:
            initial_payment_cents = int(payload["initial_payment_cents"])
        if initial_payment_cents > 0:
            conn.execute(
                """
                INSERT INTO payments (
                    person_id, package_id, amount_cents, payment_date, payment_method, reference_note, is_refund, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    person_id,
                    pkg_id,
                    initial_payment_cents,
                    purchased_date,
                    payload.get("payment_method") or "POS/Carta",
                    payload.get("payment_note") or "Pagamento all'acquisto pacchetto",
                    now,
                ),
            )

        log_audit(
            conn,
            "CREATE_PACKAGE",
            "packages",
            pkg_id,
            person_id,
            f"Creato pacchetto '{name}' da {total_sessions} sedute (€ {price_cents / 100:.2f})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    pkg_row = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (pkg_id,)).fetchone())
    return compute_package_summary(conn, pkg_row)


def record_manual_package_movement(
    conn: sqlite3.Connection,
    package_id: int,
    payload: Dict[str, Any],
    actor: str = "Professionista",
) -> Dict[str, Any]:
    pkg = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())
    if not pkg:
        raise NotFoundError("Pacchetto non trovato.")
    summary = compute_package_summary(conn, pkg)
    is_open_single = int(pkg["total_sessions"]) == 0
    action = str(payload.get("action") or "consume").lower()
    now = now_rome_iso()
    session_date = (payload.get("session_date") or "").strip()
    mov_ts = f"{session_date}T{now[11:]}" if len(session_date) == 10 and session_date[4] == "-" else now
    idem_key = f"manual_{package_id}_{secrets.token_hex(6)}"

    if action == "consume":
        if not is_open_single and summary["remaining_sessions"] <= 0:
            raise ValidationError("Nessuna seduta rimanente su questo pacchetto.")
        mov_type, delta = "CONSUME", 1
        reason = (payload.get("reason") or ("Seduta singola svolta" if is_open_single else "Seduta svolta")).strip()
        audit_act = "CONSUME_PACKAGE_SESSION"
        audit_msg = (
            f"Registrata +1 seduta singola su '{pkg['name']}' ({reason})"
            if is_open_single
            else f"Scalata 1 seduta da '{pkg['name']}' ({reason})"
        )
    elif action in ("undo", "reversal"):
        if summary["consumed_sessions"] <= 0:
            raise ValidationError("Nessuna seduta svolta da ripristinare su questo pacchetto.")
        mov_type, delta = "REVERSAL", -1
        reason = (payload.get("reason") or ("Rimozione seduta singola" if is_open_single else "Ripristino seduta")).strip()
        audit_act, audit_msg = "UNDO_PACKAGE_SESSION", f"Ripristinata 1 seduta su '{pkg['name']}' ({reason})"
    else:
        raise ValidationError("Azione movimento non valida.")

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO package_movements (
                package_id, person_id, appointment_id, movement_type, delta_sessions,
                reason, idempotency_key, reversed_movement_id, created_at, created_by
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
            """,
            (package_id, pkg["person_id"], mov_type, delta, reason, idem_key, mov_ts, actor),
        )
        if not is_open_single and pkg["status"] in ("attivo", "esaurito"):
            new_rem = summary["remaining_sessions"] - delta
            next_status = "esaurito" if new_rem <= 0 else "attivo"
            if next_status != pkg["status"]:
                conn.execute("UPDATE packages SET status = ?, updated_at = ? WHERE id = ?", (next_status, now, package_id))
        log_audit(conn, audit_act, "packages", package_id, pkg["person_id"], audit_msg, actor=actor)
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    fresh = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())
    return compute_package_summary(conn, fresh)


def convert_package(
    conn: sqlite3.Connection,
    package_id: int,
    payload: Dict[str, Any],
    actor: str = "Professionista",
) -> Dict[str, Any]:
    pkg = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())
    if not pkg:
        raise NotFoundError("Pacchetto non trovato.")
    summary = compute_package_summary(conn, pkg)
    target_total = int(payload.get("total_sessions") or 0)
    if target_total <= 0:
        raise ValidationError("Il numero di sedute del pacchetto deve essere maggiore di zero.")
    if target_total < summary["consumed_sessions"]:
        raise ValidationError(
            f"Il pacchetto scelto ({target_total} sedute) è inferiore alle {summary['consumed_sessions']} sedute già svolte."
        )
    new_area = payload.get("service_area") or pkg["service_area"]
    if new_area not in ("fisio", "fitness", "misto"):
        new_area = pkg["service_area"]
    new_name = (payload.get("name") or f"Pacchetto {target_total} sedute").strip()
    new_valid_until = (
        ((payload.get("valid_until") or "").strip() or None)
        if "valid_until" in payload
        else pkg.get("valid_until")
    )
    new_notes = str(payload.get("notes") or "").strip() if "notes" in payload else (pkg.get("notes") or "")
    now = now_rome_iso()
    next_status = "esaurito" if target_total <= summary["consumed_sessions"] else "attivo"

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            UPDATE packages SET
                service_area = ?,
                name = ?,
                total_sessions = ?,
                valid_until = ?,
                notes = ?,
                status = ?,
                version = version + 1,
                updated_at = ?
            WHERE id = ?
            """,
            (new_area, new_name, target_total, new_valid_until, new_notes, next_status, now, package_id),
        )
        log_audit(
            conn,
            "CONVERT_PACKAGE",
            "packages",
            package_id,
            pkg["person_id"],
            f"Convertito '{pkg['name']}' ({summary['consumed_sessions']} svolte) in '{new_name}' ({target_total - summary['consumed_sessions']} rimanenti)",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    fresh = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())
    return compute_package_summary(conn, fresh)


def delete_package(conn: sqlite3.Connection, package_id: int, actor: str = "Professionista") -> Dict[str, Any]:
    pkg = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())
    if not pkg:
        raise NotFoundError("Pacchetto non trovato.")
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM packages WHERE id = ?", (package_id,))
        log_audit(conn, "DELETE_PACKAGE", "packages", package_id, pkg["person_id"], f"Eliminato pacchetto '{pkg['name']}'", actor=actor)
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    return {"deleted": True, "id": package_id}


def record_payment(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    person_id = int(payload["person_id"])
    package_id = int(payload["package_id"]) if payload.get("package_id") else None
    appointment_id = int(payload["appointment_id"]) if payload.get("appointment_id") else None
    if "amount_cents" in payload:
        amount_cents = int(payload["amount_cents"])
    else:
        amount_cents = int(round(float(payload.get("amount_eur", 0)) * 100))

    if amount_cents <= 0:
        raise ValidationError("L'importo del pagamento deve essere maggiore di zero.")

    method = payload.get("payment_method") or "POS/Carta"
    if method not in ("Bonifico", "POS/Carta", "Contanti", "Satispay/Altro"):
        raise ValidationError("Metodo di pagamento non supportato.")

    now = now_rome_iso()
    payment_date = payload.get("payment_date") or now[:10]
    is_refund = 1 if payload.get("is_refund") else 0

    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO payments (
                person_id, package_id, appointment_id, amount_cents, payment_date,
                payment_method, reference_note, is_refund, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                person_id,
                package_id,
                appointment_id,
                amount_cents,
                payment_date,
                method,
                payload.get("reference_note") or "",
                is_refund,
                now,
            ),
        )
        pay_id = cur.lastrowid
        log_audit(
            conn,
            "RECORD_PAYMENT",
            "payments",
            pay_id,
            person_id,
            f"Registrato {'rimborso' if is_refund else 'pagamento'} di € {amount_cents / 100:.2f} ({method})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return row_to_dict(conn.execute("SELECT * FROM payments WHERE id = ?", (pay_id,)).fetchone())


def _get_active_consumption_for_appointment(
    conn: sqlite3.Connection, package_id: int, appointment_id: int
) -> Optional[Dict[str, Any]]:
    """
    Verifica se per questo appuntamento esiste già un movimento CONSUME non stornato.
    Garantisce che doppi clic, retry o aggiornamenti ripetuti non scalino MAI due volte.
    """
    consumes = conn.execute(
        """
        SELECT * FROM package_movements
        WHERE package_id = ? AND appointment_id = ? AND movement_type = 'CONSUME'
        ORDER BY id DESC
        """,
        (package_id, appointment_id),
    ).fetchall()
    for c in consumes:
        rev = conn.execute(
            "SELECT id FROM package_movements WHERE reversed_movement_id = ? AND movement_type = 'REVERSAL'",
            (c["id"],),
        ).fetchone()
        if not rev:
            return dict(c)
    return None


def _should_appointment_consume_session(
    appt_status: str,
    charge_override: Optional[str],
    pkg_row: Optional[Dict[str, Any]],
) -> bool:
    if appt_status == "svolto":
        return True
    if appt_status in ("prenotato", "confermato"):
        return False
    if charge_override == "charge":
        return True
    if charge_override == "no_charge":
        return False
    if not pkg_row:
        return False
    if appt_status == "annullato":
        return pkg_row.get("late_cancel_policy") == "charge" and False  # Default: annullamento standard non scala, salvo override esplicito 'charge' per disdetta tardiva
    if appt_status == "assente":
        return pkg_row.get("no_show_policy") == "charge"
    return False


def _sync_package_status(conn: sqlite3.Connection, package_id: int) -> None:
    pkg = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())
    if not pkg or int(pkg["total_sessions"]) == 0:
        return
    summary = compute_package_summary(conn, pkg)
    new_status = pkg["status"]
    if pkg["status"] in ("attivo", "esaurito"):
        if summary["remaining_sessions"] <= 0:
            new_status = "esaurito"
        else:
            new_status = "attivo"
    if new_status != pkg["status"]:
        conn.execute(
            "UPDATE packages SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now_rome_iso(), package_id),
        )


# ==============================================================================
# 3. AGENDA, RICORRENZE, BUFFER/CONFLITTI E GESTIONE STATO SEDUTA IDEMPOTENTE
# ==============================================================================

def detect_appointment_conflicts(
    conn: sqlite3.Connection,
    start_at: str,
    end_at: str,
    buffer_minutes: int = 10,
    exclude_appointment_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Rileva sovrapposizioni dirette o violazioni del tempo di buffer tra appuntamenti attivi.
    """
    s_dt = parse_rome_datetime(start_at)
    e_dt = parse_rome_datetime(end_at)
    day_prefix = s_dt.strftime("%Y-%m-%d")

    candidates = conn.execute(
        """
        SELECT a.*, p.first_name, p.last_name
        FROM appointments a
        JOIN people p ON p.id = a.person_id
        WHERE substr(a.start_at, 1, 10) = ? AND a.status NOT IN ('annullato')
        """,
        (day_prefix,),
    ).fetchall()

    conflicts = []
    for c in candidates:
        if exclude_appointment_id and c["id"] == exclude_appointment_id:
            continue
        cs = parse_rome_datetime(c["start_at"])
        ce = parse_rome_datetime(c["end_at"])
        c_buf = max(buffer_minutes, int(c["buffer_minutes"] or 0))
        buf_delta = timedelta(minutes=c_buf)

        if s_dt < ce and e_dt > cs:
            conflicts.append(
                {
                    "appointment_id": c["id"],
                    "person_name": f"{c['first_name']} {c['last_name']}",
                    "start_at": c["start_at"],
                    "end_at": c["end_at"],
                    "conflict_type": "overlap",
                    "message": f"Sovrapposizione oraria con {c['first_name']} {c['last_name']} ({cs.strftime('%H:%M')}-{ce.strftime('%H:%M')})",
                }
            )
        elif s_dt < (ce + buf_delta) and e_dt > (cs - buf_delta):
            conflicts.append(
                {
                    "appointment_id": c["id"],
                    "person_name": f"{c['first_name']} {c['last_name']}",
                    "start_at": c["start_at"],
                    "end_at": c["end_at"],
                    "conflict_type": "buffer",
                    "message": f"Buffer inferiore a {c_buf} min rispetto a {c['first_name']} {c['last_name']} ({cs.strftime('%H:%M')}-{ce.strftime('%H:%M')})",
                }
            )
    return conflicts


def create_appointment(
    conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista"
) -> Dict[str, Any]:
    person_id = int(payload["person_id"])
    service_area = payload.get("service_area") or "fisio"
    if service_area not in ("fisio", "fitness"):
        raise ValidationError("L'area dell'appuntamento deve essere 'fisio' o 'fitness'.")

    service_name = (payload.get("service_name") or ("Seduta Fisioterapia" if service_area == "fisio" else "Seduta Personal Training")).strip()
    duration_minutes = int(payload.get("duration_minutes") or 60)
    buffer_minutes = int(payload.get("buffer_minutes", 10))
    start_dt = parse_rome_datetime(payload["start_at"])
    if payload.get("end_at"):
        end_dt = parse_rome_datetime(payload["end_at"])
    else:
        end_dt = start_dt + timedelta(minutes=duration_minutes)

    package_id = int(payload["package_id"]) if payload.get("package_id") else None
    out_of_package = 1 if payload.get("out_of_package") else (0 if package_id else 1)
    status = payload.get("status") or "prenotato"
    if status not in ("prenotato", "confermato", "svolto", "annullato", "assente"):
        raise ValidationError("Stato appuntamento non valido.")

    recurrence_count = int(payload.get("recurrence_count") or 1)
    recurrence_interval_days = int(payload.get("recurrence_interval_days") or 7)
    if recurrence_count < 1 or recurrence_count > 52:
        raise ValidationError("Numero di occorrenze ricorrenti non valido (1-52).")

    recurrence_group_id = f"rec_{secrets.token_hex(6)}" if recurrence_count > 1 else None
    recurrence_rule = f"FREQ=DAYS;INTERVAL={recurrence_interval_days};COUNT={recurrence_count}" if recurrence_count > 1 else None

    conn.execute("BEGIN IMMEDIATE")
    try:
        pkg_row = None
        if package_id and not out_of_package:
            pkg_row = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone())
            if not pkg_row:
                conn.rollback()
                raise ValidationError("Pacchetto selezionato non trovato.")
            if pkg_row["person_id"] != person_id:
                conn.rollback()
                raise ValidationError("Il pacchetto non appartiene alla persona selezionata.")
            if pkg_row["status"] in ("sospeso", "annullato", "scaduto"):
                conn.rollback()
                raise ValidationError(f"Il pacchetto selezionato è in stato '{pkg_row['status']}' e non può essere usato.")

            summary = compute_package_summary(conn, pkg_row)
            if summary["available_to_book"] < recurrence_count:
                conn.rollback()
                raise ValidationError(
                    f"Capienza pacchetto insufficiente: disponibili per prenotazione {summary['available_to_book']} sedute "
                    f"(Residue: {summary['remaining_sessions']}, già Prenotate: {summary['reserved_sessions']}), richieste {recurrence_count}. "
                    "Seleziona un altro pacchetto o registra come 'Fuori pacchetto'."
                )

        created_ids = []
        all_conflicts = []
        now = now_rome_iso()

        for idx in range(recurrence_count):
            occ_start = start_dt + timedelta(days=idx * recurrence_interval_days)
            occ_end = end_dt + timedelta(days=idx * recurrence_interval_days)
            s_iso = occ_start.isoformat(timespec="seconds")
            e_iso = occ_end.isoformat(timespec="seconds")

            conflicts = detect_appointment_conflicts(conn, s_iso, e_iso, buffer_minutes=buffer_minutes)
            all_conflicts.extend(conflicts)

            cur = conn.execute(
                """
                INSERT INTO appointments (
                    person_id, service_area, service_name, episode_id, program_id,
                    package_id, out_of_package, single_price_cents, start_at, end_at,
                    duration_minutes, buffer_minutes, location, status, charge_override,
                    recurrence_group_id, recurrence_rule, is_recurrence_exception, notes,
                    version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)
                """,
                (
                    person_id,
                    service_area,
                    service_name,
                    payload.get("episode_id") or None,
                    payload.get("program_id") or None,
                    package_id if not out_of_package else None,
                    out_of_package,
                    int(round(float(payload.get("single_price_eur", 0)) * 100)),
                    s_iso,
                    e_iso,
                    duration_minutes,
                    buffer_minutes,
                    payload.get("location") or "Studio Principale",
                    status if idx == 0 else "prenotato",
                    payload.get("charge_override"),
                    recurrence_group_id,
                    recurrence_rule,
                    payload.get("notes") or "",
                    now,
                    now,
                ),
            )
            appt_id = cur.lastrowid
            created_ids.append(appt_id)

            # Se il primo appuntamento nasce già come 'svolto', applica consumo idempotente
            if idx == 0 and package_id and not out_of_package:
                if _should_appointment_consume_session(status, payload.get("charge_override"), pkg_row):
                    idem_key = payload.get("idempotency_key") or f"consume_appt_{appt_id}_v1"
                    conn.execute(
                        """
                        INSERT INTO package_movements (
                            package_id, person_id, appointment_id, movement_type,
                            delta_sessions, reason, idempotency_key, created_at, created_by
                        ) VALUES (?, ?, ?, 'CONSUME', 1, ?, ?, ?, ?)
                        """,
                        (
                            package_id,
                            person_id,
                            appt_id,
                            f"Seduta registrata come {status} ({s_iso[:10]})",
                            idem_key,
                            now,
                            actor,
                        ),
                    )
                    _sync_package_status(conn, package_id)

        log_audit(
            conn,
            "CREATE_APPOINTMENT",
            "appointments",
            created_ids[0],
            person_id,
            f"Creato appuntamento {service_name} il {start_dt.strftime('%d/%m/%Y %H:%M')} (occorrenze={recurrence_count})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    first_appt = row_to_dict(
        conn.execute(
            """
            SELECT a.*, p.first_name, p.last_name
            FROM appointments a JOIN people p ON p.id = a.person_id
            WHERE a.id = ?
            """,
            (created_ids[0],),
        ).fetchone()
    )
    first_appt["created_appointment_ids"] = created_ids
    first_appt["conflicts"] = all_conflicts
    return first_appt


def update_appointment_or_status(
    conn: sqlite3.Connection,
    appointment_id: int,
    payload: Dict[str, Any],
    actor: str = "Professionista",
) -> Dict[str, Any]:
    """
    Gestisce:
    - Spostamento data/ora (non consuma mai una seconda seduta; marca is_recurrence_exception=1 se faceva parte di una serie).
    - Transizione di stato (es. 'prenotato' -> 'svolto') con idempotenza rigorosa:
      doppi clic o chiamate ripetute con stato 'svolto' o stessa idempotency_key producono UN SOLO movimento.
    - Correzione di stato (es. da 'svolto' a 'prenotato' o 'annullato' non addebitato):
      genera uno storno tracciato (REVERSAL, delta_sessions = -1) collegato al movimento originario.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        current = row_to_dict(conn.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,)).fetchone())
        if not current:
            conn.rollback()
            raise NotFoundError("Appuntamento non trovato.")

        new_status = payload.get("status", current["status"])
        new_charge_override = payload.get("charge_override", current["charge_override"])
        new_package_id = int(payload["package_id"]) if "package_id" in payload and payload["package_id"] else current["package_id"]
        if "out_of_package" in payload:
            new_out_of_package = 1 if payload["out_of_package"] else 0
        else:
            new_out_of_package = current["out_of_package"]

        if new_out_of_package:
            new_package_id = None

        # Se è un doppio clic identico sullo stato 'svolto' (anche senza expected_version aggiornata),
        # verifichiamo prima l'idempotenza: se stato è già 'svolto' e non ci sono modifiche ad altri campi,
        # restituiamo il record senza errore né doppio addebito.
        only_status_call = set(payload.keys()).issubset({"status", "charge_override", "idempotency_key", "expected_version"})
        if (
            only_status_call
            and new_status == current["status"]
            and new_charge_override == current["charge_override"]
        ):
            conn.commit()
            res = row_to_dict(
                conn.execute(
                    "SELECT a.*, p.first_name, p.last_name FROM appointments a JOIN people p ON p.id = a.person_id WHERE a.id = ?",
                    (appointment_id,),
                ).fetchone()
            )
            res["idempotent_noop"] = True
            return res

        expected_version = payload.get("expected_version")
        if expected_version is not None and int(expected_version) != int(current["version"]):
            conn.rollback()
            raise ConflictError(
                "L'appuntamento è stato modificato da un altro dispositivo.",
                current,
            )

        start_dt = parse_rome_datetime(payload.get("start_at") or current["start_at"])
        duration_minutes = int(payload.get("duration_minutes") or current["duration_minutes"] or 60)
        if payload.get("end_at"):
            end_dt = parse_rome_datetime(payload["end_at"])
        elif "start_at" in payload or "duration_minutes" in payload:
            end_dt = start_dt + timedelta(minutes=duration_minutes)
        else:
            end_dt = parse_rome_datetime(current["end_at"])

        s_iso = start_dt.isoformat(timespec="seconds")
        e_iso = end_dt.isoformat(timespec="seconds")
        buffer_minutes = int(payload.get("buffer_minutes", current["buffer_minutes"] or 10))

        is_recurrence_exception = current["is_recurrence_exception"]
        if current["recurrence_group_id"] and (s_iso != current["start_at"] or e_iso != current["end_at"]):
            is_recurrence_exception = 1

        now = now_rome_iso()
        old_pkg_id = current["package_id"] if not current["out_of_package"] else None

        # Se cambia pacchetto o stato, gestiamo il ledger dei movimenti
        if old_pkg_id and old_pkg_id != new_package_id:
            active_mov = _get_active_consumption_for_appointment(conn, old_pkg_id, appointment_id)
            if active_mov:
                rev_key = f"rev_mov_{active_mov['id']}"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO package_movements (
                        package_id, person_id, appointment_id, movement_type,
                        delta_sessions, reason, idempotency_key, reversed_movement_id, created_at, created_by
                    ) VALUES (?, ?, ?, 'REVERSAL', -1, ?, ?, ?, ?, ?)
                    """,
                    (
                        old_pkg_id,
                        current["person_id"],
                        appointment_id,
                        f"Storno per cambio pacchetto sull'appuntamento #{appointment_id}",
                        rev_key,
                        active_mov["id"],
                        now,
                        actor,
                    ),
                )
                _sync_package_status(conn, old_pkg_id)

        pkg_row = None
        if new_package_id and not new_out_of_package:
            pkg_row = row_to_dict(conn.execute("SELECT * FROM packages WHERE id = ?", (new_package_id,)).fetchone())
            if not pkg_row:
                conn.rollback()
                raise ValidationError("Pacchetto selezionato non trovato.")

            active_mov = _get_active_consumption_for_appointment(conn, new_package_id, appointment_id)
            should_consume = _should_appointment_consume_session(new_status, new_charge_override, pkg_row)

            # Verifica capienza se l'appuntamento non occupava già un posto in questo pacchetto
            was_occupying_slot = (
                old_pkg_id == new_package_id
                and (current["status"] in ("prenotato", "confermato") or active_mov is not None)
            )
            will_occupy_slot = new_status in ("prenotato", "confermato") or should_consume
            if will_occupy_slot and not was_occupying_slot:
                summary = compute_package_summary(conn, pkg_row)
                if summary["available_to_book"] < 1:
                    conn.rollback()
                    raise ValidationError(
                        "Il pacchetto non ha sedute disponibili (Residue esaurite o tutte già riservate da altre prenotazioni)."
                    )

            if should_consume and not active_mov:
                # Registra consumo idempotente
                idem_key = payload.get("idempotency_key") or f"consume_appt_{appointment_id}_mov_{secrets.token_hex(4)}"
                # Verifica se questa idempotency_key è già stata usata
                existing_by_key = conn.execute(
                    "SELECT * FROM package_movements WHERE idempotency_key = ?", (idem_key,)
                ).fetchone()
                if not existing_by_key:
                    reason_label = (
                        f"Seduta svolta ({s_iso[:10]})"
                        if new_status == "svolto"
                        else f"Addebito per stato '{new_status}' ({s_iso[:10]})"
                    )
                    conn.execute(
                        """
                        INSERT INTO package_movements (
                            package_id, person_id, appointment_id, movement_type,
                            delta_sessions, reason, idempotency_key, created_at, created_by
                        ) VALUES (?, ?, ?, 'CONSUME', 1, ?, ?, ?, ?)
                        """,
                        (
                            new_package_id,
                            current["person_id"],
                            appointment_id,
                            reason_label,
                            idem_key,
                            now,
                            actor,
                        ),
                    )
            elif not should_consume and active_mov:
                # Genera storno tracciato (REVERSAL)
                rev_key = f"rev_mov_{active_mov['id']}"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO package_movements (
                        package_id, person_id, appointment_id, movement_type,
                        delta_sessions, reason, idempotency_key, reversed_movement_id, created_at, created_by
                    ) VALUES (?, ?, ?, 'REVERSAL', -1, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_package_id,
                        current["person_id"],
                        appointment_id,
                        payload.get("reversal_reason") or f"Storno per passaggio stato a '{new_status}' su appuntamento #{appointment_id}",
                        rev_key,
                        active_mov["id"],
                        now,
                        actor,
                    ),
                )

        new_version = int(current["version"]) + 1
        conn.execute(
            """
            UPDATE appointments SET
                service_area = ?, service_name = ?, episode_id = ?, program_id = ?,
                package_id = ?, out_of_package = ?, start_at = ?, end_at = ?,
                duration_minutes = ?, buffer_minutes = ?, location = ?,
                status = ?, charge_override = ?, is_recurrence_exception = ?,
                notes = ?, version = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                payload.get("service_area", current["service_area"]),
                payload.get("service_name", current["service_name"]),
                payload.get("episode_id", current["episode_id"]),
                payload.get("program_id", current["program_id"]),
                new_package_id,
                new_out_of_package,
                s_iso,
                e_iso,
                duration_minutes,
                buffer_minutes,
                payload.get("location", current["location"]),
                new_status,
                new_charge_override,
                is_recurrence_exception,
                payload.get("notes", current["notes"]),
                new_version,
                now,
                appointment_id,
            ),
        )

        if new_package_id:
            _sync_package_status(conn, new_package_id)

        log_audit(
            conn,
            "UPDATE_APPOINTMENT",
            "appointments",
            appointment_id,
            current["person_id"],
            f"Aggiornato appuntamento #{appointment_id}: stato={new_status}, inizio={s_iso}",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    updated = row_to_dict(
        conn.execute(
            "SELECT a.*, p.first_name, p.last_name FROM appointments a JOIN people p ON p.id = a.person_id WHERE a.id = ?",
            (appointment_id,),
        ).fetchone()
    )
    updated["conflicts"] = detect_appointment_conflicts(
        conn, updated["start_at"], updated["end_at"], buffer_minutes=updated["buffer_minutes"], exclude_appointment_id=appointment_id
    )
    return updated


# ==============================================================================
# 4. AREA FISIOTERAPIA: EPISODI, VALUTAZIONI, BODY MAP, FLAGS, SCALE E NOTE SOAP
# ==============================================================================

def create_physio_episode(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    person_id = int(payload["person_id"])
    title = (payload.get("title") or "").strip()
    chief_complaint = (payload.get("chief_complaint") or "").strip()
    if not title:
        raise ValidationError("Il titolo dell'episodio clinico è obbligatorio.")

    now = now_rome_iso()
    start_date = payload.get("start_date") or now[:10]

    conn.execute("BEGIN IMMEDIATE")
    try:
        # Attiva automaticamente il flag physio_active sulla persona senza duplicarla
        conn.execute("UPDATE people SET physio_active = 1, updated_at = ? WHERE id = ?", (now, person_id))

        cur = conn.execute(
            """
            INSERT INTO physio_episodes (
                person_id, title, chief_complaint, body_region, laterality,
                start_date, end_date, reassessment_due_date, status,
                patient_goals, therapist_goals, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                person_id,
                title,
                chief_complaint,
                payload.get("body_region") or "",
                payload.get("laterality") or "N/A",
                start_date,
                payload.get("end_date") or None,
                payload.get("reassessment_due_date") or None,
                payload.get("status") or "attivo",
                payload.get("patient_goals") or "",
                payload.get("therapist_goals") or "",
                now,
                now,
            ),
        )
        ep_id = cur.lastrowid

        # Inizializza la checklist di Red e Yellow Flags in stato 'non_valutato' se richiesto
        if payload.get("init_default_flags", True):
            tmpl = conn.execute(
                "SELECT schema_json FROM custom_templates WHERE template_type = 'clinical_flags' LIMIT 1"
            ).fetchone()
            if tmpl:
                schema = json.loads(tmpl["schema_json"])
                for rf in schema.get("red_flags", []):
                    conn.execute(
                        """
                        INSERT INTO clinical_flags (
                            episode_id, person_id, flag_type, category, item_label,
                            guideline_source, guideline_version, status, recorded_date, version, created_at, updated_at
                        ) VALUES (?, ?, 'red', ?, ?, ?, ?, 'non_valutato', ?, 1, ?, ?)
                        """,
                        (
                            ep_id,
                            person_id,
                            rf["category"],
                            rf["item_label"],
                            rf["guideline_source"],
                            rf["guideline_version"],
                            start_date,
                            now,
                            now,
                        ),
                    )
                for yf in schema.get("yellow_flags", []):
                    conn.execute(
                        """
                        INSERT INTO clinical_flags (
                            episode_id, person_id, flag_type, category, item_label,
                            guideline_source, guideline_version, status, recorded_date, version, created_at, updated_at
                        ) VALUES (?, ?, 'yellow', ?, ?, ?, ?, 'non_valutato', ?, 1, ?, ?)
                        """,
                        (
                            ep_id,
                            person_id,
                            yf["category"],
                            yf["item_label"],
                            yf["guideline_source"],
                            yf["guideline_version"],
                            start_date,
                            now,
                            now,
                        ),
                    )

        log_audit(
            conn,
            "CREATE_PHYSIO_EPISODE",
            "physio_episodes",
            ep_id,
            person_id,
            f"Aperto episodio fisioterapico '{title}'",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return get_physio_episode_detail(conn, ep_id)


def update_physio_episode(
    conn: sqlite3.Connection, episode_id: int, payload: Dict[str, Any], actor: str = "Professionista"
) -> Dict[str, Any]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        current = row_to_dict(conn.execute("SELECT * FROM physio_episodes WHERE id = ?", (episode_id,)).fetchone())
        if not current:
            conn.rollback()
            raise NotFoundError("Episodio clinico non trovato.")

        expected_version = payload.get("expected_version")
        if expected_version is not None and int(expected_version) != int(current["version"]):
            conn.rollback()
            raise ConflictError("L'episodio clinico è stato modificato da un altro dispositivo.", current)

        now = now_rome_iso()
        new_version = int(current["version"]) + 1
        new_status = payload.get("status", current["status"])
        end_date = payload.get("end_date", current["end_date"])
        if new_status == "concluso" and not end_date:
            end_date = now[:10]

        conn.execute(
            """
            UPDATE physio_episodes SET
                title = ?, chief_complaint = ?, body_region = ?, laterality = ?,
                start_date = ?, end_date = ?, reassessment_due_date = ?, status = ?,
                patient_goals = ?, therapist_goals = ?, closure_summary = ?,
                closure_outcome = ?, version = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                payload.get("title", current["title"]),
                payload.get("chief_complaint", current["chief_complaint"]),
                payload.get("body_region", current["body_region"]),
                payload.get("laterality", current["laterality"]),
                payload.get("start_date", current["start_date"]),
                end_date,
                payload.get("reassessment_due_date", current["reassessment_due_date"]),
                new_status,
                payload.get("patient_goals", current["patient_goals"]),
                payload.get("therapist_goals", current["therapist_goals"]),
                payload.get("closure_summary", current["closure_summary"]),
                payload.get("closure_outcome", current["closure_outcome"]),
                new_version,
                now,
                episode_id,
            ),
        )
        log_audit(
            conn,
            "UPDATE_PHYSIO_EPISODE",
            "physio_episodes",
            episode_id,
            current["person_id"],
            f"Aggiornato episodio clinico #{episode_id} (stato={new_status}, v{new_version})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return get_physio_episode_detail(conn, episode_id)


def save_clinical_evaluation(
    conn: sqlite3.Connection,
    payload: Dict[str, Any],
    evaluation_id: Optional[int] = None,
    actor: str = "Professionista",
) -> Dict[str, Any]:
    """
    Crea o aggiorna una Prima Valutazione o una Rivalutazione (conservando le precedenti).
    Gestisce i marcatori della Mappa del Dolore 2D (body_map_markers) associati alla valutazione.
    Dopo la finalizzazione ('finalizzata'), il contenuto originale diventa immutabile.
    """
    now = now_rome_iso()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if evaluation_id:
            current = row_to_dict(
                conn.execute("SELECT * FROM clinical_evaluations WHERE id = ?", (evaluation_id,)).fetchone()
            )
            if not current:
                conn.rollback()
                raise NotFoundError("Valutazione clinica non trovata.")
            if current["status"] == "finalizzata":
                conn.rollback()
                raise ValidationError(
                    "Questa valutazione è già stata finalizzata ed è immutabile. Usa la funzione 'Aggiungi Rettifica/Integrazione datata' o registra una nuova Rivalutazione."
                )
            expected_version = payload.get("expected_version")
            if expected_version is not None and int(expected_version) != int(current["version"]):
                conn.rollback()
                raise ConflictError("La valutazione è stata modificata da un altro dispositivo.", current)

            new_status = payload.get("status", current["status"])
            finalized_at = now if new_status == "finalizzata" else None
            new_version = int(current["version"]) + 1

            obj_meas = payload.get("objective_measurements")
            if obj_meas is not None:
                obj_meas_json = json.dumps(obj_meas, ensure_ascii=False)
            else:
                obj_meas_json = current["objective_measurements_json"]

            ass_ex = payload.get("assigned_exercises")
            if ass_ex is not None:
                ass_ex_json = json.dumps(ass_ex, ensure_ascii=False)
            else:
                ass_ex_json = current["assigned_exercises_json"]

            conn.execute(
                """
                UPDATE clinical_evaluations SET
                    eval_type = ?, eval_date = ?, status = ?, finalized_at = ?,
                    consult_reason = ?, patient_goals = ?, important_activities = ?,
                    symptom_onset = ?, symptom_distribution = ?, symptom_behavior = ?,
                    aggravating_factors = ?, easing_factors = ?, pattern_24h = ?,
                    functional_impact = ?, medical_history = ?, surgeries_traumas = ?,
                    associated_conditions = ?, medications = ?, imaging_reports = ?,
                    sleep_quality = ?, work_sport_load = ?, psychosocial_factors = ?,
                    objective_measurements_json = ?, special_tests = ?, clinical_observations = ?,
                    clinical_reasoning = ?, treatment_plan = ?, assigned_exercises_json = ?,
                    home_advice = ?, next_reassessment_date = ?, version = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload.get("eval_type", current["eval_type"]),
                    payload.get("eval_date", current["eval_date"]),
                    new_status,
                    finalized_at,
                    payload.get("consult_reason", current["consult_reason"]),
                    payload.get("patient_goals", current["patient_goals"]),
                    payload.get("important_activities", current["important_activities"]),
                    payload.get("symptom_onset", current["symptom_onset"]),
                    payload.get("symptom_distribution", current["symptom_distribution"]),
                    payload.get("symptom_behavior", current["symptom_behavior"]),
                    payload.get("aggravating_factors", current["aggravating_factors"]),
                    payload.get("easing_factors", current["easing_factors"]),
                    payload.get("pattern_24h", current["pattern_24h"]),
                    payload.get("functional_impact", current["functional_impact"]),
                    payload.get("medical_history", current["medical_history"]),
                    payload.get("surgeries_traumas", current["surgeries_traumas"]),
                    payload.get("associated_conditions", current["associated_conditions"]),
                    payload.get("medications", current["medications"]),
                    payload.get("imaging_reports", current["imaging_reports"]),
                    payload.get("sleep_quality", current["sleep_quality"]),
                    payload.get("work_sport_load", current["work_sport_load"]),
                    payload.get("psychosocial_factors", current["psychosocial_factors"]),
                    obj_meas_json,
                    payload.get("special_tests", current["special_tests"]),
                    payload.get("clinical_observations", current["clinical_observations"]),
                    payload.get("clinical_reasoning", current["clinical_reasoning"]),
                    payload.get("treatment_plan", current["treatment_plan"]),
                    ass_ex_json,
                    payload.get("home_advice", current["home_advice"]),
                    payload.get("next_reassessment_date", current["next_reassessment_date"]),
                    new_version,
                    now,
                    evaluation_id,
                ),
            )
            person_id = current["person_id"]
            episode_id = current["episode_id"]
            eval_date = payload.get("eval_date", current["eval_date"])
        else:
            episode_id = int(payload["episode_id"])
            ep = row_to_dict(conn.execute("SELECT * FROM physio_episodes WHERE id = ?", (episode_id,)).fetchone())
            if not ep:
                conn.rollback()
                raise NotFoundError("Episodio clinico non trovato.")
            person_id = ep["person_id"]
            eval_type = payload.get("eval_type") or "prima_valutazione"
            eval_date = payload.get("eval_date") or now[:10]
            new_status = payload.get("status") or "bozza"
            finalized_at = now if new_status == "finalizzata" else None

            obj_meas_json = json.dumps(payload.get("objective_measurements") or [], ensure_ascii=False)
            ass_ex_json = json.dumps(payload.get("assigned_exercises") or [], ensure_ascii=False)

            cur = conn.execute(
                """
                INSERT INTO clinical_evaluations (
                    episode_id, person_id, eval_type, eval_date, status, finalized_at,
                    consult_reason, patient_goals, important_activities,
                    symptom_onset, symptom_distribution, symptom_behavior,
                    aggravating_factors, easing_factors, pattern_24h,
                    functional_impact, medical_history, surgeries_traumas,
                    associated_conditions, medications, imaging_reports,
                    sleep_quality, work_sport_load, psychosocial_factors,
                    objective_measurements_json, special_tests, clinical_observations,
                    clinical_reasoning, treatment_plan, assigned_exercises_json,
                    home_advice, next_reassessment_date, version, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
                )
                """,
                (
                    episode_id,
                    person_id,
                    eval_type,
                    eval_date,
                    new_status,
                    finalized_at,
                    payload.get("consult_reason") or "",
                    payload.get("patient_goals") or "",
                    payload.get("important_activities") or "",
                    payload.get("symptom_onset") or "",
                    payload.get("symptom_distribution") or "",
                    payload.get("symptom_behavior") or "",
                    payload.get("aggravating_factors") or "",
                    payload.get("easing_factors") or "",
                    payload.get("pattern_24h") or "",
                    payload.get("functional_impact") or "",
                    payload.get("medical_history") or "",
                    payload.get("surgeries_traumas") or "",
                    payload.get("associated_conditions") or "",
                    payload.get("medications") or "",
                    payload.get("imaging_reports") or "",
                    payload.get("sleep_quality") or "",
                    payload.get("work_sport_load") or "",
                    payload.get("psychosocial_factors") or "",
                    obj_meas_json,
                    payload.get("special_tests") or "",
                    payload.get("clinical_observations") or "",
                    payload.get("clinical_reasoning") or "",
                    payload.get("treatment_plan") or "",
                    ass_ex_json,
                    payload.get("home_advice") or "",
                    payload.get("next_reassessment_date") or None,
                    now,
                    now,
                ),
            )
            evaluation_id = cur.lastrowid

        # Se è specificata una data di prossima rivalutazione, aggiorna l'episodio clinico
        if payload.get("next_reassessment_date"):
            conn.execute(
                "UPDATE physio_episodes SET reassessment_due_date = ?, updated_at = ? WHERE id = ?",
                (payload["next_reassessment_date"], now, episode_id),
            )

        # Salvataggio marcatori Mappa del Dolore 2D se inclusi nel payload
        if "body_map_markers" in payload and isinstance(payload["body_map_markers"], list):
            conn.execute("DELETE FROM body_map_markers WHERE evaluation_id = ?", (evaluation_id,))
            for m in payload["body_map_markers"]:
                view_side = m.get("view_side") or "anterior"
                if view_side not in ("anterior", "posterior"):
                    view_side = "anterior"
                marker_kind = m.get("marker_kind") or "point"
                if marker_kind not in ("point", "area"):
                    marker_kind = "point"
                laterality = m.get("laterality") or "Centrale"
                if laterality not in ("DX", "SX", "Centrale", "Bilaterale"):
                    laterality = "Centrale"
                intensity = max(0, min(10, int(m.get("intensity", 5))))
                conn.execute(
                    """
                    INSERT INTO body_map_markers (
                        evaluation_id, episode_id, person_id, view_side, marker_kind,
                        x_norm, y_norm, radius_norm, polygon_json, anatomical_region,
                        laterality, symptom_type, intensity, notes, recorded_date, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        evaluation_id,
                        episode_id,
                        person_id,
                        view_side,
                        marker_kind,
                        float(m.get("x_norm", 500.0)),
                        float(m.get("y_norm", 300.0)),
                        float(m.get("radius_norm", 24.0 if marker_kind == "point" else 55.0)),
                        json.dumps(m.get("polygon") or [], ensure_ascii=False),
                        (m.get("anatomical_region") or "Regione indicata").strip(),
                        laterality,
                        (m.get("symptom_type") or "Dolore acuto").strip(),
                        intensity,
                        (m.get("notes") or "").strip(),
                        m.get("recorded_date") or eval_date,
                        now,
                    ),
                )

        log_audit(
            conn,
            "SAVE_CLINICAL_EVALUATION",
            "clinical_evaluations",
            evaluation_id,
            person_id,
            f"Salvata valutazione clinica #{evaluation_id} ({payload.get('eval_type', 'valutazione')}, stato={new_status})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return get_evaluation_with_details(conn, evaluation_id)


def get_evaluation_with_details(conn: sqlite3.Connection, evaluation_id: int) -> Dict[str, Any]:
    ev = row_to_dict(conn.execute("SELECT * FROM clinical_evaluations WHERE id = ?", (evaluation_id,)).fetchone())
    if not ev:
        raise NotFoundError("Valutazione non trovata.")
    ev["objective_measurements"] = json.loads(ev.get("objective_measurements_json") or "[]")
    ev["assigned_exercises"] = json.loads(ev.get("assigned_exercises_json") or "[]")
    ev["body_map_markers"] = rows_to_list(
        conn.execute("SELECT * FROM body_map_markers WHERE evaluation_id = ? ORDER BY id ASC", (evaluation_id,)).fetchall()
    )
    ev["addenda"] = rows_to_list(
        conn.execute(
            "SELECT * FROM clinical_note_addenda WHERE evaluation_id = ? ORDER BY id ASC", (evaluation_id,)
        ).fetchall()
    )
    return ev


def save_clinical_flag(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    now = now_rome_iso()
    flag_id = payload.get("id")
    status = payload.get("status") or "non_valutato"
    if status not in ("presente", "assente", "non_valutato"):
        raise ValidationError("Lo stato della flag deve essere 'presente', 'assente' o 'non_valutato'.")

    conn.execute("BEGIN IMMEDIATE")
    try:
        if flag_id:
            curr = row_to_dict(conn.execute("SELECT * FROM clinical_flags WHERE id = ?", (flag_id,)).fetchone())
            if not curr:
                conn.rollback()
                raise NotFoundError("Flag clinica non trovata.")
            new_v = int(curr["version"]) + 1
            conn.execute(
                """
                UPDATE clinical_flags SET
                    status = ?, notes = ?, source_info = ?, action_taken = ?,
                    recorded_date = ?, version = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    payload.get("notes", curr["notes"]),
                    payload.get("source_info", curr["source_info"]),
                    payload.get("action_taken", curr["action_taken"]),
                    payload.get("recorded_date") or now[:10],
                    new_v,
                    now,
                    flag_id,
                ),
            )
            person_id = curr["person_id"]
        else:
            episode_id = int(payload["episode_id"])
            ep = row_to_dict(conn.execute("SELECT * FROM physio_episodes WHERE id = ?", (episode_id,)).fetchone())
            if not ep:
                conn.rollback()
                raise NotFoundError("Episodio non trovato.")
            person_id = ep["person_id"]
            flag_type = payload.get("flag_type") or "red"
            if flag_type not in ("red", "yellow"):
                raise ValidationError("Tipo flag non valido ('red' o 'yellow').")

            cur = conn.execute(
                """
                INSERT INTO clinical_flags (
                    episode_id, evaluation_id, person_id, flag_type, category, item_label,
                    guideline_source, guideline_version, context_of_use, status,
                    notes, source_info, action_taken, recorded_date, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    episode_id,
                    payload.get("evaluation_id") or None,
                    person_id,
                    flag_type,
                    (payload.get("category") or "Clinica").strip(),
                    (payload.get("item_label") or "").strip(),
                    (payload.get("guideline_source") or "Valutazione Clinica Professionista").strip(),
                    (payload.get("guideline_version") or "2020").strip(),
                    payload.get("context_of_use") or "Screening muscoloscheletrico",
                    status,
                    payload.get("notes") or "",
                    payload.get("source_info") or "Anamnesi / Esame obiettivo",
                    payload.get("action_taken") or "",
                    payload.get("recorded_date") or now[:10],
                    now,
                    now,
                ),
            )
            flag_id = cur.lastrowid

        log_audit(
            conn,
            "SAVE_CLINICAL_FLAG",
            "clinical_flags",
            flag_id,
            person_id,
            f"Aggiornata flag #{flag_id}: stato={status}",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return row_to_dict(conn.execute("SELECT * FROM clinical_flags WHERE id = ?", (flag_id,)).fetchone())


# ==============================================================================
# 4.2 SCALE E MISURE DI ESITO (CON VERIFICA VERSIONE E DATI MANCANTI != 0)
# ==============================================================================

OUTCOME_SCALES_CATALOG = {
    "PCS": {
        "scale_code": "PCS",
        "scale_name": "Pain Catastrophizing Scale (PCS-I)",
        "scale_version": "PCS-I 13 item (0-52)",
        "source_mode": "internal_verified",
        "score_unit": "/52",
        "description": "Scala italiana di catastrofizzazione del dolore (13 item, 0-4; sottoscale: Ruminazione, Amplificazione, Impotenza; soglia clinica >= 30).",
    },
    "TSK-13": {
        "scale_code": "TSK-13",
        "scale_name": "Tampa Scale of Kinesiophobia (TSK-I 13 item)",
        "scale_version": "TSK-I 13 item (Monticone 2010, 13-52)",
        "source_mode": "internal_verified",
        "score_unit": "/52",
        "description": "Scala italiana di kinesiofobia a 13 item (1-4; sottoscale: Evitamento attività, Focus somatico/Danno; fasce Neblett 2016: 13-22 subclinica, 23-32 lieve, 33-42 moderata, 43-52 severa).",
    },
    "NPRS": {
        "scale_code": "NPRS",
        "scale_name": "Numeric Pain Rating Scale (Intensità del Dolore 0-10)",
        "scale_version": "NPRS-11 IT (0-10)",
        "source_mode": "internal_verified",
        "score_unit": "/10",
        "description": "Scala numerica unidimensionale dell'intensità del dolore (0 = nessun dolore, 10 = peggior dolore immaginabile). Pubblico dominio clinico ( Jensen / Farrar et al.).",
    },
    "PSFS": {
        "scale_code": "PSFS",
        "scale_name": "Patient-Specific Functional Scale (Funzione Specifica del Paziente)",
        "scale_version": "PSFS IT v1 (Stratford et al. 1995)",
        "source_mode": "internal_verified",
        "score_unit": "/10",
        "description": "Il paziente indica da 1 a 5 attività importanti limitate dal problema (0 = incapace di eseguire, 10 = capace come prima dell'esordio). Il punteggio è la media aritmetica dei soli item compilati (un item non valutato è null, mai 0).",
    },
    "SANE": {
        "scale_code": "SANE",
        "scale_name": "Single Assessment Numeric Evaluation (Funzione Globale 0-100%)",
        "scale_version": "SANE IT v1 (0-100%)",
        "source_mode": "internal_verified",
        "score_unit": "%",
        "description": "Valutazione numerica singola della funzionalità percepita del distretto da 0% a 100%.",
    },
    "QuickDASH": {
        "scale_code": "QuickDASH",
        "scale_name": "QuickDASH (Arto Superiore - Punteggio Esterno)",
        "scale_version": "QuickDASH IT Official (IWH)",
        "source_mode": "external_score",
        "score_unit": "/100",
        "description": "Registrazione punteggio calcolato su modulo ufficiale Institute for Work & Health (richiede almeno 10 su 11 risposte valide). Non ricalcolato arbitrariamente.",
    },
    "ODI": {
        "scale_code": "ODI",
        "scale_name": "Oswestry Disability Index (Rachide Lombare - Punteggio Esterno)",
        "scale_version": "ODI v2.1a IT (Fairbank & Pynsent)",
        "source_mode": "external_score",
        "score_unit": "%",
        "description": "Registrazione punteggio ottenuto da questionario ufficiale ODI v2.1a IT.",
    },
    "NDI": {
        "scale_code": "NDI",
        "scale_name": "Neck Disability Index (Rachide Cervicale - Punteggio Esterno)",
        "scale_version": "NDI IT (Vernon & Mior)",
        "source_mode": "external_score",
        "score_unit": "%",
        "description": "Registrazione punteggio ottenuto da questionario ufficiale NDI IT.",
    },
    "LEFS": {
        "scale_code": "LEFS",
        "scale_name": "Lower Extremity Functional Scale (Arto Inferiore - Punteggio Esterno)",
        "scale_version": "LEFS IT (Binkley et al. / Cacchio et al.)",
        "source_mode": "external_score",
        "score_unit": "/80",
        "description": "Registrazione punteggio ottenuto da questionario ufficiale LEFS IT (0-80).",
    },
}


def record_outcome_measure(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    episode_id = int(payload["episode_id"])
    ep = row_to_dict(conn.execute("SELECT * FROM physio_episodes WHERE id = ?", (episode_id,)).fetchone())
    if not ep:
        raise NotFoundError("Episodio clinico non trovato.")

    scale_code = (payload.get("scale_code") or "NPRS").strip()
    catalog_entry = OUTCOME_SCALES_CATALOG.get(scale_code)
    scale_name = (payload.get("scale_name") or (catalog_entry["scale_name"] if catalog_entry else scale_code)).strip()
    scale_version = (payload.get("scale_version") or (catalog_entry["scale_version"] if catalog_entry else "v1")).strip()
    source_mode = payload.get("source_mode") or (catalog_entry["source_mode"] if catalog_entry else "external_score")
    score_unit = payload.get("score_unit") or (catalog_entry["score_unit"] if catalog_entry else "pt")

    responses = payload.get("responses") or []
    completed_items = 0
    total_items = 0
    missing_items = 0
    score_value: Optional[float] = None

    if scale_code == "NPRS" and source_mode == "internal_verified":
        raw_val = payload.get("score_value")
        if raw_val is None or raw_val == "":
            raise ValidationError("Inserisci un valore numerico da 0 a 10 per la scala NPRS (un dato mancante non viene salvato come zero).")
        val = float(raw_val)
        if val < 0 or val > 10:
            raise ValidationError("Il punteggio NPRS deve essere compreso tra 0 e 10.")
        score_value = round(val, 1)
        completed_items = 1
        total_items = 1
        missing_items = 0
    elif scale_code == "PSFS" and source_mode == "internal_verified":
        # Per PSFS ogni item ha {"activity": "...", "score": number | null}
        # Un dato mancante (score None o "") NON equivale a zero!
        if not responses or not isinstance(responses, list):
            raise ValidationError("Inserisci almeno un'attività specifica del paziente per la scala PSFS.")
        valid_scores = []
        cleaned_responses = []
        for item in responses:
            act = (item.get("activity") or "").strip()
            if not act:
                continue
            total_items += 1
            raw_s = item.get("score")
            if raw_s is None or raw_s == "":
                missing_items += 1
                cleaned_responses.append({"activity": act, "score": None})
            else:
                s_val = float(raw_s)
                if s_val < 0 or s_val > 10:
                    raise ValidationError(f"Il punteggio per l'attività '{act}' deve essere tra 0 e 10.")
                completed_items += 1
                valid_scores.append(s_val)
                cleaned_responses.append({"activity": act, "score": s_val})
        if completed_items == 0:
            raise ValidationError("Almeno un'attività PSFS deve avere un punteggio numerico valido (i dati mancanti non sono considerati zero).")
        responses = cleaned_responses
        score_value = round(sum(valid_scores) / len(valid_scores), 2)
    elif scale_code == "SANE" and source_mode == "internal_verified":
        raw_val = payload.get("score_value")
        if raw_val is None or raw_val == "":
            raise ValidationError("Inserisci una percentuale valida (0-100) per la scala SANE.")
        val = float(raw_val)
        if val < 0 or val > 100:
            raise ValidationError("Il valore SANE deve essere compreso tra 0 e 100%.")
        score_value = round(val, 1)
        completed_items = 1
        total_items = 1
        missing_items = 0
    elif scale_code in ("PCS", "TSK-13"):
        min_item = 0 if scale_code == "PCS" else 1
        max_item = 4
        min_total = 0 if scale_code == "PCS" else 13
        max_total = 52
        if isinstance(responses, list) and len(responses) > 0:
            cleaned = []
            total_sum = 0.0
            total_items = len(responses)
            for idx, it in enumerate(responses):
                raw_s = it.get("score") if isinstance(it, dict) else None
                if raw_s is None or raw_s == "":
                    missing_items += 1
                    cleaned.append({"item": int(it.get("item") or idx + 1), "subscale": it.get("subscale") or "", "text": it.get("text") or "", "score": None})
                else:
                    s_val = float(raw_s)
                    if s_val < min_item or s_val > max_item:
                        raise ValidationError(f"Punteggio item #{idx + 1} non valido per {scale_code} ({min_item}-{max_item}).")
                    completed_items += 1
                    total_sum += s_val
                    cleaned.append({"item": int(it.get("item") or idx + 1), "subscale": it.get("subscale") or "", "text": it.get("text") or "", "score": s_val})
            if completed_items == 0:
                raise ValidationError(f"Inserisci almeno una risposta valida per {scale_code}.")
            responses = cleaned
            score_value = round(total_sum, 2)
            source_mode = "external_score" if payload.get("source_mode") == "external_score" else "internal_verified"
        else:
            raw_val = payload.get("score_value")
            if raw_val is None or raw_val == "":
                raise ValidationError(f"Inserisci il punteggio totale per {scale_code} ({min_total}-{max_total}).")
            val = float(raw_val)
            if val < min_total or val > max_total:
                raise ValidationError(f"Il punteggio {scale_code} deve essere compreso tra {min_total} e {max_total}.")
            score_value = round(val, 2)
            total_items = int(payload.get("total_items") or 13)
            missing_items = int(payload.get("missing_items") or 0)
            completed_items = max(0, total_items - missing_items)
            source_mode = "external_score"
    else:
        # Punteggio registrato esternamente (QuickDASH, ODI, NDI, LEFS o scala custom)
        source_mode = "external_score"
        raw_val = payload.get("score_value")
        if raw_val is None or raw_val == "":
            raise ValidationError("Per registrare una misura esterna è necessario inserire il punteggio calcolato (un dato mancante non equivale a zero).")
        score_value = round(float(raw_val), 2)
        total_items = int(payload.get("total_items") or 1)
        missing_items = int(payload.get("missing_items") or 0)
        completed_items = max(0, total_items - missing_items)

    now = now_rome_iso()
    recorded_date = payload.get("recorded_date") or now[:10]

    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO outcome_measures (
                episode_id, evaluation_id, person_id, scale_code, scale_name, scale_version,
                source_mode, context_label, responses_json, completed_items, total_items,
                missing_items, score_value, score_unit, clinical_note, recorded_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                episode_id,
                payload.get("evaluation_id") or None,
                ep["person_id"],
                scale_code,
                scale_name,
                scale_version,
                source_mode,
                payload.get("context_label") or "Rilevazione clinica",
                json.dumps(responses, ensure_ascii=False),
                completed_items,
                total_items,
                missing_items,
                score_value,
                score_unit,
                payload.get("clinical_note") or "",
                recorded_date,
                now,
            ),
        )
        om_id = cur.lastrowid
        log_audit(
            conn,
            "RECORD_OUTCOME_MEASURE",
            "outcome_measures",
            om_id,
            ep["person_id"],
            f"Registrata misura {scale_code} ({scale_version}): {score_value}{score_unit}",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    row = row_to_dict(conn.execute("SELECT * FROM outcome_measures WHERE id = ?", (om_id,)).fetchone())
    row["responses"] = json.loads(row.get("responses_json") or "[]")
    return row


def delete_outcome_measure(conn: sqlite3.Connection, om_id: int, actor: str = "Professionista") -> Dict[str, Any]:
    existing = row_to_dict(conn.execute("SELECT * FROM outcome_measures WHERE id = ?", (om_id,)).fetchone())
    if not existing:
        raise NotFoundError("Scala di esito non trovata.")
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM outcome_measures WHERE id = ?", (om_id,))
        log_audit(
            conn,
            "DELETE_OUTCOME_MEASURE",
            "outcome_measures",
            om_id,
            existing["person_id"],
            f"Eliminata rilevazione {existing['scale_code']} ({existing['recorded_date']})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    return {"deleted": True, "id": om_id}


def save_clinical_note(
    conn: sqlite3.Connection,
    payload: Dict[str, Any],
    note_id: Optional[int] = None,
    actor: str = "Professionista",
) -> Dict[str, Any]:
    """
    Salva una nota di seduta (SOAP) in bozza o finalizzata.
    Permette di richiamare una nota precedente come bozza conservando `copied_from_note_id` e `copied_from_date`.
    Una nota finalizzata è immutabile (eventuali precisazioni avvengono tramite rettifiche datate).
    """
    now = now_rome_iso()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if note_id:
            curr = row_to_dict(conn.execute("SELECT * FROM clinical_notes WHERE id = ?", (note_id,)).fetchone())
            if not curr:
                conn.rollback()
                raise NotFoundError("Nota clinica non trovata.")
            if curr["status"] == "finalizzata":
                conn.rollback()
                raise ValidationError(
                    "La nota clinica è già finalizzata e non può essere sovrascritta. Aggiungi un'integrazione/rettifica datata."
                )
            expected_version = payload.get("expected_version")
            if expected_version is not None and int(expected_version) != int(curr["version"]):
                conn.rollback()
                raise ConflictError("La nota clinica è stata modificata da un altro dispositivo.", curr)

            new_status = payload.get("status", curr["status"])
            finalized_at = now if new_status == "finalizzata" else None
            new_v = int(curr["version"]) + 1

            conn.execute(
                """
                UPDATE clinical_notes SET
                    note_date = ?, status = ?, finalized_at = ?,
                    subjective_response = ?, objective_findings = ?,
                    interventions_performed = ?, exercises_performed = ?,
                    plan_next_steps = ?, pain_pre = ?, pain_post = ?,
                    version = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload.get("note_date", curr["note_date"]),
                    new_status,
                    finalized_at,
                    payload.get("subjective_response", curr["subjective_response"]),
                    payload.get("objective_findings", curr["objective_findings"]),
                    payload.get("interventions_performed", curr["interventions_performed"]),
                    payload.get("exercises_performed", curr["exercises_performed"]),
                    payload.get("plan_next_steps", curr["plan_next_steps"]),
                    payload.get("pain_pre", curr["pain_pre"]),
                    payload.get("pain_post", curr["pain_post"]),
                    new_v,
                    now,
                    note_id,
                ),
            )
            person_id = curr["person_id"]
        else:
            episode_id = int(payload["episode_id"])
            ep = row_to_dict(conn.execute("SELECT * FROM physio_episodes WHERE id = ?", (episode_id,)).fetchone())
            if not ep:
                conn.rollback()
                raise NotFoundError("Episodio clinico non trovato.")
            person_id = ep["person_id"]

            copied_from_note_id = int(payload["copied_from_note_id"]) if payload.get("copied_from_note_id") else None
            copied_from_date = payload.get("copied_from_date")
            subjective = payload.get("subjective_response") or ""
            objective = payload.get("objective_findings") or ""
            interventions = payload.get("interventions_performed") or ""
            exercises = payload.get("exercises_performed") or ""
            plan = payload.get("plan_next_steps") or ""

            if copied_from_note_id:
                orig = row_to_dict(conn.execute("SELECT * FROM clinical_notes WHERE id = ?", (copied_from_note_id,)).fetchone())
                if orig:
                    copied_from_date = orig["note_date"]
                    if not subjective:
                        subjective = orig["subjective_response"] or ""
                    if not objective:
                        objective = orig["objective_findings"] or ""
                    if not interventions:
                        interventions = orig["interventions_performed"] or ""
                    if not exercises:
                        exercises = orig["exercises_performed"] or ""
                    if not plan:
                        plan = orig["plan_next_steps"] or ""

            new_status = payload.get("status") or "bozza"
            finalized_at = now if new_status == "finalizzata" else None

            cur = conn.execute(
                """
                INSERT INTO clinical_notes (
                    episode_id, person_id, appointment_id, note_date, status, finalized_at,
                    copied_from_note_id, copied_from_date, subjective_response, objective_findings,
                    interventions_performed, exercises_performed, plan_next_steps,
                    pain_pre, pain_post, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    episode_id,
                    person_id,
                    payload.get("appointment_id") or None,
                    payload.get("note_date") or now[:10],
                    new_status,
                    finalized_at,
                    copied_from_note_id,
                    copied_from_date,
                    subjective,
                    objective,
                    interventions,
                    exercises,
                    plan,
                    payload.get("pain_pre") if payload.get("pain_pre") not in ("", None) else None,
                    payload.get("pain_post") if payload.get("pain_post") not in ("", None) else None,
                    now,
                    now,
                ),
            )
            note_id = cur.lastrowid

        log_audit(
            conn,
            "SAVE_CLINICAL_NOTE",
            "clinical_notes",
            note_id,
            person_id,
            f"Salvata nota clinica SOAP #{note_id} (stato={new_status})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    note = row_to_dict(conn.execute("SELECT * FROM clinical_notes WHERE id = ?", (note_id,)).fetchone())
    note["addenda"] = rows_to_list(
        conn.execute("SELECT * FROM clinical_note_addenda WHERE note_id = ? ORDER BY id ASC", (note_id,)).fetchall()
    )
    return note


def add_clinical_addendum(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    """Aggiunge una rettifica/integrazione datata a una nota o valutazione già finalizzata, preservando l'originale."""
    note_id = int(payload["note_id"]) if payload.get("note_id") else None
    evaluation_id = int(payload["evaluation_id"]) if payload.get("evaluation_id") else None
    text = (payload.get("addendum_text") or "").strip()
    reason = (payload.get("reason") or "Integrazione / Rettifica clinica").strip()

    if not text:
        raise ValidationError("Il testo dell'integrazione/rettifica è obbligatorio.")
    if not note_id and not evaluation_id:
        raise ValidationError("Specifica la nota o la valutazione a cui collegare la rettifica.")

    now = now_rome_iso()
    conn.execute("BEGIN IMMEDIATE")
    try:
        person_id = None
        if note_id:
            n = conn.execute("SELECT person_id FROM clinical_notes WHERE id = ?", (note_id,)).fetchone()
            if not n:
                conn.rollback()
                raise NotFoundError("Nota clinica non trovata.")
            person_id = n["person_id"]
        elif evaluation_id:
            ev = conn.execute("SELECT person_id FROM clinical_evaluations WHERE id = ?", (evaluation_id,)).fetchone()
            if not ev:
                conn.rollback()
                raise NotFoundError("Valutazione clinica non trovata.")
            person_id = ev["person_id"]

        cur = conn.execute(
            """
            INSERT INTO clinical_note_addenda (
                note_id, evaluation_id, person_id, author_name, addendum_text, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (note_id, evaluation_id, person_id, actor, text, reason, now),
        )
        add_id = cur.lastrowid
        log_audit(
            conn,
            "ADD_CLINICAL_ADDENDUM",
            "clinical_note_addenda",
            add_id,
            person_id,
            f"Aggiunta rettifica datata #{add_id} ({reason})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return row_to_dict(conn.execute("SELECT * FROM clinical_note_addenda WHERE id = ?", (add_id,)).fetchone())


def get_physio_episode_detail(conn: sqlite3.Connection, episode_id: int) -> Dict[str, Any]:
    ep = row_to_dict(conn.execute("SELECT * FROM physio_episodes WHERE id = ?", (episode_id,)).fetchone())
    if not ep:
        raise NotFoundError("Episodio clinico non trovato.")

    eval_rows = conn.execute(
        "SELECT id FROM clinical_evaluations WHERE episode_id = ? ORDER BY eval_date ASC, id ASC", (episode_id,)
    ).fetchall()
    evaluations = [get_evaluation_with_details(conn, r["id"]) for r in eval_rows]

    notes = rows_to_list(
        conn.execute(
            "SELECT * FROM clinical_notes WHERE episode_id = ? ORDER BY note_date DESC, id DESC", (episode_id,)
        ).fetchall()
    )
    for n in notes:
        n["addenda"] = rows_to_list(
            conn.execute("SELECT * FROM clinical_note_addenda WHERE note_id = ? ORDER BY id ASC", (n["id"],)).fetchall()
        )

    flags = rows_to_list(
        conn.execute(
            "SELECT * FROM clinical_flags WHERE episode_id = ? ORDER BY flag_type ASC, id ASC", (episode_id,)
        ).fetchall()
    )
    flag_summary = {
        "red_present": sum(1 for f in flags if f["flag_type"] == "red" and f["status"] == "presente"),
        "red_unassessed": sum(1 for f in flags if f["flag_type"] == "red" and f["status"] == "non_valutato"),
        "yellow_present": sum(1 for f in flags if f["flag_type"] == "yellow" and f["status"] == "presente"),
        "yellow_unassessed": sum(1 for f in flags if f["flag_type"] == "yellow" and f["status"] == "non_valutato"),
    }

    measures = rows_to_list(
        conn.execute(
            "SELECT * FROM outcome_measures WHERE episode_id = ? ORDER BY recorded_date ASC, id ASC", (episode_id,)
        ).fetchall()
    )
    for m in measures:
        m["responses"] = json.loads(m.get("responses_json") or "[]")

    # Raggruppa l'andamento delle misure di esito confrontando SOLO rilevazioni della stessa versione
    measures_by_version: Dict[str, List[Dict[str, Any]]] = {}
    for m in measures:
        key = f"{m['scale_code']}||{m['scale_version']}"
        measures_by_version.setdefault(key, []).append(m)

    comparisons = []
    for key, series in measures_by_version.items():
        first_m = series[0]
        last_m = series[-1]
        delta = None
        if len(series) >= 2 and first_m["score_value"] is not None and last_m["score_value"] is not None:
            delta = round(float(last_m["score_value"]) - float(first_m["score_value"]), 2)
        comparisons.append(
            {
                "scale_code": first_m["scale_code"],
                "scale_name": first_m["scale_name"],
                "scale_version": first_m["scale_version"],
                "score_unit": first_m["score_unit"],
                "count": len(series),
                "initial_date": first_m["recorded_date"],
                "initial_score": first_m["score_value"],
                "latest_date": last_m["recorded_date"],
                "latest_score": last_m["score_value"],
                "numeric_delta": delta,
                "series": series,
                "clinical_warning": "Variazione numerica oggettiva sulla medesima versione della scala; il significato clinico va interpretato dal professionista nel contesto del paziente.",
            }
        )

    ep["evaluations"] = evaluations
    ep["notes"] = notes
    ep["flags"] = flags
    ep["flag_summary"] = flag_summary
    ep["outcome_measures"] = measures
    ep["outcome_comparisons"] = comparisons
    return ep


# ==============================================================================
# 5. AREA FITNESS: PROFILO, LIMITAZIONI CONDIVISE, PROGRAMMI VERSIONATI E SEDUTE
# ==============================================================================

def save_person_anamnesis(
    conn: sqlite3.Connection,
    person_id: int,
    payload: Dict[str, Any],
    actor: str = "Professionista",
) -> Dict[str, Any]:
    person = row_to_dict(conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone())
    if not person:
        raise NotFoundError("Persona non trovata.")
    now = now_rome_iso()
    episode_id = int(payload["episode_id"]) if payload.get("episode_id") else None

    conn.execute("BEGIN IMMEDIATE")
    try:
        if "person_anamnesis" in payload and payload["person_anamnesis"] is not None:
            pa = payload["person_anamnesis"]
            anam_json = pa if isinstance(pa, str) else json.dumps(pa, ensure_ascii=False)
            conn.execute("UPDATE people SET anamnesis_json = ?, updated_at = ? WHERE id = ?", (anam_json, now, person_id))

        if "episode_intake" in payload and payload["episode_intake"] is not None:
            ei = payload["episode_intake"]
            intake_obj = json.loads(ei) if isinstance(ei, str) else (ei or {})
            intake_json = json.dumps(intake_obj, ensure_ascii=False)
            motivo_main = str((intake_obj.get("motivo") or {}).get("problema_principale") or "").strip()

            if episode_id:
                ep = row_to_dict(
                    conn.execute("SELECT * FROM physio_episodes WHERE id = ? AND person_id = ?", (episode_id, person_id)).fetchone()
                )
                if not ep:
                    raise NotFoundError("Episodio clinico non trovato.")
                next_title = (payload.get("episode_title") or "").strip() or ep["title"]
                next_complaint = motivo_main or ep["chief_complaint"]
                next_body_region = (
                    str(payload.get("body_region") or "").strip()
                    if "body_region" in payload and payload["body_region"] is not None
                    else ep.get("body_region", "")
                )
                next_laterality = (
                    (str(payload.get("laterality") or "").strip() or "N/A")
                    if "laterality" in payload and payload["laterality"] is not None
                    else ep.get("laterality", "N/A")
                )
                conn.execute(
                    "UPDATE physio_episodes SET intake_json = ?, title = ?, chief_complaint = ?, body_region = ?, laterality = ?, updated_at = ? WHERE id = ?",
                    (intake_json, next_title, next_complaint, next_body_region, next_laterality, now, episode_id),
                )
            else:
                ep_title = (payload.get("episode_title") or "").strip() or (motivo_main[:60] if motivo_main else "Scheda anamnestica")
                ep_complaint = motivo_main or person.get("current_pain_notes") or "Raccolta anamnestica"
                cur = conn.execute(
                    """
                    INSERT INTO physio_episodes (
                        person_id, title, chief_complaint, body_region, laterality,
                        start_date, status, intake_json, version, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'attivo', ?, 1, ?, ?)
                    """,
                    (person_id, ep_title, ep_complaint, payload.get("body_region") or "", payload.get("laterality") or "N/A", now[:10], intake_json, now, now),
                )
                episode_id = cur.lastrowid
                conn.execute("UPDATE people SET physio_active = 1, updated_at = ? WHERE id = ?", (now, person_id))

        log_audit(conn, "SAVE_ANAMNESIS", "people", person_id, person_id, "Salvata scheda anamnestica strutturata", actor=actor)
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return {"saved": True, "person_id": person_id, "episode_id": episode_id, "updated_at": now}


def create_shared_limitation(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    """
    Pubblica una limitazione funzionale rilevante con fonte e data, visibile nel Fitness
    senza copiare indiscriminatamente la cartella clinica.
    """
    person_id = int(payload["person_id"])
    title = (payload.get("title") or "").strip()
    description = (payload.get("description") or "").strip()
    if not title or not description:
        raise ValidationError("Titolo e descrizione operativa della limitazione sono obbligatori.")

    now = now_rome_iso()
    recorded_date = payload.get("recorded_date") or now[:10]

    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO shared_limitations (
                person_id, physio_episode_id, title, description, body_region, laterality,
                source_type, source_reference, recorded_date, recorded_by, is_active,
                version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
            """,
            (
                person_id,
                payload.get("physio_episode_id") or None,
                title,
                description,
                payload.get("body_region") or "",
                payload.get("laterality") or "N/A",
                payload.get("source_type") or "Valutazione Fisioterapica",
                payload.get("source_reference") or f"Rilevazione del {recorded_date}",
                recorded_date,
                payload.get("recorded_by") or actor,
                now,
                now,
            ),
        )
        lim_id = cur.lastrowid
        log_audit(
            conn,
            "CREATE_SHARED_LIMITATION",
            "shared_limitations",
            lim_id,
            person_id,
            f"Condivisa limitazione funzionale '{title}' (fonte: {payload.get('source_type', 'Valutazione Fisioterapica')}, data: {recorded_date})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return row_to_dict(conn.execute("SELECT * FROM shared_limitations WHERE id = ?", (lim_id,)).fetchone())


def save_fitness_profile(conn: sqlite3.Connection, person_id: int, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    now = now_rome_iso()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("UPDATE people SET fitness_active = 1, updated_at = ? WHERE id = ?", (now, person_id))
        curr = row_to_dict(conn.execute("SELECT * FROM fitness_profiles WHERE person_id = ?", (person_id,)).fetchone())
        if curr:
            expected_version = payload.get("expected_version")
            if expected_version is not None and int(expected_version) != int(curr["version"]):
                conn.rollback()
                raise ConflictError("Il profilo fitness è stato modificato da un altro dispositivo.", curr)
            new_v = int(curr["version"]) + 1
            conn.execute(
                """
                UPDATE fitness_profiles SET
                    primary_goals = ?, experience_level = ?, preferences = ?,
                    weekly_availability = ?, available_equipment = ?,
                    general_limitations_note = ?, initial_assessment_notes = ?,
                    version = ?, updated_at = ?
                WHERE person_id = ?
                """,
                (
                    payload.get("primary_goals", curr["primary_goals"]),
                    payload.get("experience_level", curr["experience_level"]),
                    payload.get("preferences", curr["preferences"]),
                    payload.get("weekly_availability", curr["weekly_availability"]),
                    payload.get("available_equipment", curr["available_equipment"]),
                    payload.get("general_limitations_note", curr["general_limitations_note"]),
                    payload.get("initial_assessment_notes", curr["initial_assessment_notes"]),
                    new_v,
                    now,
                    person_id,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO fitness_profiles (
                    person_id, primary_goals, experience_level, preferences,
                    weekly_availability, available_equipment, general_limitations_note,
                    initial_assessment_notes, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    person_id,
                    payload.get("primary_goals") or "",
                    payload.get("experience_level") or "Intermedio",
                    payload.get("preferences") or "",
                    payload.get("weekly_availability") or "",
                    payload.get("available_equipment") or "",
                    payload.get("general_limitations_note") or "",
                    payload.get("initial_assessment_notes") or "",
                    now,
                    now,
                ),
            )
        log_audit(conn, "SAVE_FITNESS_PROFILE", "fitness_profiles", person_id, person_id, "Aggiornato profilo fitness", actor=actor)
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return row_to_dict(conn.execute("SELECT * FROM fitness_profiles WHERE person_id = ?", (person_id,)).fetchone())


def record_fitness_metric(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    person_id = int(payload["person_id"])
    now = now_rome_iso()
    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO fitness_metrics (
                person_id, recorded_date, metric_category, metric_name,
                value_num, unit, side, protocol_notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                person_id,
                payload.get("recorded_date") or now[:10],
                payload.get("metric_category") or "Forza / Performance",
                (payload.get("metric_name") or "").strip(),
                float(payload["value_num"]),
                (payload.get("unit") or "kg").strip(),
                payload.get("side") or "N/A",
                payload.get("protocol_notes") or "",
                now,
            ),
        )
        m_id = cur.lastrowid
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    return row_to_dict(conn.execute("SELECT * FROM fitness_metrics WHERE id = ?", (m_id,)).fetchone())


def save_fitness_program(
    conn: sqlite3.Connection,
    payload: Dict[str, Any],
    program_id: Optional[int] = None,
    actor: str = "Professionista",
) -> Dict[str, Any]:
    """
    Crea o aggiorna un programma di allenamento conservando lo storico delle versioni
    in `fitness_program_versions` a ogni modifica.
    """
    now = now_rome_iso()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if program_id:
            curr = row_to_dict(conn.execute("SELECT * FROM fitness_programs WHERE id = ?", (program_id,)).fetchone())
            if not curr:
                conn.rollback()
                raise NotFoundError("Programma fitness non trovato.")

            expected_version = payload.get("expected_version")
            if expected_version is not None and int(expected_version) != int(curr["version"]):
                conn.rollback()
                raise ConflictError("Il programma fitness è stato modificato da un altro dispositivo.", curr)

            new_v = int(curr["version"]) + 1
            workouts = payload.get("workouts")
            workouts_json = json.dumps(workouts, ensure_ascii=False) if workouts is not None else curr["workouts_json"]
            title = (payload.get("title") or curr["title"]).strip()
            goal = (payload.get("goal") or curr["goal"]).strip()
            notes = payload.get("notes", curr["notes"])

            conn.execute(
                """
                UPDATE fitness_programs SET
                    title = ?, goal = ?, phase_name = ?, start_date = ?, end_date = ?,
                    frequency_per_week = ?, status = ?, workouts_json = ?, notes = ?,
                    version = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    title,
                    goal,
                    payload.get("phase_name", curr["phase_name"]),
                    payload.get("start_date", curr["start_date"]),
                    payload.get("end_date", curr["end_date"]),
                    int(payload.get("frequency_per_week", curr["frequency_per_week"] or 2)),
                    payload.get("status", curr["status"]),
                    workouts_json,
                    notes,
                    new_v,
                    now,
                    program_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO fitness_program_versions (
                    program_id, version_number, title, goal, workouts_json, notes, change_note, saved_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    program_id,
                    new_v,
                    title,
                    goal,
                    workouts_json,
                    notes,
                    payload.get("change_note") or f"Aggiornamento programma v{new_v}",
                    now,
                ),
            )
            person_id = curr["person_id"]
        else:
            person_id = int(payload["person_id"])
            title = (payload.get("title") or "").strip()
            goal = (payload.get("goal") or "").strip()
            if not title or not goal:
                conn.rollback()
                raise ValidationError("Titolo e obiettivo del programma fitness sono obbligatori.")

            conn.execute("UPDATE people SET fitness_active = 1, updated_at = ? WHERE id = ?", (now, person_id))
            workouts_json = json.dumps(payload.get("workouts") or [], ensure_ascii=False)
            notes = payload.get("notes") or ""

            cur = conn.execute(
                """
                INSERT INTO fitness_programs (
                    person_id, title, goal, phase_name, start_date, end_date,
                    frequency_per_week, status, workouts_json, notes, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    person_id,
                    title,
                    goal,
                    payload.get("phase_name") or "Fase 1 - Adattamento & Forza",
                    payload.get("start_date") or now[:10],
                    payload.get("end_date") or None,
                    int(payload.get("frequency_per_week") or 2),
                    payload.get("status") or "attivo",
                    workouts_json,
                    notes,
                    now,
                    now,
                ),
            )
            program_id = cur.lastrowid
            conn.execute(
                """
                INSERT INTO fitness_program_versions (
                    program_id, version_number, title, goal, workouts_json, notes, change_note, saved_at
                ) VALUES (?, 1, ?, ?, ?, ?, 'Creazione iniziale programma', ?)
                """,
                (program_id, title, goal, workouts_json, notes, now),
            )

        log_audit(
            conn,
            "SAVE_FITNESS_PROGRAM",
            "fitness_programs",
            program_id,
            person_id,
            f"Salvato programma fitness '{title}'",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return get_fitness_program_detail(conn, program_id)


def get_fitness_program_detail(conn: sqlite3.Connection, program_id: int) -> Dict[str, Any]:
    prog = row_to_dict(conn.execute("SELECT * FROM fitness_programs WHERE id = ?", (program_id,)).fetchone())
    if not prog:
        raise NotFoundError("Programma non trovato.")
    prog["workouts"] = json.loads(prog.get("workouts_json") or "[]")
    versions = rows_to_list(
        conn.execute(
            "SELECT * FROM fitness_program_versions WHERE program_id = ? ORDER BY version_number DESC", (program_id,)
        ).fetchall()
    )
    for v in versions:
        v["workouts"] = json.loads(v.get("workouts_json") or "[]")
    prog["version_history"] = versions
    return prog


def record_workout_log(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    """
    Registra velocemente una seduta fitness distinguendo quanto programmato (`planned_exercises`)
    da quanto effettivamente svolto (`actual_exercises`), con risposta del cliente, eventuali sintomi e indicazioni.
    """
    person_id = int(payload["person_id"])
    program_id = int(payload["program_id"]) if payload.get("program_id") else None
    now = now_rome_iso()
    session_date = payload.get("session_date") or now[:10]

    prog_version = 1
    if program_id:
        p_row = conn.execute("SELECT version FROM fitness_programs WHERE id = ?", (program_id,)).fetchone()
        if p_row:
            prog_version = p_row["version"]

    planned_json = json.dumps(payload.get("planned_exercises") or [], ensure_ascii=False)
    actual_json = json.dumps(payload.get("actual_exercises") or [], ensure_ascii=False)

    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO workout_logs (
                person_id, program_id, program_version, appointment_id, workout_day_name,
                session_date, planned_exercises_json, actual_exercises_json, session_rpe,
                duration_minutes, client_feedback, reported_symptoms, symptom_severity,
                next_session_notes, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                person_id,
                program_id,
                prog_version,
                payload.get("appointment_id") or None,
                (payload.get("workout_day_name") or "Seduta Personal Training").strip(),
                session_date,
                planned_json,
                actual_json,
                float(payload["session_rpe"]) if payload.get("session_rpe") not in (None, "") else None,
                int(payload.get("duration_minutes") or 60),
                payload.get("client_feedback") or "",
                payload.get("reported_symptoms") or "",
                int(payload.get("symptom_severity") or 0),
                payload.get("next_session_notes") or "",
                now,
                now,
            ),
        )
        log_id = cur.lastrowid
        log_audit(
            conn,
            "RECORD_WORKOUT_LOG",
            "workout_logs",
            log_id,
            person_id,
            f"Registrata seduta fitness '{payload.get('workout_day_name', 'Seduta')}' del {session_date}",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    wlog = row_to_dict(conn.execute("SELECT * FROM workout_logs WHERE id = ?", (log_id,)).fetchone())
    wlog["planned_exercises"] = json.loads(wlog["planned_exercises_json"])
    wlog["actual_exercises"] = json.loads(wlog["actual_exercises_json"])
    return wlog


# ==============================================================================
# 6. DOCUMENTI, CONSENSI, ALLEGATI PRIVATI, ESPORTAZIONI E BACKUP CIFRATI
# ==============================================================================

def save_consent_record(conn: sqlite3.Connection, payload: Dict[str, Any], actor: str = "Professionista") -> Dict[str, Any]:
    person_id = int(payload["person_id"])
    doc_type = payload.get("doc_type") or "informativa_privacy"
    if doc_type not in ("informativa_privacy", "consenso_trattamento_sanitario", "consenso_comunicazioni", "altro"):
        raise ValidationError("Tipologia documento/consenso non valida.")
    status = payload.get("status") or "acquisito"
    if status not in ("acquisito", "revocato", "in_attesa"):
        raise ValidationError("Stato consenso non valido.")

    now = now_rome_iso()
    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO consents (
                person_id, doc_type, doc_version, status, signed_date,
                acquisition_method, revoked_date, attachment_id, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                person_id,
                doc_type,
                (payload.get("doc_version") or "v2026.1").strip(),
                status,
                payload.get("signed_date") or (now[:10] if status == "acquisito" else None),
                payload.get("acquisition_method") or "Modulo firmato con verifica identità",
                payload.get("revoked_date") or (now[:10] if status == "revocato" else None),
                payload.get("attachment_id") or None,
                payload.get("notes") or "",
                now,
                now,
            ),
        )
        cid = cur.lastrowid
        log_audit(
            conn,
            "SAVE_CONSENT",
            "consents",
            cid,
            person_id,
            f"Registrato documento/consenso {doc_type} ({status})",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise

    return row_to_dict(conn.execute("SELECT * FROM consents WHERE id = ?", (cid,)).fetchone())


ALLOWED_ATTACHMENT_SIGNATURES = {
    "application/pdf": [b"%PDF-"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/webp": [b"RIFF"],
}


def store_private_attachment(
    conn: sqlite3.Connection,
    person_id: int,
    original_filename: str,
    file_bytes: bytes,
    mime_type: str,
    category: str = "Referto / Allegato Clinico",
    description: str = "",
    episode_id: Optional[int] = None,
    program_id: Optional[int] = None,
    evaluation_id: Optional[int] = None,
    actor: str = "Professionista",
    attachments_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Salva un allegato PDF o immagine nella directory privata fuori dalla web root pubblica,
    verificando i magic bytes del file e registrando hash SHA-256.
    """
    if not file_bytes:
        raise ValidationError("Il file caricato è vuoto.")
    if len(file_bytes) > 15 * 1024 * 1024:
        raise ValidationError("Il file supera la dimensione massima consentita di 15 MB.")

    detected_mime = None
    for m_type, sigs in ALLOWED_ATTACHMENT_SIGNATURES.items():
        if any(file_bytes.startswith(sig) for sig in sigs):
            detected_mime = m_type
            break
    if not detected_mime:
        raise ValidationError("Formato file non supportato. Sono ammessi solo PDF, PNG, JPEG e WEBP verificati.")

    ext_map = {
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }
    ext = ext_map[detected_mime]
    stored_filename = f"att_{person_id}_{secrets.token_hex(12)}{ext}"
    att_dir = attachments_dir or get_attachments_dir()
    target_path = att_dir / stored_filename

    sha256_hash = hashlib.sha256(file_bytes).hexdigest()
    now = now_rome_iso()

    with open(target_path, "wb") as f:
        f.write(file_bytes)
    try:
        os.chmod(target_path, 0o600)
    except OSError:
        pass

    conn.execute("BEGIN IMMEDIATE")
    try:
        cur = conn.execute(
            """
            INSERT INTO attachments (
                person_id, episode_id, program_id, evaluation_id, category,
                original_filename, stored_filename, mime_type, size_bytes,
                sha256_hash, description, uploaded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                person_id,
                episode_id,
                program_id,
                evaluation_id,
                category,
                original_filename,
                stored_filename,
                detected_mime,
                len(file_bytes),
                sha256_hash,
                description,
                now,
            ),
        )
        att_id = cur.lastrowid
        log_audit(
            conn,
            "UPLOAD_ATTACHMENT",
            "attachments",
            att_id,
            person_id,
            f"Caricato allegato privato '{original_filename}' ({len(file_bytes)} bytes)",
            actor=actor,
        )
        conn.commit()
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        if target_path.exists():
            target_path.unlink()
        raise

    return row_to_dict(conn.execute("SELECT * FROM attachments WHERE id = ?", (att_id,)).fetchone())


# ==============================================================================
# 7. SCHEDA PERSONA COMPLETA, DASHBOARD GIORNALIERA ED ESPORTAZIONI
# ==============================================================================

def get_person_full_dossier(conn: sqlite3.Connection, person_id: int) -> Dict[str, Any]:
    person = row_to_dict(conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone())
    if not person:
        raise NotFoundError("Persona non trovata.")

    ep_ids = conn.execute(
        "SELECT id FROM physio_episodes WHERE person_id = ? ORDER BY start_date DESC, id DESC", (person_id,)
    ).fetchall()
    physio_episodes = [get_physio_episode_detail(conn, r["id"]) for r in ep_ids]

    fitness_profile = row_to_dict(
        conn.execute("SELECT * FROM fitness_profiles WHERE person_id = ?", (person_id,)).fetchone()
    )
    prog_ids = conn.execute(
        "SELECT id FROM fitness_programs WHERE person_id = ? ORDER BY start_date DESC, id DESC", (person_id,)
    ).fetchall()
    fitness_programs = [get_fitness_program_detail(conn, r["id"]) for r in prog_ids]

    workout_logs = rows_to_list(
        conn.execute(
            "SELECT * FROM workout_logs WHERE person_id = ? ORDER BY session_date DESC, id DESC", (person_id,)
        ).fetchall()
    )
    for wl in workout_logs:
        wl["planned_exercises"] = json.loads(wl.get("planned_exercises_json") or "[]")
        wl["actual_exercises"] = json.loads(wl.get("actual_exercises_json") or "[]")

    fitness_metrics = rows_to_list(
        conn.execute(
            "SELECT * FROM fitness_metrics WHERE person_id = ? ORDER BY recorded_date ASC, id ASC", (person_id,)
        ).fetchall()
    )

    shared_limitations = rows_to_list(
        conn.execute(
            "SELECT * FROM shared_limitations WHERE person_id = ? ORDER BY recorded_date DESC, id DESC", (person_id,)
        ).fetchall()
    )

    pkg_rows = rows_to_list(
        conn.execute("SELECT * FROM packages WHERE person_id = ? ORDER BY purchased_date DESC, id DESC", (person_id,)).fetchall()
    )
    packages = [compute_package_summary(conn, p) for p in pkg_rows]

    payments = rows_to_list(
        conn.execute("SELECT * FROM payments WHERE person_id = ? ORDER BY payment_date DESC, id DESC", (person_id,)).fetchall()
    )

    appointments = rows_to_list(
        conn.execute("SELECT * FROM appointments WHERE person_id = ? ORDER BY start_at DESC", (person_id,)).fetchall()
    )

    consents = rows_to_list(
        conn.execute("SELECT * FROM consents WHERE person_id = ? ORDER BY id DESC", (person_id,)).fetchall()
    )

    attachments = rows_to_list(
        conn.execute("SELECT * FROM attachments WHERE person_id = ? ORDER BY uploaded_at DESC", (person_id,)).fetchall()
    )

    audit_history = rows_to_list(
        conn.execute("SELECT * FROM audit_logs WHERE person_id = ? ORDER BY id DESC LIMIT 100", (person_id,)).fetchall()
    )

    total_due_cents = sum(p["due_cents"] for p in packages if p["status"] != "annullato")
    total_available_sessions = sum(p["available_to_book"] for p in packages if p["status"] == "attivo")

    return {
        "person": person,
        "summary": {
            "active_physio_episodes": sum(1 for e in physio_episodes if e["status"] == "attivo"),
            "active_fitness_programs": sum(1 for p in fitness_programs if p["status"] == "attivo"),
            "active_shared_limitations": sum(1 for l in shared_limitations if l["is_active"]),
            "total_available_sessions": total_available_sessions,
            "total_due_cents": total_due_cents,
            "has_privacy_notice": any(c["doc_type"] == "informativa_privacy" and c["status"] == "acquisito" for c in consents),
            "has_health_consent": any(
                c["doc_type"] == "consenso_trattamento_sanitario" and c["status"] == "acquisito" for c in consents
            ),
        },
        "shared_limitations": shared_limitations,
        "physio": {
            "episodes": physio_episodes,
        },
        "fitness": {
            "profile": fitness_profile,
            "programs": fitness_programs,
            "workout_logs": workout_logs,
            "metrics": fitness_metrics,
        },
        "appointments": appointments,
        "packages": packages,
        "payments": payments,
        "consents": consents,
        "attachments": attachments,
        "audit_history": audit_history,
    }


def get_dashboard_overview(conn: sqlite3.Connection, target_date: Optional[str] = None) -> Dict[str, Any]:
    now_dt = datetime.now(ROME_TZ)
    day_str = target_date or now_dt.strftime("%Y-%m-%d")

    today_appointments = rows_to_list(
        conn.execute(
            """
            SELECT a.*, p.first_name, p.last_name, p.phone, p.physio_active, p.fitness_active
            FROM appointments a
            JOIN people p ON p.id = a.person_id
            WHERE substr(a.start_at, 1, 10) = ?
            ORDER BY a.start_at ASC
            """,
            (day_str,),
        ).fetchall()
    )

    next_person_appt = None
    now_iso = now_dt.isoformat(timespec="seconds")
    for a in today_appointments:
        if a["status"] in ("prenotato", "confermato") and a["end_at"] >= now_iso:
            next_person_appt = a
            break
    if not next_person_appt:
        for a in today_appointments:
            if a["status"] in ("prenotato", "confermato"):
                next_person_appt = a
                break

    # Note cliniche e valutazioni in bozza da completare
    draft_notes = rows_to_list(
        conn.execute(
            """
            SELECT n.id, n.note_date AS date, 'Nota SOAP' AS kind, n.episode_id, n.person_id,
                   p.first_name, p.last_name, e.title AS episode_title
            FROM clinical_notes n
            JOIN people p ON p.id = n.person_id
            JOIN physio_episodes e ON e.id = n.episode_id
            WHERE n.status = 'bozza'
            ORDER BY n.note_date DESC
            """
        ).fetchall()
    )
    draft_evals = rows_to_list(
        conn.execute(
            """
            SELECT ev.id, ev.eval_date AS date,
                   CASE WHEN ev.eval_type = 'prima_valutazione' THEN 'Prima Valutazione' ELSE 'Rivalutazione' END AS kind,
                   ev.episode_id, ev.person_id, p.first_name, p.last_name, e.title AS episode_title
            FROM clinical_evaluations ev
            JOIN people p ON p.id = ev.person_id
            JOIN physio_episodes e ON e.id = ev.episode_id
            WHERE ev.status = 'bozza'
            ORDER BY ev.eval_date DESC
            """
        ).fetchall()
    )

    # Rivalutazioni previste entro i prossimi 7 giorni o scadute
    horizon_date = (now_dt.date() + timedelta(days=7)).isoformat()
    reassessments_due = rows_to_list(
        conn.execute(
            """
            SELECT e.*, p.first_name, p.last_name
            FROM physio_episodes e
            JOIN people p ON p.id = e.person_id
            WHERE e.status = 'attivo' AND e.reassessment_due_date IS NOT NULL AND e.reassessment_due_date <= ?
            ORDER BY e.reassessment_due_date ASC
            """,
            (horizon_date,),
        ).fetchall()
    )

    # Pacchetti quasi esauriti (<= 2 residue/disponibili), in scadenza o con importi da incassare
    all_pkg_rows = rows_to_list(
        conn.execute(
            """
            SELECT pkg.*, p.first_name, p.last_name
            FROM packages pkg
            JOIN people p ON p.id = pkg.person_id
            WHERE pkg.status IN ('attivo', 'esaurito')
            ORDER BY pkg.purchased_date DESC
            """
        ).fetchall()
    )
    low_or_expiring_packages = []
    unpaid_packages = []
    exp_horizon = (now_dt.date() + timedelta(days=14)).isoformat()

    for pr in all_pkg_rows:
        s = compute_package_summary(conn, pr)
        is_low = s["status"] == "attivo" and s["remaining_sessions"] <= 2
        is_expiring = s["status"] == "attivo" and bool(s.get("valid_until") and s["valid_until"] <= exp_horizon)
        if is_low or is_expiring:
            low_or_expiring_packages.append(s)
        if s["due_cents"] > 0:
            unpaid_packages.append(s)

    total_to_collect_cents = sum(p["due_cents"] for p in unpaid_packages)

    return {
        "date": day_str,
        "timezone": "Europe/Rome",
        "today_appointments": today_appointments,
        "next_appointment": next_person_appt,
        "drafts_to_complete": draft_evals + draft_notes,
        "reassessments_due": reassessments_due,
        "low_or_expiring_packages": low_or_expiring_packages,
        "unpaid_packages": unpaid_packages,
        "total_to_collect_cents": total_to_collect_cents,
    }


def export_calendar_ics(conn: sqlite3.Connection, privacy_mode: str = "initials_only") -> str:
    """
    Esporta gli appuntamenti in formato standard iCalendar (.ics) compatibile con Apple Calendar.
    NON inserisce mai dettagli clinici, diagnosi o note riservate nei titoli o nelle descrizioni.
    """
    rows = conn.execute(
        """
        SELECT a.*, p.first_name, p.last_name
        FROM appointments a
        JOIN people p ON p.id = a.person_id
        WHERE a.status != 'annullato'
        ORDER BY a.start_at ASC
        """
    ).fetchall()

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Gestionale Fisio Fitness Personale//IT",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Agenda Studio Fisio & Fitness",
        "X-WR-TIMEZONE:Europe/Rome",
    ]
    now_utc = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    for r in rows:
        s_dt = parse_rome_datetime(r["start_at"])
        e_dt = parse_rome_datetime(r["end_at"])
        initials = f"{r['first_name'][:1].upper()}. {r['last_name'][:1].upper()}."
        area_tag = "FISIO" if r["service_area"] == "fisio" else "FIT"
        if privacy_mode == "full_name":
            summary = f"[{area_tag}] {r['first_name']} {r['last_name']}"
        else:
            summary = f"[{area_tag}] Appuntamento {initials} (#{r['person_id']})"

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:appt-{r['id']}@gestionale.local",
                f"DTSTAMP:{now_utc}",
                f"DTSTART;TZID=Europe/Rome:{s_dt.strftime('%Y%m%dT%H%M%S')}",
                f"DTEND;TZID=Europe/Rome:{e_dt.strftime('%Y%m%dT%H%M%S')}",
                f"SUMMARY:{summary}",
                f"LOCATION:{r['location'] or 'Studio'}",
                f"DESCRIPTION:Appuntamento gestionale #{r['id']} - Stato: {r['status']} (Nessun dato clinico esportato per tutela privacy)",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def render_person_printable_html(dossier: Dict[str, Any]) -> str:
    """
    Genera un documento HTML formattato per l'esportazione/stampa PDF della scheda completa
    (comprensiva di mappa del dolore 2D SVG con marcatori posizionati, valutazioni, scale, fitness e pacchetti).
    """
    p = dossier["person"]
    physio_eps = dossier["physio"]["episodes"]
    fit_progs = dossier["fitness"]["programs"]
    lims = dossier["shared_limitations"]
    pkgs = dossier["packages"]

    ep_html = []
    for ep in physio_eps:
        evals_html = []
        for ev in ep["evaluations"]:
            markers_rows = "".join(
                f"<tr><td>{m['view_side']}</td><td>{m['anatomical_region']} ({m['laterality']})</td>"
                f"<td>{m['symptom_type']}</td><td>{m['intensity']}/10</td><td>{m['notes'] or '-'}</td></tr>"
                for m in ev["body_map_markers"]
            )
            evals_html.append(
                f"""
                <div class="box">
                    <h4>{ev['eval_type'].replace('_', ' ').title()} — Data: {ev['eval_date']} (Stato: {ev['status']})</h4>
                    <p><strong>Motivo consultazione:</strong> {ev['consult_reason'] or '-'} | <strong>Obiettivi paziente:</strong> {ev['patient_goals'] or '-'}</p>
                    <p><strong>Esordio e comportamento sintomi:</strong> {ev['symptom_onset'] or '-'} / {ev['symptom_behavior'] or '-'}</p>
                    <p><strong>Fattori aggravanti/allevianti (24h):</strong> {ev['aggravating_factors'] or '-'} | {ev['easing_factors'] or '-'} | {ev['pattern_24h'] or '-'}</p>
                    <p><strong>Ragionamento clinico e piano:</strong> {ev['clinical_reasoning'] or '-'} — {ev['treatment_plan'] or '-'}</p>
                    <h5>Mappa del Corpo (Riepilogo Punti e Aree)</h5>
                    <table>
                        <thead><tr><th>Vista</th><th>Regione e Lato</th><th>Sintomo</th><th>Intensità</th><th>Note</th></tr></thead>
                        <tbody>{markers_rows or '<tr><td colspan="5">Nessun marcatore registrato</td></tr>'}</tbody>
                    </table>
                </div>
                """
            )
        ep_html.append(
            f"""
            <div class="section-card">
                <h3>Episodio Fisioterapico: {ep['title']} ({ep['status']})</h3>
                <p><strong>Inizio:</strong> {ep['start_date']} | <strong>Distretto:</strong> {ep['body_region'] or '-'} ({ep['laterality']})</p>
                {''.join(evals_html)}
            </div>
            """
        )

    lims_html = "".join(
        f"<li><strong>{l['title']}</strong> ({l['laterality']}): {l['description']} — <em>Fonte: {l['source_type']} del {l['recorded_date']}</em></li>"
        for l in lims
    )

    pkgs_html = "".join(
        f"<tr><td>{k['name']}</td><td>{k['total_sessions']}</td><td>{k['consumed_sessions']}</td>"
        f"<td>{k['reserved_sessions']}</td><td><strong>{k['available_to_book']}</strong> (Residue: {k['remaining_sessions']})</td>"
        f"<td>€ {k['price_cents']/100:.2f} (Da saldare: € {k['due_cents']/100:.2f})</td></tr>"
        for k in pkgs
    )

    return f"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Scheda Personale — {p['first_name']} {p['last_name']}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; margin: 24px; line-height: 1.45; }}
  h1, h2, h3, h4 {{ margin-top: 0.6em; margin-bottom: 0.4em; color: #0f172a; }}
  .header {{ border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; }}
  .section-card {{ border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; margin-bottom: 16px; page-break-inside: avoid; }}
  .box {{ background: #f8fafc; border-left: 4px solid #0f766e; padding: 10px 14px; margin: 10px 0; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }}
  th, td {{ border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }}
  th {{ background: #f1f5f9; }}
  .print-btn {{ background: #0f766e; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }}
  @media print {{ .no-print {{ display: none !important; }} body {{ margin: 0; }} }}
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:16px;">
    <button class="print-btn" onclick="window.print()">Stampa / Salva come PDF</button>
  </div>
  <div class="header">
    <div>
      <h1>Scheda Personale: {p['first_name']} {p['last_name']}</h1>
      <p>Data di nascita: {p['birth_date'] or '-'} | CF: {p['tax_code'] or '-'} | Tel: {p['phone'] or '-'} | Email: {p['email'] or '-'}</p>
      <p>Professione: {p['profession'] or '-'} | Sport: {p['sport_activity'] or '-'} | Percorsi attivi: {'Fisioterapia ' if p['physio_active'] else ''}{'Fitness' if p['fitness_active'] else ''}</p>
    </div>
    <div style="text-align:right; font-size:12px; color:#475569;">
      Esportato il {now_rome_iso()[:16].replace('T', ' ')}<br>Fuso: Europe/Rome
    </div>
  </div>

  <div class="section-card">
    <h2>Limitazioni Funzionali Condivise (Ponte Fisio → Fitness)</h2>
    <ul>{lims_html or '<li>Nessuna limitazione condivisa attiva.</li>'}</ul>
  </div>

  <h2>Area Fisioterapia</h2>
  {''.join(ep_html) or '<p>Nessun episodio fisioterapico registrato.</p>'}

  <div class="section-card">
    <h2>Area Fitness ({len(fit_progs)} programmi)</h2>
    {''.join(f"<p><strong>{fp['title']}</strong> (v{fp['version']}, stato: {fp['status']}) — Obiettivo: {fp['goal']}</p>" for fp in fit_progs) or '<p>Nessun programma fitness registrato.</p>'}
  </div>

  <div class="section-card">
    <h2>Riepilogo Pacchetti e Saldi</h2>
    <table>
      <thead><tr><th>Pacchetto</th><th>Acquistate</th><th>Consumate</th><th>Prenotate</th><th>Disponibili (Residue)</th><th>Saldo Economico</th></tr></thead>
      <tbody>{pkgs_html or '<tr><td colspan="6">Nessun pacchetto registrato</td></tr>'}</tbody>
    </table>
    <p style="font-size:11px; color:#64748b; margin-top:8px;">Nota: Riepilogo gestionale interno non valido come fattura fiscale conforme.</p>
  </div>
</body>
</html>"""


# ==============================================================================
# 8. BACKUP AUTOMATICI CIFRATI E PROCEDURA DI RIPRISTINO VERIFICATA
# ==============================================================================

def create_encrypted_backup(
    db_path: Optional[Path] = None,
    attachments_dir: Optional[Path] = None,
    backups_dir: Optional[Path] = None,
    passphrase: Optional[str] = None,
    actor: str = "Professionista",
) -> Dict[str, Any]:
    """
    Crea un backup atomico consistente del database SQLite (tramite API `sqlite3.Connection.backup`)
    e di tutti gli allegati privati, lo comprime in un archivio ZIP con manifesto SHA-256 e lo cifra
    con AES-256-CBC + PBKDF2 (600.000 iterazioni) + firma HMAC-SHA256.
    """
    src_db = db_path or get_db_path()
    src_att = attachments_dir or get_attachments_dir()
    dst_bkp_dir = backups_dir or get_backups_dir()
    secrets_cfg = load_or_create_secrets()
    pwd = passphrase or secrets_cfg["backup_passphrase"]

    ts = datetime.now(ROME_TZ).strftime("%Y%m%d_%H%M%S")
    backup_id = f"bkp_{ts}_{secrets.token_hex(4)}"
    encrypted_file = dst_bkp_dir / f"{backup_id}.zip.enc"
    meta_file = dst_bkp_dir / f"{backup_id}.meta.json"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        snapshot_db = tmp_path / "database_snapshot.sqlite"

        # Backup atomico a caldo di SQLite
        src_conn = sqlite3.connect(str(src_db))
        dst_conn = sqlite3.connect(str(snapshot_db))
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
            src_conn.close()

        db_sha256 = hashlib.sha256(snapshot_db.read_bytes()).hexdigest()
        att_manifest = []
        for f in sorted(src_att.glob("*")):
            if f.is_file():
                att_manifest.append(
                    {
                        "filename": f.name,
                        "size_bytes": f.stat().st_size,
                        "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
                    }
                )

        manifest = {
            "backup_id": backup_id,
            "created_at": now_rome_iso(),
            "timezone": "Europe/Rome",
            "database_sha256": db_sha256,
            "attachments_count": len(att_manifest),
            "attachments": att_manifest,
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        plain_zip = tmp_path / "archive.zip"
        with zipfile.ZipFile(plain_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(snapshot_db, arcname="database_snapshot.sqlite")
            zf.write(manifest_path, arcname="manifest.json")
            for f in sorted(src_att.glob("*")):
                if f.is_file():
                    zf.write(f, arcname=f"attachments/{f.name}")

        hmac_hex = encrypt_file_aes256(plain_zip, encrypted_file, pwd)

    meta_info = {
        "backup_id": backup_id,
        "created_at": manifest["created_at"],
        "encrypted_filename": encrypted_file.name,
        "encrypted_path": str(encrypted_file),
        "size_bytes": encrypted_file.stat().st_size,
        "hmac_sha256": hmac_hex,
        "database_sha256": db_sha256,
        "attachments_count": len(att_manifest),
        "cipher": "AES-256-CBC + PBKDF2-SHA256 (600k iter) + HMAC-SHA256",
    }
    meta_file.write_text(json.dumps(meta_info, indent=2), encoding="utf-8")

    conn = get_connection(src_db)
    try:
        log_audit(
            conn,
            "CREATE_ENCRYPTED_BACKUP",
            "backups",
            None,
            None,
            f"Creato backup cifrato {backup_id} ({meta_info['size_bytes']} bytes, {len(att_manifest)} allegati)",
            actor=actor,
        )
        conn.commit()
    finally:
        conn.close()

    return meta_info


def restore_and_verify_backup(
    encrypted_backup_path: Path,
    target_restore_dir: Path,
    passphrase: Optional[str] = None,
    expected_hmac: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Decifra ed estrae un backup cifrato in una directory isolata (es. ambiente di prova),
    verifica l'HMAC, l'integrità del database SQLite (`PRAGMA integrity_check`) e
    gli hash SHA-256 di tutti gli allegati ripristinati.
    """
    secrets_cfg = load_or_create_secrets()
    pwd = passphrase or secrets_cfg["backup_passphrase"]

    if not expected_hmac:
        meta_candidate = encrypted_backup_path.parent / encrypted_backup_path.name.replace(".zip.enc", ".meta.json")
        if meta_candidate.exists():
            meta_data = json.loads(meta_candidate.read_text(encoding="utf-8"))
            expected_hmac = meta_data.get("hmac_sha256")

    target_restore_dir.mkdir(parents=True, exist_ok=True)
    restored_db = target_restore_dir / "restored.sqlite"
    restored_att_dir = target_restore_dir / "attachments"
    restored_att_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        decrypted_zip = Path(tmpdir) / "decrypted.zip"
        decrypt_file_aes256(encrypted_backup_path, decrypted_zip, pwd, expected_hmac=expected_hmac)

        with zipfile.ZipFile(decrypted_zip, "r") as zf:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            with open(restored_db, "wb") as f:
                f.write(zf.read("database_snapshot.sqlite"))

            for item in manifest.get("attachments", []):
                fname = item["filename"]
                raw_bytes = zf.read(f"attachments/{fname}")
                out_file = restored_att_dir / fname
                out_file.write_bytes(raw_bytes)
                actual_hash = hashlib.sha256(raw_bytes).hexdigest()
                if actual_hash != item["sha256"]:
                    raise ValueError(f"Hash allegato {fname} non corrispondente dopo il ripristino!")

    actual_db_hash = hashlib.sha256(restored_db.read_bytes()).hexdigest()
    if actual_db_hash != manifest["database_sha256"]:
        raise ValueError("Hash SHA-256 del database ripristinato non corrispondente al manifesto!")

    r_conn = get_connection(restored_db)
    try:
        integrity = r_conn.execute("PRAGMA integrity_check;").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"Controllo integrità SQLite fallito: {integrity}")
        people_count = r_conn.execute("SELECT COUNT(*) AS c FROM people").fetchone()["c"]
        eval_count = r_conn.execute("SELECT COUNT(*) AS c FROM clinical_evaluations").fetchone()["c"]
        pkg_count = r_conn.execute("SELECT COUNT(*) AS c FROM packages").fetchone()["c"]
        att_count = r_conn.execute("SELECT COUNT(*) AS c FROM attachments").fetchone()["c"]
    finally:
        r_conn.close()

    return {
        "verified": True,
        "sqlite_integrity": "ok",
        "backup_id": manifest["backup_id"],
        "restored_db_path": str(restored_db),
        "restored_attachments_dir": str(restored_att_dir),
        "people_count": people_count,
        "evaluations_count": eval_count,
        "packages_count": pkg_count,
        "attachments_verified": att_count,
    }
