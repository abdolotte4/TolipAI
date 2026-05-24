#!/bin/bash
set -e

# 1. Trigger workflow
echo "Triggering GitHub Actions deploy..."
gh workflow run deploy.yml \
  --repo Agawish24/Python-Worker \
  --ref main

# 2. Wait for run to appear
sleep 15

# 3. Get latest run ID
RUN_ID=$(gh run list \
  --repo Agawish24/Python-Worker \
  --workflow=deploy.yml \
  --limit 1 \
  --json databaseId \
  -q '.[0].databaseId')

echo "Run ID: $RUN_ID"

# 4. Watch until completion
gh run watch "$RUN_ID" --repo Agawish24/Python-Worker

# 5. Check result
STATUS=$(gh run view "$RUN_ID" \
  --repo Agawish24/Python-Worker \
  --json conclusion \
  -q '.conclusion')

if [ "$STATUS" = "success" ]; then
  echo "✅ Deploy succeeded"
else
  echo "❌ Deploy failed: $STATUS"
  exit 1
fi
