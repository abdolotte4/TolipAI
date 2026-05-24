#!/usr/bin/env bash
# start.sh — Local / Replit startup script for TolipAI Scraper Engine
# Uses Python 3.11 from .pythonlibs (where fastapi, uvicorn, playwright etc. are installed).
# For production Fargate deployments use start.fargate.sh instead.

set -euo pipefail

echo "[scraper] Starting TolipAI Scraper Engine (local/Replit mode)..."

# Resolve Python 3.11 from Replit's .pythonlibs (preferred) or fall back to system python3
PYTHON=""
for candidate in \
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
  echo "[scraper] ERROR: python3.11 not found. Install via Replit's package manager." >&2
  exit 1
fi

echo "[scraper] Using Python: $PYTHON ($($PYTHON --version))"

# Warn (don't fail) if optional services not configured
[ -z "${DATABASE_URL:-}" ] && echo "[scraper] WARN: DATABASE_URL not set — DB features disabled"
[ -z "${REDIS_URL:-}" ]    && echo "[scraper] WARN: REDIS_URL not set — using in-memory job store"
[ -z "${GROQ_API_KEY:-}" ] && echo "[scraper] WARN: GROQ_API_KEY not set — AI features disabled"
[ -z "${SCRAPER_API_KEY:-}" ] && echo "[scraper] WARN: SCRAPER_API_KEY not set — endpoints unprotected"

# Install Playwright browser (Chromium) if not already present — needed for Propelio/Propwire/Zillow scrapers.
# This is a no-op if the browser is already installed; takes ~30s on first run.
PLAYWRIGHT_BIN="$($PYTHON -c 'import sys; print(sys.prefix)' 2>/dev/null)/bin/playwright"
if [ -x "$PLAYWRIGHT_BIN" ]; then
  echo "[scraper] Installing Playwright Chromium browser (first-time setup)..."
  "$PLAYWRIGHT_BIN" install chromium --with-deps 2>&1 | tail -3 || echo "[scraper] WARN: Playwright browser install failed — browser scrapers will be disabled"
else
  echo "[scraper] WARN: playwright CLI not found — browser scrapers will be disabled"
fi

PORT="${PORT:-8000}"
LOG_LEVEL="${LOG_LEVEL:-info}"

echo "[scraper] Listening on port $PORT"

exec "$PYTHON" -m uvicorn workers.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1 \
  --log-level "$LOG_LEVEL"
