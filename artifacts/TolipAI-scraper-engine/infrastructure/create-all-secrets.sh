#!/bin/bash
# Run this in AWS CloudShell: https://console.aws.amazon.com/cloudshell/
# Creates all required secrets in AWS Secrets Manager
# You need to fill in the actual values for each secret

set -e

REGION="us-east-1"
SECRET_PREFIX="TolipAI/scraper"

echo "========================================"
echo "Creating/updating secrets in AWS Secrets Manager"
echo "========================================"

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

# IMPORTANT: Replace the placeholder values below with your actual secrets!
# You can get these from your Railway dashboard or wherever you store them

echo ""
echo "Creating secrets..."
echo "NOTE: Please edit this script with your actual secret values before running!"
echo ""

# Replace these placeholder values with your actual secrets:
upsert_secret "$SECRET_PREFIX/DATABASE_URL" \
    "postgresql://neondb_owner:npg_vGaWn3bp4COq@ep-restless-waterfall-adcwhmet.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require" \
    "Database connection URL"

upsert_secret "$SECRET_PREFIX/SCRAPER_API_KEY" \
    "YOUR_SCRAPER_API_KEY_HERE" \
    "API key for scraper authentication"

upsert_secret "$SECRET_PREFIX/JWT_SECRET" \
    "YOUR_JWT_SECRET_HERE" \
    "JWT signing secret"

upsert_secret "$SECRET_PREFIX/OPENAI_API_KEY" \
    "YOUR_OPENAI_API_KEY_HERE" \
    "OpenAI API key"

upsert_secret "$SECRET_PREFIX/REDIS_URL" \
    "YOUR_REDIS_URL_HERE" \
    "Redis connection URL"

upsert_secret "$SECRET_PREFIX/ATTOM_API_KEY" \
    "YOUR_ATTOM_API_KEY_HERE" \
    "ATTOM API key"

upsert_secret "$SECRET_PREFIX/GOOGLE_MAPS_API_KEY" \
    "YOUR_GOOGLE_MAPS_KEY_HERE" \
    "Google Maps API key"

upsert_secret "$SECRET_PREFIX/BRIGHTDATA_USERNAME" \
    "YOUR_BRIGHTDATA_USERNAME_HERE" \
    "BrightData proxy username"

upsert_secret "$SECRET_PREFIX/BRIGHTDATA_PASSWORD" \
    "YOUR_BRIGHTDATA_PASSWORD_HERE" \
    "BrightData proxy password"

upsert_secret "$SECRET_PREFIX/PROPELIO_EMAIL" \
    "YOUR_PROPELIO_EMAIL_HERE" \
    "Propelio login email"

upsert_secret "$SECRET_PREFIX/PROPELIO_PASSWORD" \
    "YOUR_PROPELIO_PASSWORD_HERE" \
    "Propelio login password"

upsert_secret "$SECRET_PREFIX/PROPWIRE_EMAIL" \
    "YOUR_PROPWIRE_EMAIL_HERE" \
    "Propwire login email"

upsert_secret "$SECRET_PREFIX/PROPWIRE_PASSWORD" \
    "YOUR_PROPWIRE_PASSWORD_HERE" \
    "Propwire login password"

echo ""
echo "========================================"
echo "Listing all created secrets"
echo "========================================"
aws secretsmanager list-secrets \
    --region $REGION \
    --query "SecretList[?starts_with(Name, \`$SECRET_PREFIX\`)].Name" \
    --output table

echo ""
echo "========================================"
echo "✅ Secrets created/updated successfully!"
echo "========================================"
echo ""
echo "IMPORTANT: If you used placeholder values (YOUR_*_HERE),"
echo "edit this script with your actual values and run it again."
echo ""
echo "Next steps:"
echo "1. Run fix-aws-iam.sh to add IAM permissions"
echo "2. Update the task definition to use the correct secret names"
echo "3. Deploy via GitHub Actions"
