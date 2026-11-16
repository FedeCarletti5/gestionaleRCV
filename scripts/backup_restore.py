#!/usr/bin/env python3
"""
Strumento CLI per Backup Automatici Cifrati (AES-256-CBC + PBKDF2 + HMAC-SHA256)
e Procedura di Ripristino Verificata in ambiente di prova.

Uso:
  python3 scripts/backup_restore.py create
  python3 scripts/backup_restore.py verify-latest
  python3 scripts/backup_restore.py restore <percorso_file.zip.enc> <cartella_destinazione>
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import get_backups_dir
from backend.services import create_encrypted_backup, restore_and_verify_backup


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "create"
    if cmd == "create":
        meta = create_encrypted_backup(actor="CLI Backup")
        print(json.dumps(meta, indent=2, ensure_ascii=False))
    elif cmd == "verify-latest":
        bkp_dir = get_backups_dir()
        candidates = sorted(bkp_dir.glob("*.zip.enc"), reverse=True)
        if not candidates:
            meta = create_encrypted_backup(actor="CLI Backup")
            latest = Path(meta["encrypted_path"])
        else:
            latest = candidates[0]
        with tempfile.TemporaryDirectory() as tmp:
            res = restore_and_verify_backup(latest, Path(tmp))
            print(json.dumps(res, indent=2, ensure_ascii=False))
    elif cmd == "restore":
        if len(sys.argv) < 4:
            print("Uso: python3 scripts/backup_restore.py restore <file.zip.enc> <destinazione>")
            sys.exit(1)
        enc_path = Path(sys.argv[2]).resolve()
        dst_dir = Path(sys.argv[3]).resolve()
        res = restore_and_verify_backup(enc_path, dst_dir)
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        print(f"Comando non riconosciuto: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
