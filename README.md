# Gestionale Personale Fisio + Fitness

Web App / PWA personale progettata per il lavoro quotidiano di **Fisioterapia** e **Personal Training** su **Mac, iPad e iPhone**, incentrata sul principio **"Una persona, più percorsi"** con persistenza relazionale SQLite ACID, autenticazione robusta + 2FA TOTP, controllo concorrenza multi-dispositivo (`409 Conflict`), storage privato degli allegati e backup cifrati verificati (`AES-256-CBC + PBKDF2 + HMAC-SHA256`).

---

## 1. Avvio Rapido su Mac

Il progetto utilizza esclusivamente Python 3, SQLite 3 e OpenSSL già presenti su macOS (zero costi ricorrenti e zero dipendenze esterne).

### Avvio con Dati Fittizi di Prova (Ambiente `DEMO`, predefinito)
```bash
python3 run.py
```
Apri Safari o Chrome su: **http://127.0.0.1:8080**
- **Utente iniziale:** `admin`
- **Password iniziale:** `FisioFitness2026!`
- **Secondo fattore (2FA TOTP):** attivabile dalla sezione *🔒 Sicurezza, Backup & GDPR*.

### Avvio con Database Reale Pulito (Ambiente `PROD`, separato dai dati fittizi)
```bash
GESTIONALE_ENV=prod python3 run.py
```
I database e gli allegati sono fisicamente separati:
- `data/demo/` → Database e allegati fittizi di test
- `data/prod/` → Database e allegati reali
- `data/secrets.json` → Segreti crittografici (permessi `0600`, escluso da Git via `.gitignore`)

---

## 2. Utilizzo da Mac, iPad e iPhone (PWA Sincronizzata)

- **In studio / rete privata (Consigliato a costo € 0):** installando **Tailscale** su Mac, iPad e iPhone e avviando con `GESTIONALE_HOST=0.0.0.0 python3 run.py`, puoi raggiungere il gestionale dal tuo iPad e iPhone ovunque ti trovi su connessione cifrata punto-punto WireGuard.
- **Installazione come App (PWA):** su iPad e iPhone apri l'indirizzo in **Safari**, tocca **Condividi → Aggiungi alla schermata Home**. Su Mac in Safari usa **File → Aggiungi al Dock**.
- **Online-First e Sicurezza Cache:** il Service Worker (`frontend/sw.js`) mette in cache solo i file statici dell'interfaccia (`.css`, `.js`, icone) e **non salva mai** cartelle cliniche, note o allegati nella cache offline del dispositivo (`Cache-Control: no-store`).

---

## 3. Backup Cifrati e Procedura di Ripristino Verificata

```bash
# Crea un backup cifrato AES-256 (DB atomico + allegati privati + firma HMAC-SHA256)
python3 scripts/backup_restore.py create

# Verifica decifratura, integrità SQLite e SHA-256 degli allegati in ambiente isolato di prova
python3 scripts/backup_restore.py verify-latest

# Ripristina un backup specifico in una cartella di destinazione
python3 scripts/backup_restore.py restore data/demo/backups/<file.zip.enc> /percorso/ripristino
```

---

## 4. Esecuzione dei Test Automatizzati di Accettazione

```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```
