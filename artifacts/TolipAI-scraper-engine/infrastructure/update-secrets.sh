#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# update-secrets.sh — Create or update all AWS Secrets Manager secrets needed
# by the TolipAI scraper ECS task.
#
# Run this ONCE after setting up a new DB or rotating credentials.
# Prerequisites: AWS CLI configured with sufficient permissions
#   (secretsmanager:CreateSecret + secretsmanager:PutSecretValue)
#
# Usage:
#   export DATABASE_URL="postgresql://..."
#   export SCRAPER_API_KEY="..."
#   bash infrastructure/update-secrets.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"

put_secret() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "  SKIP  $name (empty — set the env var to populate)"
    return
  fi
  # Create if missing, update if exists
  if aws secretsmanager describe-secret --secret-id "$name" --region "$REGION" &>/dev/null; then
    aws secretsmanager put-secret-value \
      --secret-id "$name" \
      --secret-string "$value" \
      --region "$REGION" \
      --output text --query 'Name' | xargs -I{} echo "  UPDATED  {}"
  else
    aws secretsmanager create-secret \
      --name "$name" \
      --secret-string "$value" \
      --region "$REGION" \
      --output text --query 'Name' | xargs -I{} echo "  CREATED  {}"
  fi
}

echo "=== TolipAI Scraper — Secrets Manager setup (region: $REGION) ==="
echo ""

# ── CRITICAL: new Neon DB URL (quota-exhausted old URL replaced) ──────────────
put_secret "TolipAI/scraper/database-url"       "${DATABASE_URL:-}"

# ── Scraper API auth ──────────────────────────────────────────────────────────
put_secret "TolipAI/scraper/api-key"            "${SCRAPER_API_KEY:-}"

# ── AI / LLM keys ────────────────────────────────────────────────────────────
put_secret "TolipAI/scraper/openai-key"         "${OPENAI_API_KEY:-}"
put_secret "TolipAI/scraper/groq-key"           "${GROQ_API_KEY:-}"
put_secret "TolipAI/scraper/openrouter-key"     "${OPENROUTER_API_KEY:-}"

# ── Property data APIs ────────────────────────────────────────────────────────
put_secret "TolipAI/scraper/attom-key"          "${ATTOM_API_KEY:-}"
put_secret "TolipAI/scraper/attom-key-2"        "${ATTOM_API_KEY_2:-}"
put_secret "TolipAI/scraper/rentcast-key"       "${RENTCAST_API_KEY:-}"
put_secret "TolipAI/scraper/google-maps-key"    "${GOOGLE_MAPS_API_KEY:-}"
put_secret "TolipAI/scraper/skip-trace-key"     "${SKIP_TRACE_API_KEY:-}"

# ── Proxy credentials ─────────────────────────────────────────────────────────
put_secret "TolipAI/scraper/brightdata-username" "${BRIGHTDATA_USERNAME:-}"
put_secret "TolipAI/scraper/brightdata-password" "${BRIGHTDATA_PASSWORD:-}"
put_secret "TolipAI/scraper/oxylabs-username"   "${OXYLABS_USERNAME:-}"
put_secret "TolipAI/scraper/oxylabs-password"   "${OXYLABS_PASSWORD:-}"

# ── Scraper site credentials ──────────────────────────────────────────────────
put_secret "TolipAI/scraper/propelio-email"     "${PROPELIO_EMAIL:-}"
put_secret "TolipAI/scraper/propelio-password"  "${PROPELIO_PASSWORD:-}"
put_secret "TolipAI/scraper/propwire-email"     "${PROPWIRE_EMAIL:-}"
put_secret "TolipAI/scraper/propwire-password"  "${PROPWIRE_PASSWORD:-}"

# ── JWT / encryption ──────────────────────────────────────────────────────────
put_secret "TolipAI/scraper/jwt-secret"         "${JWT_SECRET:-}"
put_secret "TolipAI/scraper/encryption-key"     "${ENCRYPTION_KEY:-}"

# ── Redis (optional) ──────────────────────────────────────────────────────────
put_secret "TolipAI/scraper/redis-url"          "${REDIS_URL:-}"

# ── 2Captcha (optional) ───────────────────────────────────────────────────────
put_secret "TolipAI/scraper/twocaptcha-key"     "${TWOCAPTCHA_API_KEY:-}"

echo ""
echo "=== Done. Next step: trigger a new ECS deploy via GitHub Actions. ==="
echo "    (The task will automatically pull all secrets from Secrets Manager.)"
