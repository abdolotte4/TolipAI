#!/usr/bin/env bash
# auto-push.sh — Automated periodic push to GitHub.
#
# Run once in background:
#   bash auto-push.sh &
#
# Push once and exit (e.g. from a cron job):
#   bash auto-push.sh --once
#
# Custom interval (seconds):
#   AUTO_PUSH_INTERVAL=900 bash auto-push.sh &   # every 15 min
#
# Requires GAWISH_GIT_TOKEN in Replit Secrets.
set -euo pipefail

TOKEN="${GAWISH_GIT_TOKEN:-}"
if [ -z "${TOKEN}" ]; then
  echo "ERROR: GAWISH_GIT_TOKEN is not set." >&2
  exit 1
fi

MONO_URL="https://${TOKEN}@github.com/Agawish24/TolipAI.git"
INTERVAL="${AUTO_PUSH_INTERVAL:-1800}"

push_once() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  git add -A 2>/dev/null || true
  if git diff --cached --quiet 2>/dev/null; then
    echo "[${ts}] Nothing to commit — skipping push."
    return 0
  fi
  git commit -m "chore: auto-sync from Replit [${ts}]" 2>/dev/null || true
  if git push "${MONO_URL}" main 2>/dev/null; then
    echo "[${ts}] ✓ Pushed to GitHub."
  else
    echo "[${ts}] ✗ Push failed — will retry next interval."
  fi
}

if [ "${1:-}" = "--once" ]; then
  push_once
  exit 0
fi

echo "[auto-push] Started — interval: ${INTERVAL}s. Press Ctrl-C to stop."
while true; do
  push_once
  sleep "${INTERVAL}"
done
