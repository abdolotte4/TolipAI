#!/usr/bin/env bash
# start.sh — Local / Replit startup script for TolipAI Scraper Engine
# Uses the .venv virtual environment (created by uv venv) which has all packages.
# For production Fargate deployments use start.fargate.sh instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[scraper] Starting TolipAI Scraper Engine (local/Replit mode)..."

# Force-kill any stale process holding PORT before we do anything else.
# We use SIGKILL (not SIGTERM) because SpotHandler traps SIGTERM for 90s drain.
# fuser may not have cross-session permissions in Replit — use Python via /proc instead.
_PORT="${PORT:-8000}"
python3 - <<PYEOF 2>/dev/null || true
import os, signal, socket, struct

port = int(os.environ.get('PORT', '${_PORT}'))
hex_port = format(port, '04X')

# Read /proc/net/tcp to find inodes listening on our port
inodes = set()
for proto in ['/proc/net/tcp', '/proc/net/tcp6']:
    try:
        with open(proto) as f:
            for line in f:
                parts = line.split()
                if len(parts) < 10: continue
                local, state = parts[1], parts[3]
                if local.endswith(':' + hex_port) and state == '0A':  # 0A = LISTEN
                    inodes.add(parts[9])
    except: pass

if not inodes: raise SystemExit(0)

# Find PIDs that own those inodes
pids = set()
for pid in os.listdir('/proc'):
    if not pid.isdigit(): continue
    fd_dir = f'/proc/{pid}/fd'
    try:
        for fd in os.listdir(fd_dir):
            try:
                link = os.readlink(f'{fd_dir}/{fd}')
                if link.startswith('socket:['):
                    inode = link[8:-1]
                    if inode in inodes:
                        pids.add(int(pid))
            except: pass
    except: pass

my_pid = os.getpid()
for pid in pids:
    if pid != my_pid:
        try:
            os.kill(pid, signal.SIGKILL)
            print(f'[scraper] Killed stale process PID {pid} on port {port}')
        except Exception as e:
            print(f'[scraper] Could not kill PID {pid}: {e}')
PYEOF
sleep 1

# ── Python resolution: prefer .venv, then .pythonlibs, then system ────────────
PYTHON=""
for candidate in \
  "$SCRIPT_DIR/.venv/bin/python" \
  "$SCRIPT_DIR/.venv/bin/python3" \
  "/home/runner/workspace/.pythonlibs/bin/python3.11" \
  "/home/runner/.pythonlibs/bin/python3.11" \
  "$(which python3.11 2>/dev/null || true)" \
  "$(which python3 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "[scraper] ERROR: python3.11 not found." >&2
  exit 1
fi

echo "[scraper] Using Python: $PYTHON ($($PYTHON --version))"

# ── Bootstrap venv if packages are missing ────────────────────────────────────
if ! "$PYTHON" -c "import fastapi, uvicorn" 2>/dev/null; then
  echo "[scraper] Packages missing — bootstrapping .venv..."
  if command -v uv &>/dev/null; then
    uv venv "$SCRIPT_DIR/.venv" --python python3.11 2>/dev/null || true
    PYTHON="$SCRIPT_DIR/.venv/bin/python"
    uv pip install --python "$PYTHON" \
      "fastapi==0.115.12" "uvicorn[standard]==0.34.0" "pydantic==2.11.3" \
      "python-multipart==0.0.20" "python-dotenv==1.0.1" "asyncpg==0.30.0" \
      "orjson==3.10.16" "cryptography==44.0.2" "python-json-logger==3.3.0" \
      "psutil==6.1.1" "redis[hiredis]==5.2.1" "httpx[http2]>=0.27.2,<1" \
      "tenacity==9.0.0" "aiohttp==3.11.18" "cachetools==5.5.2" \
      "openai>=1.32,<2" "beautifulsoup4==4.13.3" "lxml>=5.3.1,<6" \
      "Pillow>=10.4.0,<11" "geopy==2.4.1" "shapely==2.1.0" \
      "PyMuPDF==1.25.5" "pdfplumber==0.11.5" "pytesseract==0.3.13" \
      "aioboto3==13.4.0" 2>&1 | tail -5
  else
    echo "[scraper] WARN: uv not found — cannot auto-install packages" >&2
  fi
fi

# ── Optional service warnings ─────────────────────────────────────────────────
[ -z "${DATABASE_URL:-}" ]    && echo "[scraper] WARN: DATABASE_URL not set — DB features disabled"
[ -z "${REDIS_URL:-}" ]       && echo "[scraper] WARN: REDIS_URL not set — using in-memory job store"
[ -z "${GROQ_API_KEY:-}" ]    && echo "[scraper] WARN: GROQ_API_KEY not set — AI features disabled"
[ -z "${SCRAPER_API_KEY:-}" ] && echo "[scraper] WARN: SCRAPER_API_KEY not set — endpoints unprotected"

# ── Playwright browser (optional) ─────────────────────────────────────────────
PLAYWRIGHT_BIN="$($PYTHON -c 'import sys; print(sys.prefix)' 2>/dev/null)/bin/playwright"
if [ -x "$PLAYWRIGHT_BIN" ]; then
  echo "[scraper] Installing Playwright Chromium browser (first-time setup)..."
  "$PLAYWRIGHT_BIN" install chromium --with-deps 2>&1 | tail -3 || echo "[scraper] WARN: Playwright browser install failed"
else
  echo "[scraper] WARN: playwright CLI not found — browser scrapers will be disabled"
fi

PORT="${PORT:-8000}"
LOG_LEVEL="${LOG_LEVEL:-info}"

echo "[scraper] Listening on port $PORT"

cd "$SCRIPT_DIR"
exec "$PYTHON" -m uvicorn workers.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1 \
  --log-level "$LOG_LEVEL"
