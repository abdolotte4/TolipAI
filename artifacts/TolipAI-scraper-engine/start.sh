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

PORT="${PORT:-8000}"
LOG_LEVEL="${LOG_LEVEL:-info}"

echo "[scraper] Listening on port $PORT"

exec "$PYTHON" -m uvicorn workers.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1 \
  --log-level "$LOG_LEVEL"
