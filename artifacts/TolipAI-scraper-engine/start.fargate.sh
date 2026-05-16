#!/usr/bin/env bash
# start.fargate.sh — Fargate Spot-aware startup script
#
# Differences from start.sh (Railway/Replit):
#  • No Nix store path resolution needed (Debian/Ubuntu on Fargate)
#  • Playwright browsers pre-baked in image layer (no download at runtime)
#  • Structured JSON logging to stdout → CloudWatch
#  • Graceful shutdown via spot_handler.py (SIGTERM → 90s drain)
#  • Health check readiness via /health endpoint
#  • ECS metadata endpoint logged for task correlation

set -euo pipefail

echo '{"level":"info","msg":"Fargate scraper starting","ts":"'"$(date -u +%FT%TZ)"'"}'

# ── ECS metadata (task ARN, cluster, AZ) for CloudWatch correlation ──────────
if [ -n "${ECS_CONTAINER_METADATA_URI_V4:-}" ]; then
  META=$(curl -sf "${ECS_CONTAINER_METADATA_URI_V4}/task" 2>/dev/null || echo '{}')
  TASK_ARN=$(echo "$META" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('TaskARN','unknown'))" 2>/dev/null || echo "unknown")
  echo '{"level":"info","msg":"ECS task metadata","task_arn":"'"$TASK_ARN"'","ts":"'"$(date -u +%FT%TZ)"'"}'
fi

# ── Pre-flight checks ────────────────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  echo '{"level":"fatal","msg":"DATABASE_URL is not set — cannot start","ts":"'"$(date -u +%FT%TZ)"'"}' >&2
  exit 1
fi

if [ -z "${REDIS_URL:-}" ] && [ -z "${REDIS_PRIVATE_URL:-}" ]; then
  echo '{"level":"warn","msg":"REDIS_URL not set — job state will not survive interruptions","ts":"'"$(date -u +%FT%TZ)"'"}'
fi

if [ -z "${SCRAPER_API_KEY:-}" ]; then
  echo '{"level":"warn","msg":"SCRAPER_API_KEY not set — API endpoints are unprotected","ts":"'"$(date -u +%FT%TZ)"'"}'
fi

# ── Verify Playwright Chromium (pre-baked in image) ──────────────────────────
if ! python3 -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); p.stop()" 2>/dev/null; then
  echo '{"level":"warn","msg":"Playwright self-check failed — browser features may be unavailable","ts":"'"$(date -u +%FT%TZ)"'"}'
fi

# ── Launch uvicorn with JSON logging ─────────────────────────────────────────
# --workers 1  : one Uvicorn worker per Fargate task (scale out via ECS, not threads)
# --log-config : structured JSON logs to stdout → CloudWatch Logs
# SIGTERM is forwarded by Fargate to uvicorn → spot_handler.py catches it

echo '{"level":"info","msg":"Starting uvicorn","port":"'"${PORT:-8765}"'","ts":"'"$(date -u +%FT%TZ)"'"}'

exec python3 -m uvicorn workers.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8765}" \
  --workers 1 \
  --loop uvloop \
  --log-level "${LOG_LEVEL:-info}" \
  --no-access-log \
  --timeout-graceful-shutdown 90
