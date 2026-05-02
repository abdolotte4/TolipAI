#!/usr/bin/env bash
# Push Digor changes to both GitHub repos.
# Run after the Replit auto-commit: bash push_github.sh
set -e
TOKEN="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"
MONO="https://${TOKEN}@github.com/Agawish24/Digor.git"
PW="https://${TOKEN}@github.com/Agawish24/Python-Worker.git"

echo "=== Pushing monorepo → Agawish24/Digor ==="
git push "$MONO" main

echo ""
echo "=== Pushing Python worker subtree → Agawish24/Python-Worker ==="
git subtree push --prefix=artifacts/digor-scraper-engine "$PW" main

echo ""
echo "✓ Both repos updated. Railway will auto-redeploy from Python-Worker."
