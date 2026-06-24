#!/bin/bash
# Run this in AWS CloudShell: https://console.aws.amazon.com/cloudshell/
# Creates ALL missing secrets in AWS Secrets Manager for TolipAI scraper
# This fixes: "Secrets Manager can't find the specified secret"

set -e

REGION="us-east-1"
SECRET_PREFIX="TolipAI/scraper"

echo "========================================"
echo "Creating ALL secrets in AWS Secrets Manager"
echo "========================================"

upsert_secret() {
    local name="$1"
    local value="$2"
    local description="$3"
    
    echo "Processing: $name"
    
    if aws secretsmanager describe-secret --region $REGION --secret-id "$name" > /dev/null 2>&1; then
        aws secretsmanager put-secret-value \
            --region $REGION \
            --secret-id "$name" \
            --secret-string "$value"
        echo "  ✓ Updated"
    else
        aws secretsmanager create-secret \
            --region $REGION \
            --name "$name" \
            --secret-string "$value" \
            --description "$description"
        echo "  ✓ Created"
    fi
}

# ── CRITICAL: These MUST exist for the scraper to start ──
echo ""
echo "=== CRITICAL SECRETS (scraper will fail without these) ==="
echo ""

upsert_secret "$SECRET_PREFIX/DATABASE_URL" \
    "postgresql://neondb_owner:npg_vGaWn3bp4COq@ep-restless-waterfall-adcwhmet.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require" \
    "Database connection URL (Neon PostgreSQL)"

upsert_secret "$SECRET_PREFIX/REDIS_URL" \
    "rediss://tolipai-scraper-cache-juvjic.serverless.use1.cache.amazonaws.com:6379" \
    "Redis connection URL (ElastiCache)"

upsert_secret "$SECRET_PREFIX/JWT_SECRET" \
    "335d13d37694627082c6f9bfad69a638553392c374ea4b792a7dd15aa7d745a97bd77f5ee97331d0dd01b416c35d0e6359d6cb5a1bc9886e0e7e64eb8457bda6" \
    "JWT signing secret (64-byte hex)"

upsert_secret "$SECRET_PREFIX/SCRAPER_API_KEY" \
    "tolipai-scraper-api-key-change-me" \
    "API key for scraper authentication"

# ── AI/LLM API Keys (replace with your real keys) ──
echo ""
echo "=== AI/LLM API Keys (update with your real values) ==="
echo ""

upsert_secret "$SECRET_PREFIX/OPENAI_API_KEY" \
    "sk-change-me-to-your-real-openai-key" \
    "OpenAI API key"

upsert_secret "$SECRET_PREFIX/OPENAI_BASE_URL" \
    "https://api.openai.com/v1" \
    "OpenAI base URL"

upsert_secret "$SECRET_PREFIX/AI_MODEL" \
    "gpt-4o-mini" \
    "AI model identifier"

upsert_secret "$SECRET_PREFIX/GROQ_KEY" \
    "gsk-change-me-to-your-real-groq-key" \
    "Groq API key"

upsert_secret "$SECRET_PREFIX/OPENROUTER_KEY" \
    "sk-or-change-me-to-your-real-openrouter-key" \
    "OpenRouter API key"

upsert_secret "$SECRET_PREFIX/MOONSHOT_KEY" \
    "change-me-to-your-real-moonshot-key" \
    "Moonshot API key"

upsert_secret "$SECRET_PREFIX/NVIDIA_KEY" \
    "nvapi-change-me-to-your-real-nvidia-key" \
    "NVIDIA API key"

upsert_secret "$SECRET_PREFIX/CEREBRAS_KEY" \
    "change-me-to-your-real-cerebras-key" \
    "Cerebras API key"

upsert_secret "$SECRET_PREFIX/GEMINI_KEY" \
    "change-me-to-your-real-gemini-key" \
    "Google Gemini API key"

# ── Data/Scraper API Keys ──
echo ""
echo "=== Data/Scraper API Keys (update with your real values) ==="
echo ""

upsert_secret "$SECRET_PREFIX/ATTOM_API_KEY" \
    "change-me-to-your-real-attom-key" \
    "ATTOM API key"

upsert_secret "$SECRET_PREFIX/ATTOM_API_KEY_2" \
    "change-me-to-your-real-attom-key-2" \
    "ATTOM API key (backup)"

upsert_secret "$SECRET_PREFIX/GOOGLE_MAPS_API_KEY" \
    "AIzaSyDAJahdCGatUxZxXoBS47VCFOFWvd5YBes" \
    "Google Maps API key"

upsert_secret "$SECRET_PREFIX/PEOPLEDATALABS_KEY" \
    "change-me-to-your-real-pdl-key" \
    "People Data Labs API key"

upsert_secret "$SECRET_PREFIX/WEBSCRAPER_KEY" \
    "change-me-to-your-real-webscraper-key" \
    "WebScraper API key"

upsert_secret "$SECRET_PREFIX/BRIGHTDATA_API" \
    "change-me-to-your-real-brightdata-api-key" \
    "BrightData API key"

upsert_secret "$SECRET_PREFIX/BRIGHTDATA_USERNAME" \
    "brd-customer-hl_fbaba1cb-zone-digor_scraper" \
    "BrightData proxy username"

upsert_secret "$SECRET_PREFIX/BRIGHTDATA_PASSWORD" \
    "6dnvnr208ey4" \
    "BrightData proxy password"

upsert_secret "$SECRET_PREFIX/PROXY_HOST" \
    "change-me-to-your-real-proxy-host" \
    "Proxy host"

# ── Login Credentials ──
echo ""
echo "=== Login Credentials (update with your real values) ==="
echo ""

upsert_secret "$SECRET_PREFIX/PROPELIO_EMAIL" \
    "martin.direct2sellers@gmail.com" \
    "Propelio login email"

upsert_secret "$SECRET_PREFIX/PROPELIO_PASSWORD" \
    "Password123!" \
    "Propelio login password"

upsert_secret "$SECRET_PREFIX/PROPWIRE_EMAIL" \
    "martin.direct2sellers@gmail.com" \
    "Propwire login email"

upsert_secret "$SECRET_PREFIX/PROPWIRE_PASSWORD" \
    "Abdosan2#" \
    "Propwire login password"

upsert_secret "$SECRET_PREFIX/OXYLABS_USERNAME" \
    "abdolotte_j2hjU" \
    "Oxylabs proxy username"

upsert_secret "$SECRET_PREFIX/OXYLABS_PASSWORD" \
    "Abdo2006611~" \
    "Oxylabs proxy password"

# ── Infrastructure ──
echo ""
echo "=== Infrastructure Secrets ==="
echo ""

upsert_secret "$SECRET_PREFIX/S3_CACHE_BUCKET" \
    "tolipai-scraper-cache" \
    "S3 cache bucket name"

upsert_secret "$SECRET_PREFIX/ADMIN_API_KEY" \
    "change-me-to-your-real-admin-key" \
    "Admin API key for /admin/* endpoints (separate from SCRAPER_API_KEY)"

echo ""
echo "========================================"
echo "✅ ALL Secrets Created/Updated!"
echo "========================================"
echo ""
echo "IMPORTANT: The following secrets have PLACEHOLDER values."
echo "Update them with your REAL API keys in AWS Secrets Manager:"
echo "  - OPENAI_API_KEY"
echo "  - ATTOM_API_KEY"
echo "  - WEBSCRAPER_KEY"
echo "  - BRIGHTDATA_USERNAME"
echo "  - BRIGHTDATA_PASSWORD"
echo "  - BRIGHTDATA_API"
echo "  - OXYLABS_USERNAME"
echo "  - OXYLABS_PASSWORD"
echo "  - PROPELIO_EMAIL"
echo "  - PROPELIO_PASSWORD"
echo "  - PROPWIRE_EMAIL"
echo "  - PROPWIRE_PASSWORD"
echo "  - GOOGLE_MAPS_API_KEY"
echo "  - ADMIN_API_KEY"
echo ""
echo "NOTE: RealForeclose.com (REALFORECLOSE_USERNAME/PASSWORD) has been removed."
echo "      FL county scrapers now use direct official county clerk websites."
echo ""
echo "Next: Run fix-aws-roles.sh to create the IAM roles, then trigger the deploy."
