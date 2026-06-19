#!/bin/bash
# Run this in AWS CloudShell: https://console.aws.amazon.com/cloudshell/
# Updates DATABASE_URL in AWS Secrets Manager and creates placeholder secrets for critical values
#
# What this script does:
# 1. Searches AWS Secrets Manager for an existing DATABASE_URL secret (case-insensitive,
#    multiple name patterns: database, db_url, postgres, neon, etc.)
# 2. If found: updates it with the new Neon connection URL and verifies the value
# 3. If not found: creates a new secret named TolipAI-scraper/DATABASE_URL
# 4. Creates placeholder secrets for other critical configuration values if they don't exist
# 5. Prints a summary of what was changed and what still needs manual attention

set -euo pipefail

REGION="us-east-1"
NEW_DATABASE_URL="postgresql://neondb_owner:npg_vGaWn3bp4COq@ep-restless-waterfall-adcwhmet.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"
SECRET_PREFIX="TolipAI-scraper"

# ─────────────────────────────────────────────
# HELPER: pretty-print
# ─────────────────────────────────────────────
echo_header() {
  echo ""
  echo "========================================"
  echo "$1"
  echo "========================================"
}

# ─────────────────────────────────────────────
# 1. FIND & UPDATE DATABASE_URL
# ─────────────────────────────────────────────
echo_header "Step 1: Finding existing DATABASE_URL secret"

# Build a lowercase filter: any secret name containing these keywords
KEYWORDS=("database" "db_url" "dburl" "postgres" "neon" "rds" "aurora")
FILTER_EXPR=""
for kw in "${KEYWORDS[@]}"; do
  if [ -z "$FILTER_EXPR" ]; then
    FILTER_EXPR="contains(to_lower(Name), \`$kw\`)"
  else
    FILTER_EXPR="$FILTER_EXPR || contains(to_lower(Name), \`$kw\`)"
  fi
done

EXISTING_SECRETS=$(aws secretsmanager list-secrets \
  --region "$REGION" \
  --query "SecretList[?$FILTER_EXPR].Name" \
  --output text 2>/dev/null || true)

UPDATED_SECRET=""
if [ -n "$EXISTING_SECRETS" ] && [ "$EXISTING_SECRETS" != "None" ] && [ "$EXISTING_SECRETS" != "None " ]; then
  echo "Found existing secret(s):"
  for SECRET in $EXISTING_SECRETS; do
    echo "  - $SECRET"
  done

  # Update the first matching secret
  FIRST_SECRET=$(echo "$EXISTING_SECRETS" | awk '{print $1}')
  echo ""
  echo "Updating: $FIRST_SECRET"

  aws secretsmanager put-secret-value \
    --region "$REGION" \
    --secret-id "$FIRST_SECRET" \
    --secret-string "$NEW_DATABASE_URL"

  UPDATED_SECRET="$FIRST_SECRET"
  echo "✓ Updated $FIRST_SECRET"
else
  echo "No existing DATABASE_URL-like secret found. Creating new one..."
  aws secretsmanager create-secret \
    --region "$REGION" \
    --name "$SECRET_PREFIX/DATABASE_URL" \
    --secret-string "$NEW_DATABASE_URL" \
    --description "Database connection URL for TolipAI scraper (Neon Postgres)"

  UPDATED_SECRET="$SECRET_PREFIX/DATABASE_URL"
  echo "✓ Created $SECRET_PREFIX/DATABASE_URL"
fi

# ─────────────────────────────────────────────
# 2. VERIFY THE UPDATE
# ─────────────────────────────────────────────
echo_header "Step 2: Verifying the secret value"

RETRIEVED=$(aws secretsmanager get-secret-value \
  --region "$REGION" \
  --secret-id "$UPDATED_SECRET" \
  --query 'SecretString' \
  --output text)

if [ "$RETRIEVED" = "$NEW_DATABASE_URL" ]; then
  echo "✓ Verification PASSED: secret value matches the new URL"
else
  echo "✗ Verification FAILED: retrieved value does NOT match the new URL"
  echo "  Expected: $NEW_DATABASE_URL"
  echo "  Got:      $RETRIEVED"
  exit 1
fi

# ─────────────────────────────────────────────
# 3. CREATE PLACEHOLDER SECRETS (if missing)
# ─────────────────────────────────────────────
echo_header "Step 3: Checking / creating placeholder secrets"

# Array of: "SecretName|Description|PlaceholderValue"
PLACEHOLDERS=(
  "$SECRET_PREFIX/OPENAI_API_KEY|OpenAI API key for LLM features|sk-PLACEHOLDER-REPLACE-WITH-REAL-KEY"
  "$SECRET_PREFIX/ANTHROPIC_API_KEY|Anthropic API key for Claude features|sk-ant-PLACEHOLDER-REPLACE-WITH-REAL-KEY"
  "$SECRET_PREFIX/SERPAPI_KEY|SerpAPI key for web scraping|PLACEHOLDER-REPLACE-WITH-REAL-KEY"
  "$SECRET_PREFIX/JWT_SECRET|JWT signing secret for auth tokens|PLACEHOLDER-JWT-SECRET-MIN-32-CHARS"
  "$SECRET_PREFIX/REDIS_URL|Redis connection URL (upstash or elasticache)|redis://PLACEHOLDER:6379/0"
  "$SECRET_PREFIX/WEBHOOK_SECRET|Webhook HMAC secret for verifying callbacks|whsec-PLACEHOLDER-REPLACE-WITH-REAL-SECRET"
  "$SECRET_PREFIX/ENCRYPTION_KEY|AES-256 encryption key for sensitive data|PLACEHOLDER-32-BYTE-KEY-HERE"
)

CREATED_LIST=()
EXISTING_LIST=()

for entry in "${PLACEHOLDERS[@]}"; do
  IFS='|' read -r SECRET_NAME DESC PLACEHOLDER <<< "$entry"

  # Check if secret already exists
  EXISTS=$(aws secretsmanager list-secrets \
    --region "$REGION" \
    --query "SecretList[?Name==\`$SECRET_NAME\`].Name" \
    --output text 2>/dev/null || true)

  if [ -n "$EXISTS" ] && [ "$EXISTS" != "None" ] && [ "$EXISTS" != "None " ]; then
    echo "  • $SECRET_NAME — already exists (skipped)"
    EXISTING_LIST+=("$SECRET_NAME")
  else
    aws secretsmanager create-secret \
      --region "$REGION" \
      --name "$SECRET_NAME" \
      --secret-string "$PLACEHOLDER" \
      --description "$DESC (PLACEHOLDER — must be updated manually)" >/dev/null
    echo "  • $SECRET_NAME — created with placeholder"
    CREATED_LIST+=("$SECRET_NAME")
  fi
done

# ─────────────────────────────────────────────
# 4. SUMMARY
# ─────────────────────────────────────────────
echo_header "Summary"

echo "Updated database secret:"
echo "  → $UPDATED_SECRET"
echo ""
echo "New DATABASE_URL:"
echo "  $NEW_DATABASE_URL"
echo ""

if [ ${#CREATED_LIST[@]} -gt 0 ]; then
  echo "Placeholder secrets created (${#CREATED_LIST[@]}):"
  for s in "${CREATED_LIST[@]}"; do
    echo "  ⚠ $s  — ACTION REQUIRED: replace placeholder with real value"
  done
  echo ""
fi

if [ ${#EXISTING_LIST[@]} -gt 0 ]; then
  echo "Secrets already present (not modified): ${#EXISTING_LIST[@]}"
  for s in "${EXISTING_LIST[@]}"; do
    echo "  ✓ $s"
  done
  echo ""
fi

echo "========================================"
echo "✅ Database secret updated & verified!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Go to GitHub Actions and re-run the deploy workflow"
echo "  2. If any placeholder secrets were created above, open AWS Secrets Manager"
echo "     console and replace the placeholder values with real ones:"
echo "     https://console.aws.amazon.com/secretsmanager/listsecrets"
echo ""

