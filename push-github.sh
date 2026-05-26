#!/usr/bin/env bash
# push-github.sh — Push TolipAI monorepo and Python-Worker subtree to GitHub.
# Usage:   bash push-github.sh
#          bash push-github.sh "feat: my commit message"
# Requires GAWISH_GIT_TOKEN to be set in Replit Secrets.

set -e

TOKEN="${GAWISH_GIT_TOKEN:-}"
if [ -z "${TOKEN}" ]; then
  echo "ERROR: GAWISH_GIT_TOKEN is not set. Add it in Replit → Secrets." >&2
  exit 1
fi

MSG="${1:-"chore: sync from Replit [$(date '+%Y-%m-%d %H:%M')]"}"

MONO_URL="https://${TOKEN}@github.com/Agawish24/TolipAI.git"
WORKER_URL="https://${TOKEN}@github.com/Agawish24/Python-Worker.git"

echo "=== Staging all changes ==="
git add -A

if git diff --cached --quiet; then
  echo "Nothing new to commit — already up to date."
else
  echo "=== Committing: ${MSG} ==="
  git commit -m "${MSG}"
fi

echo ""
echo "=== Pushing monorepo → Agawish24/TolipAI (main) ==="
git push "${MONO_URL}" main
echo "✓ Monorepo push complete."

echo ""
echo "=== Splitting subtree: artifacts/TolipAI-scraper-engine → Python-Worker (main) ==="
SHA=$(git subtree split --prefix=artifacts/TolipAI-scraper-engine main)
git push "${WORKER_URL}" "${SHA}:main" --force
echo "✓ Subtree push complete."

echo ""
echo "✓ All pushes finished successfully."
