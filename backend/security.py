import os
import time
import hmac
import base64
import struct
import hashlib
import secrets
import subprocess
from pathlib import Path
from typing import Optional, Tuple, List

PBKDF2_ITERATIONS = 600_000


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """Genera hash PBKDF2-HMAC-SHA256 con 600.000 iterazioni."""
    if not salt:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verifica password in tempo costante contro stored_hash."""
    try:
        algo, iter_str, salt, expected_hex = stored_hash.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iter_str)
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return hmac.compare_digest(dk.hex(), expected_hex)
    except Exception:
        return False


def generate_totp_secret() -> str:
    """Genera un segreto Base32 compatibile RFC 6238 per app di autenticazione (Apple Passwords, Authy, ecc.)."""
    raw = secrets.token_bytes(20)
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def get_totp_code(secret_b32: str, timestamp: Optional[ float ] = None, step: int = 30, digits: int = 6) -> str:
    """Calcola il codice TOTP a 6 cifre secondo RFC 6238 / RFC 4226."""
    if timestamp is None:
        timestamp = time.time()
    clean_secret = secret_b32.strip().replace(" ", "").upper()
    pad_len = (8 - len(clean_secret) % 8) % 8
    key = base64.b32decode(clean_secret + ("=" * pad_len), casefold=True)
    counter = int(timestamp // step)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**digits)
    return str(code_int).zfill(digits)


def verify_totp_code(secret_b32: str, code: str, timestamp: Optional[float] = None, window: int = 1) -> bool:
    """Verifica un codice TOTP a 6 cifre tollerando +-1 finestra di 30s per eventuale clock drift."""
    if not secret_b32 or not code:
        return False
    clean_code = code.strip().replace(" ", "")
    if not clean_code.isdigit() or len(clean_code) != 6:
        return False
    now = timestamp if timestamp is not None else time.time()
    for offset in range(-window, window + 1):
        candidate = get_totp_code(secret_b32, timestamp=now + (offset * 30))
        if hmac.compare_digest(candidate, clean_code):
            return True
    return False


def build_otpauth_uri(secret_b32: str, account_name: str, issuer: str = "GestionaleFisioFitness") -> str:
    """Restituisce l'URI standard otpauth:// per configurare il secondo fattore."""
    from urllib.parse import quote
    label = quote(f"{issuer}:{account_name}")
    return f"otpauth://totp/{label}?secret={secret_b32}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"


def generate_recovery_codes(count: int = 6) -> Tuple[List[str], List[str]]:
    """Genera codici di recupero monouso in chiaro e i relativi hash SHA-256."""
    plain_codes = []
    hashed_codes = []
    for _ in range(count):
        c = f"{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
        plain_codes.append(c)
        hashed_codes.append(hashlib.sha256(c.encode("utf-8")).hexdigest())
    return plain_codes, hashed_codes


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def encrypt_file_aes256(input_path: Path, output_path: Path, passphrase: str) -> str:
    """
    Cifra un file con OpenSSL AES-256-CBC + PBKDF2 (600.000 iterazioni) e calcola HMAC-SHA256 del file cifrato.
    Restituisce l'HMAC-SHA256 esadecimale per verifica di integrità prima della decifratura.
    """
    env = os.environ.copy()
    env["BKP_PASS"] = passphrase
    cmd = [
        "/usr/bin/openssl",
        "enc",
        "-aes-256-cbc",
        "-pbkdf2",
        "-iter",
        "600000",
        "-salt",
        "-in",
        str(input_path),
        "-out",
        str(output_path),
        "-pass",
        "env:BKP_PASS",
    ]
    res = subprocess.run(cmd, env=env, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError(f"Errore cifratura backup OpenSSL: {res.stderr.strip()}")
    try:
        os.chmod(output_path, 0o600)
    except OSError:
        pass
    mac_key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), b"backup-hmac-salt", 100_000)
    h = hmac.new(mac_key, digestmod=hashlib.sha256)
    with open(output_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def decrypt_file_aes256(encrypted_path: Path, output_path: Path, passphrase: str, expected_hmac: Optional[str] = None) -> None:
    """
    Verifica l'autenticità (HMAC-SHA256) se fornita e decifra un archivio di backup AES-256-CBC.
    """
    if expected_hmac:
        mac_key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), b"backup-hmac-salt", 100_000)
        h = hmac.new(mac_key, digestmod=hashlib.sha256)
        with open(encrypted_path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        if not hmac.compare_digest(h.hexdigest(), expected_hmac):
            raise ValueError("Verifica di integrità HMAC fallita: file di backup manomesso o passphrase errata.")

    env = os.environ.copy()
    env["BKP_PASS"] = passphrase
    cmd = [
        "/usr/bin/openssl",
        "enc",
        "-d",
        "-aes-256-cbc",
        "-pbkdf2",
        "-iter",
        "600000",
        "-in",
        str(encrypted_path),
        "-out",
        str(output_path),
        "-pass",
        "env:BKP_PASS",
    ]
    res = subprocess.run(cmd, env=env, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError(f"Errore decifratura backup OpenSSL: {res.stderr.strip()}")
