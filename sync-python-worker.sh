#!/usr/bin/env bash
# sync-python-worker.sh — Mirror artifacts/TolipAI-scraper-engine → Agawish24/Python-Worker
#
# Run this from the Replit shell:
#   bash sync-python-worker.sh
#   bash sync-python-worker.sh "feat: my message"
#
# Requires: GITHUB_PERSONAL_ACCESS_TOKEN in Replit Secrets.
# Does NOT require git subtree — uses a clean clone+copy+push approach.

set -euo pipefail

TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-}"
if [ -z "${TOKEN}" ]; then
  echo "ERROR: GITHUB_PERSONAL_ACCESS_TOKEN is not set. Add it in Replit → Secrets." >&2
  exit 1
fi

PYTHON_WORKER_URL="https://${TOKEN}@github.com/Agawish24/Python-Worker.git"
SCRAPER_SRC="$(cd "$(dirname "$0")/artifacts/TolipAI-scraper-engine" && pwd)"
MSG="${1:-"chore: sync from Replit [$(date '+%Y-%m-%d %H:%M')]"}"

# Disable Replit's credential interceptor
export GIT_ASKPASS=""
export GIT_TERMINAL_PROMPT=0
GIT="git -c credential.helper="

echo "========================================================"
echo " Syncing artifacts/TolipAI-scraper-engine"
echo "       → github.com/Agawish24/Python-Worker"
echo "========================================================"
echo " commit: ${MSG}"
echo ""

# 1. Clone Python-Worker into a temp dir
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[1/4] Cloning Python-Worker (depth=1)..."
$GIT clone --depth=1 --quiet "${PYTHON_WORKER_URL}" "${TMP_DIR}"

# 2. Wipe all tracked content (preserve .git)
echo "[2/4] Clearing existing content..."
find "${TMP_DIR}" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

# 3. Copy the scraper engine directory (all files incl. hidden)
echo "[3/4] Copying ${SCRAPER_SRC}/ → repo root..."
cp -a "${SCRAPER_SRC}/." "${TMP_DIR}/"

# 4. Commit + push
echo "[4/4] Committing and pushing..."
cd "${TMP_DIR}"
git config user.email "replit-agent@tolipai.com"
git config user.name "Replit Agent"
git add -A

if git diff --cached --quiet; then
  echo ""
  echo "✓ Python-Worker is already up to date — nothing to push."
else
  STAT=$(git diff --cached --shortstat)
  git commit -m "${MSG}" --quiet
  $GIT push "${PYTHON_WORKER_URL}" main
  echo ""
  echo "✓ Pushed to Agawish24/Python-Worker"
  echo "  ${STAT}"
fi
