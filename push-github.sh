#!/usr/bin/env bash
# push-github.sh — Push TolipAI monorepo + sync scraper subtree to Python-Worker.
# Usage:   bash push-github.sh
#          bash push-github.sh "feat: my commit message"
# Requires GITHUB_PERSONAL_ACCESS_TOKEN to be set in Replit Secrets.

set -e

TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-}"
if [ -z "${TOKEN}" ]; then
  echo "ERROR: GITHUB_PERSONAL_ACCESS_TOKEN is not set. Add it in Replit → Secrets." >&2
  exit 1
fi

MSG="${1:-"chore: sync from Replit [$(date '+%Y-%m-%d %H:%M')]"}"

TolipAI_URL="https://${TOKEN}@github.com/Agawish24/TolipAI.git"
PYTHON_WORKER_URL="https://${TOKEN}@github.com/Agawish24/Python-Worker.git"
SCRAPER_DIR="artifacts/TolipAI-scraper-engine"

# Replit sets GIT_ASKPASS=replit-git-askpass which intercepts every push and
# prompts for a password even when credentials are embedded in the URL.
export GIT_ASKPASS=""
export GIT_TERMINAL_PROMPT=0

GIT="git -c credential.helper="

# ── 1. Stage + commit monorepo ────────────────────────────────────────────────
echo "=== Staging all changes ==="
git add -A

if git diff --cached --quiet; then
  echo "Nothing new to commit — already up to date."
else
  echo "=== Committing: ${MSG} ==="
  git commit -m "${MSG}"
fi

# ── 2. Push monorepo → Agawish24/TolipAI ─────────────────────────────────────
echo ""
echo "=== Pushing monorepo → Agawish24/TolipAI (main) ==="
$GIT push "${TolipAI_URL}" main
echo "✓ Monorepo push complete."

# ── 3. Sync scraper subtree → Agawish24/Python-Worker ────────────────────────
# Strategy: clone Python-Worker into a temp dir, wipe its contents (preserving
# .git), copy the scraper engine directory in, then commit + force-push.
# This sidesteps git-subtree completely — no subtree history required.
echo ""
echo "=== Syncing ${SCRAPER_DIR} → Agawish24/Python-Worker (main) ==="

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "  Cloning Python-Worker into ${TMP_DIR}..."
$GIT clone --depth=1 --quiet "${PYTHON_WORKER_URL}" "${TMP_DIR}"

echo "  Clearing repo contents (preserving .git)..."
# Remove everything except .git
find "${TMP_DIR}" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

echo "  Copying ${SCRAPER_DIR}/ → Python-Worker root..."
# Copy all files from the scraper engine dir (including hidden files like .gitignore)
cp -a "${SCRAPER_DIR}/." "${TMP_DIR}/"

echo "  Committing in Python-Worker clone..."
cd "${TMP_DIR}"
git config user.email "replit-agent@tolipai.com"
git config user.name "Replit Agent"
git add -A

if git diff --cached --quiet; then
  echo "  Python-Worker already up to date — nothing to push."
else
  git commit -m "${MSG}"
  echo "  Pushing to Agawish24/Python-Worker main..."
  $GIT push "${PYTHON_WORKER_URL}" main
  echo "  ✓ Python-Worker sync complete."
fi

cd - > /dev/null

echo ""
echo "✓ All pushes finished successfully."
