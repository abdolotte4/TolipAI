#!/bin/bash
# Run this in AWS CloudShell: https://console.aws.amazon.com/cloudshell/
# Fixes the JWT_SECRET and other known secrets in AWS Secrets Manager
# IMPORTANT: Replace ACCOUNT_ID with 583299526161 before running

set -e

REGION="us-east-1"
ACCOUNT_ID="583299526161"
SECRET_PREFIX="TolipAI/scraper"

echo "========================================"
echo "Fixing secrets in AWS Secrets Manager"
echo "========================================"
echo ""
echo "⚠️  IMPORTANT: Make sure ACCOUNT_ID is set to your actual AWS account ID"
echo "   Currently set to: $ACCOUNT_ID"
echo ""

# Function to create or update a secret
upsert_secret() {
    local name="$1"
    local value="$2"
    local description="$3"
    
    echo "Processing: $name"
    
    # Check if secret exists
    if aws secretsmanager describe-secret --region $REGION --secret-id "$name" > /dev/null 2>&1; then
        # Update existing secret
        aws secretsmanager put-secret-value \
            --region $REGION \
            --secret-id "$name" \
            --secret-string "$value"
        echo "  ✓ Updated existing secret"
    else
        # Create new secret
        aws secretsmanager create-secret \
            --region $REGION \
            --name "$name" \
            --secret-string "$value" \
            --description "$description"
        echo "  ✓ Created new secret"
    fi
}

# ========================================
# FIX 1: JWT_SECRET — replace the broken command string with a real 64-byte hex value
# ========================================
echo ""
echo "🚨 FIXING JWT_SECRET (was literally a command string, not a real secret!)"
echo ""
upsert_secret "$SECRET_PREFIX/JWT_SECRET" \
    "335d13d37694627082c6f9bfad69a638553392c374ea4b792a7dd15aa7d745a97bd77f5ee97331d0dd01b416c35d0e6359d6cb5a1bc9886e0e7e64eb8457bda6" \
    "JWT signing secret - 64-byte hex generated with Node.js crypto"

echo ""

# ========================================
# FIX 2: DATABASE_URL — Neon PostgreSQL
# ========================================
echo "🛠️  Setting DATABASE_URL (Neon PostgreSQL)"
upsert_secret "$SECRET_PREFIX/DATABASE_URL" \
    "postgresql://neondb_owner:npg_vGaWn3bp4COq@ep-restless-waterfall-adcwhmet.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require" \
    "Database connection URL (Neon PostgreSQL)"

echo ""

# ========================================
# FIX 3: REDIS_URL — ElastiCache Redis
# ========================================
echo "🛠️  Setting REDIS_URL (ElastiCache Redis)"
upsert_secret "$SECRET_PREFIX/REDIS_URL" \
    "rediss://tolipai-scraper-cache-juvjic.serverless.use1.cache.amazonaws.com:6379" \
    "Redis connection URL (ElastiCache)"

echo ""
echo "========================================"
echo "✅ Secrets fixed successfully!"
echo "========================================"
echo ""
echo "Fixed secrets:"
echo "  - JWT_SECRET: 64-byte hex value (was a command string!)"
echo "  - DATABASE_URL: Neon PostgreSQL connection"
echo "  - REDIS_URL: ElastiCache Redis connection"
echo ""
echo "⚠️  WARNING: These secrets still need actual values:"
echo "  - SCRAPER_API_KEY"
echo "  - OPENAI_API_KEY"
echo "  - ATTOM_API_KEY"
echo "  - ATTOM_API_KEY_2"
echo "  - GOOGLE_MAPS_API_KEY"
echo "  - BRIGHTDATA_USERNAME & BRIGHTDATA_PASSWORD"
echo "  - BRIGHTDATA_API"
echo "  - PROPELIO_EMAIL & PROPELIO_PASSWORD"
echo "  - PROPWIRE_EMAIL & PROPWIRE_PASSWORD"
echo "  - OXYLABS_USERNAME & OXYLABS_PASSWORD"
echo "  - S3_CACHE_BUCKET"
echo "  - WEBSCRAPER_KEY"
echo "  - OPENROUTER_KEY"
echo "  - GROQ_KEY"
echo "  - OPENAI_BASE_URL"
echo "  - AI_MODEL"
echo "  - MOONSHOT_KEY"
echo "  - NVIDIA_KEY"
echo "  - PROXY_HOST"
echo "  - CEREBRAS_KEY"
echo "  - GEMINI_KEY"
echo "  - PEOPLEDATALABS_KEY"
echo ""
echo "These are referenced in ecs-task-definition.json but not in create-all-secrets.sh."
echo "Run create-all-secrets.sh with the real values for those."
