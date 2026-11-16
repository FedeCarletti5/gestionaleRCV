#!/usr/bin/env python3
"""
Avvio principale del Gestionale Personale Fisio + Fitness.
Uso:
  python3 run.py                    # Avvia in modalità DEMO (dati fittizi separati) su http://127.0.0.1:8080
  GESTIONALE_ENV=prod python3 run.py # Avvia in modalità PROD (database reale vuoto separato)
"""
import argparse
import os
from backend.config import get_attachments_dir, get_backups_dir, get_db_path, get_env_mode
from backend.db import init_db
from backend.server import create_http_server
from scripts.seed_demo import seed_fictitious_data


def main() -> None:
    parser = argparse.ArgumentParser(description="Avvio Gestionale Personale Fisio + Fitness")
    parser.add_argument("--prod", action="store_true", help="Avvia con database reale vuoto (PROD)")
    parser.add_argument("--host", default=None, help="Indirizzo di ascolto (es. 0.0.0.0 per accesso da iPhone/iPad)")
    parser.add_argument("--port", type=int, default=None, help="Porta HTTP (default: 8080)")
    args, _ = parser.parse_known_args()

    if args.prod:
        os.environ["GESTIONALE_ENV"] = "prod"
    if args.host:
        os.environ["GESTIONALE_HOST"] = args.host
    if args.port:
        os.environ["GESTIONALE_PORT"] = str(args.port)

    mode = get_env_mode()
    db_path = get_db_path(mode)
    att_dir = get_attachments_dir(mode)
    bkp_dir = get_backups_dir(mode)

    init_db(db_path)
    if mode == "demo":
        seed_fictitious_data(db_path=db_path, attachments_dir=att_dir)

    host = os.environ.get("GESTIONALE_HOST", "127.0.0.1")
    port = int(os.environ.get("GESTIONALE_PORT", "8080"))

    srv = create_http_server(
        host=host,
        port=port,
        db_path=db_path,
        attachments_dir=att_dir,
        backups_dir=bkp_dir,
    )
    print("=" * 72)
    print(f" Gestionale Personale Fisio + Fitness avviato [{mode.upper()}]")
    print(f" URL:      http://{host}:{port}")
    print(f" Database: {db_path}")
    print(f" Allegati: {att_dir}")
    print(f" Backup:   {bkp_dir}")
    print(" Credenziali iniziali: utente 'admin' / password 'FisioFitness2026!'")
    print("=" * 72)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nArresto del server completato.")
        srv.server_close()


if __name__ == "__main__":
    main()
