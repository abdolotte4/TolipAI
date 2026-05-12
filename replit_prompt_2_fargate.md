# Replit Agent Prompt #2: P1 — Fargate Migration & Package Cleanup

> **Priority:** P1 (Fix Second) — Remove non-Fargate code, clean packages, fix Docker.
> **Target:** AWS Fargate only. No Railway, Lambda, or Replit.
> **Repo:** `Agawish24/Python-Worker`

---

## PART 1: REMOVE NON-FARGATE ARTIFACTS

### 1.1 Delete Railway Files
```bash
rm Dockerfile
rm start.sh
rm requirements.railway.txt
```

### 1.2 Delete Lambda Files
```bash
rm Dockerfile.lambda
rm workers/lambda_handler.py
```

### 1.3 Remove Replit-Specific Code from `workers/main.py`
**Bug:** `_patch_ld_library_path()` patches LD_LIBRARY_PATH for NixOS/Replit.

**Fix:** Remove the entire function and its call.
```python
# DELETE these lines from workers/main.py:
# def _patch_ld_library_path() -> None:
#     ... (entire function)
# _patch_ld_library_path()
```

---

## PART 2: DOCKER FIXES

### 2.1 `Dockerfile.fargate` — Add `libpq5`
**Bug:** Final stage missing `libpq5`. `asyncpg` crashes at runtime.

**Fix:** Add to final stage:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*
```

### 2.2 `Dockerfile.fargate` — Install Playwright at Build Time
**Bug:** `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` prevents Chromium install.

**Fix:** Remove the env var and add install step:
```dockerfile
# REMOVE: ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# ADD:
RUN python -m playwright install chromium
```

### 2.3 `Dockerfile.fargate` — Remove YOLO Download
**Bug:** `YOLO('yolov8n.pt')` with `|| true` masks failures.

**Fix:** Remove YOLO download entirely.
```dockerfile
# DELETE these lines:
# RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" || true
```

### 2.4 `start.fargate.sh` — Simplify
**Bug:** May background Playwright install or run unnecessary setup.

**Fix:** Only run uvicorn.
```bash
#!/bin/bash
set -e

# Playwright browsers MUST be installed at Docker build time, not runtime
# If missing, the build failed — fail fast
if ! python3 -c "from playwright._impl._driver import compute_driver_executable; compute_driver_executable()" 2>/dev/null; then
    echo "ERROR: Playwright browsers not installed. Build the Docker image correctly."
    exit 1
fi

exec uvicorn workers.main:app --host 0.0.0.0 --port "${PORT:-8765}" --workers 1
```

---

## PART 3: CONSOLIDATE REQUIREMENTS

### 3.1 Merge and Rename
```bash
# Merge any unique deps from requirements.railway.txt into requirements.fargate.txt
# Then:
mv requirements.fargate.txt requirements.txt
```

### 3.2 Update `Dockerfile.fargate`
```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
```

---

## PART 4: PACKAGE CLEANUP — REMOVE BLOAT

Remove these packages from `requirements.txt`:

| Package | Size | Action | Replacement |
|---------|------|--------|-------------|
| `ultralytics` | ~500MB | Remove | GPT-4o-mini vision API |
| `opencv-python-headless` | ~80MB | Remove | `Pillow` (already present) |
| `pandas` | ~100MB | Remove | stdlib `csv` module |
| `numpy` | ~50MB | Remove | Only keep if another dep needs it |
| `anthropic` | ~25MB | Remove | Call via OpenRouter |
| `groq` | ~25MB | Remove | Call via OpenRouter |

### 4.1 Update `workers/scrapers/satellite_dfd.py`
**Bug:** Still imports `ultralytics` (wrapped in try/except).

**Fix:** Remove the import entirely.
```python
# DELETE:
# try:
#     from ultralytics import YOLO
#     _YOLO_AVAILABLE = True
# except ImportError:
#     _YOLO_AVAILABLE = False

# Set to False permanently:
_YOLO_AVAILABLE = False
```

### 4.2 Update `workers/main.py` `/debug/satellite`
**Bug:** Checks YOLO availability.

**Fix:** Remove YOLO check.
```python
# In /debug/satellite endpoint:
# REMOVE: "yolo_available": _YOLO_AVAILABLE,
# REMOVE: "yolo_note": ...
# Just show vision API status
```

### 4.3 Verify Remaining Dependencies
Ensure these are still in `requirements.txt`:
- `Pillow` — image processing
- `pytesseract` — OCR fallback
- `pdfplumber` — PDF parsing
- `PyMuPDF` — PDF parsing
- `httpx` — HTTP client
- `asyncpg` — Postgres
- `redis` — caching
- `playwright` — browser automation
- `crawl4ai` — web scraping
- `openai` or `openrouter` — AI calls

---

## PART 5: CROSS-REPO ALIGNMENT

### 5.1 Credential Passing (Python + Node.js)
**Python:** After fixing `propelio_v2._do_login()` and `propwire._do_login()` (from Prompt #1), update session test endpoints:
```python
@app.post("/session/propelio/test")
async def test_propelio_login(req: SessionTestRequest):
    # DON'T mutate os.environ
    # Pass credentials directly:
    await propelio_v2.search_property(
        "123 Main St, Dallas, TX 75201",
        email=req.email,
        password=req.password,
    )
```

**Node.js:** Don't decrypt before sending:
```typescript
// In scraperEngine.ts test endpoints:
// DON'T: const email = decryptPassword(rawEmail);
// DO: pass rawEmail (encrypted) to Python
res.json(await scraperEngine.testSession("propelio", rawEmail, rawPass));
```

### 5.2 API Key Header
**Node.js `scraperEngineClient.ts`:** (Already in Prompt #1, but verify)
```typescript
"X-API-Key": process.env.SCRAPER_API_KEY || "",
```

**Node.js `scraperEngine.ts` catch-all:**
```typescript
headers: {
  "content-type": "application/json",
  "X-API-Key": process.env.SCRAPER_API_KEY || "",
  ...(req.headers.authorization ? { "Authorization": req.headers.authorization } : {}),
},
```

---

## VERIFICATION (Prompt #2)
- [ ] `Dockerfile` (Railway) deleted
- [ ] `Dockerfile.lambda` deleted
- [ ] `start.sh` deleted
- [ ] `requirements.railway.txt` deleted
- [ ] `workers/lambda_handler.py` deleted
- [ ] `_patch_ld_library_path()` removed from `main.py`
- [ ] `Dockerfile.fargate` has `libpq5`
- [ ] `Dockerfile.fargate` installs Chromium at build time
- [ ] `Dockerfile.fargate` has no YOLO download
- [ ] `start.fargate.sh` only runs uvicorn
- [ ] `requirements.txt` exists (renamed from fargate)
- [ ] `ultralytics` removed from requirements
- [ ] `opencv-python-headless` removed
- [ ] `pandas` removed
- [ ] `numpy` removed (if safe)
- [ ] `anthropic` removed
- [ ] `groq` removed
- [ ] `satellite_dfd.py` no longer imports `ultralytics`
- [ ] `/debug/satellite` endpoint doesn't mention YOLO
- [ ] Docker build succeeds
- [ ] Image size reduced by ~500-700MB
