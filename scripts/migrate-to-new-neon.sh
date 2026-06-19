#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# migrate-to-new-neon.sh
# Applies the full schema + data backup to the new Neon database.
#
# Run this ONCE from your local machine (needs psql installed):
#   brew install postgresql   # macOS
#   sudo apt install postgresql-client  # Ubuntu/Debian
#
# Usage:
#   bash scripts/migrate-to-new-neon.sh
#
# The script applies attached_assets/merged_1781888795799.sql to:
#   NEW_DB = postgresql://neondb_owner:...@ep-restless-waterfall-adcwhmet...
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NEW_DB="postgresql://neondb_owner:npg_vGaWn3bp4COq@ep-restless-waterfall-adcwhmet.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"
SQL_FILE="attached_assets/merged_1781888795799.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: SQL file not found: $SQL_FILE"
  echo "Run this script from the repo root."
  exit 1
fi

echo "=== Neon DB Migration ==="
echo "Target: ep-restless-waterfall-adcwhmet (new DB)"
echo "SQL:    $SQL_FILE"
echo ""
echo "Testing connection..."
PGPASSWORD=npg_vGaWn3bp4COq psql "$NEW_DB" -c "SELECT version();" | head -3

echo ""
echo "Applying schema + data (safe — uses IF NOT EXISTS / ON CONFLICT DO NOTHING)..."
PGPASSWORD=npg_vGaWn3bp4COq psql "$NEW_DB" -f "$SQL_FILE" 2>&1

echo ""
echo "=== Verifying tables ==="
PGPASSWORD=npg_vGaWn3bp4COq psql "$NEW_DB" -c "
SELECT table_name, (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) AS cols
FROM information_schema.tables t
WHERE table_schema = 'public'
ORDER BY table_name;
"

echo ""
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "1. Update DATABASE_URL in Replit Secrets to the new URL:"
echo "   postgresql://neondb_owner:npg_vGaWn3bp4COq@ep-restless-waterfall-adcwhmet.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"
echo ""
echo "2. Update DATABASE_URL in AWS Secrets Manager:"
echo "   bash artifacts/TolipAI-scraper-engine/infrastructure/update-secrets.sh"
echo "   (set DATABASE_URL env var first, then run the script)"
echo ""
echo "3. Restart Railway deployment — it will pick up the new DATABASE_URL."
echo "4. Re-run the GitHub Actions deploy workflow for ECS Fargate."
