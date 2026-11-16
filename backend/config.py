import os
import json
import secrets
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_ROOT = Path(os.environ.get("GESTIONALE_DATA_ROOT", str(BASE_DIR / "data")))
TIMEZONE_NAME = "Europe/Rome"
ROME_TZ = ZoneInfo(TIMEZONE_NAME)


def get_env_mode() -> str:
    """Restituisce l'ambiente attivo: 'demo' (default con dati fittizi), 'prod' (dati reali) o 'test'."""
    mode = os.environ.get("GESTIONALE_ENV", "demo").strip().lower()
    if mode not in ("demo", "prod", "test"):
        mode = "demo"
    return mode


def get_env_dir(mode: str = None) -> Path:
    mode = mode or get_env_mode()
    env_dir = DATA_ROOT / mode
    env_dir.mkdir(parents=True, exist_ok=True)
    return env_dir


def get_db_path(mode: str = None) -> Path:
    if "GESTIONALE_DB_PATH" in os.environ and mode is None:
        p = Path(os.environ["GESTIONALE_DB_PATH"])
        p.parent.mkdir(parents=True, exist_ok=True)
        return p
    env_dir = get_env_dir(mode)
    return env_dir / f"gestionale_{mode or get_env_mode()}.sqlite"


def get_attachments_dir(mode: str = None) -> Path:
    if "GESTIONALE_ATTACHMENTS_DIR" in os.environ and mode is None:
        p = Path(os.environ["GESTIONALE_ATTACHMENTS_DIR"])
        p.mkdir(parents=True, exist_ok=True)
        return p
    env_dir = get_env_dir(mode)
    att_dir = env_dir / "attachments"
    att_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(att_dir, 0o700)
    except OSError:
        pass
    return att_dir


def get_backups_dir(mode: str = None) -> Path:
    env_dir = get_env_dir(mode)
    bkp_dir = env_dir / "backups"
    bkp_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(bkp_dir, 0o700)
    except OSError:
        pass
    return bkp_dir


def load_or_create_secrets() -> dict:
    """
    Carica i segreti da variabili d'ambiente o dal file privato `data/secrets.json` (permessi 0600),
    mantenendo tutte le chiavi crittografiche fuori dal codice sorgente.
    """
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    secrets_file = DATA_ROOT / "secrets.json"
    data = {}
    if secrets_file.exists():
        try:
            with open(secrets_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}

    changed = False
    if "session_secret" not in data:
        data["session_secret"] = secrets.token_hex(32)
        changed = True
    if "backup_passphrase" not in data:
        data["backup_passphrase"] = secrets.token_urlsafe(32)
        changed = True
    if "totp_encryption_key" not in data:
        data["totp_encryption_key"] = secrets.token_hex(32)
        changed = True

    if changed:
        with open(secrets_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        try:
            os.chmod(secrets_file, 0o600)
        except OSError:
            pass

    if os.environ.get("GESTIONALE_SESSION_SECRET"):
        data["session_secret"] = os.environ["GESTIONALE_SESSION_SECRET"]
    if os.environ.get("GESTIONALE_BACKUP_PASSPHRASE"):
        data["backup_passphrase"] = os.environ["GESTIONALE_BACKUP_PASSPHRASE"]

    return data
