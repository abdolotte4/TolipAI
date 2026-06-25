---
name: TolipAI CRM setup
description: Admin credentials, DB state, working/broken features after session fixes
---

## Admin Credentials (local Replit DB)
- `admin@tolipaicrm.com` — id=2, password=Admin4413$AbdoKing, super_admin (seeded by seed.ts on startup)
- `admin@digorcrm.com`   — id=3, password=Admin4413$AbdoKing, super_admin (manually inserted)
- **Always generate bcrypt hash with Node bcryptjs (salt=12) not bash heredoc** — bash $-interpolation corrupts the hash

## DB
- DATABASE_URL = `postgresql://postgres:password@helium/heliumdb?sslmode=disable` (Replit local)
- 10 test leads + 1 campaign seeded via `psql ... -f seed.sql`
- User's real Neon DB URL is NOT in Replit secrets — user must add it manually

## Features confirmed working (local)
- 18/18 CRM/Twilio endpoints return 200
- Skip-trace: PropertyAPI POST /api/v1/skip-trace works, key rotation retry loop fixed
- Google Maps: POST /api/scraper/google-maps with x-tools-pin header
- safeInsertCallLog: POST /twilio/voice/log returns 200 (was 500 before)
- PDF parsing: PyMuPDF → pdfplumber → OCR chain works; pytesseract import is now optional

## Features NOT working locally (by design or dependency)
- Cash buyers (Propelio): requires real Propelio credentials + CAPTCHA — blocked in local dev
- Cash buyers (Propwire): DataDome CAPTCHA blocks login — needs CAPTCHA_API_KEY service
- Cash buyers (homeharvest/Zillow/Redfin): works in Docker; local Python can't install via pip (xmlrpc/expat Nix bug)
- Twilio reconfigure-twiml: 401 expected if Twilio creds not set
- Property data fetch: ATTOM fallback fails; PropertyAPI address lookup only works for some ZIPs
