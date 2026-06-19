#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# migrate-to-new-neon.sh
# Applies the full schema + data backup to a target Neon database.
#
# Run this ONCE from your local machine (needs psql installed):
#   brew install postgresql   # macOS
#   sudo apt install postgresql-client  # Ubuntu/Debian
#
# Usage:
#   DATABASE_URL="postgresql://..." bash scripts/migrate-to-new-neon.sh
#
# DATABASE_URL must be the full connection string for the target Neon DB,
# including sslmode=require. Copy it from Replit Secrets.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Usage: DATABASE_URL='postgresql://...' bash scripts/migrate-to-new-neon.sh"
  exit 1
fi

SQL_FILE="attached_assets/merged_1781888795799.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: SQL file not found: $SQL_FILE"
  echo "Run this script from the repo root."
  exit 1
fi

echo "=== Neon DB Migration ==="
echo "SQL: $SQL_FILE"
echo ""
echo "Testing connection..."
psql "$DATABASE_URL" -c "SELECT version();" | head -3

echo ""
echo "Applying schema + data (safe — uses IF NOT EXISTS / ON CONFLICT DO NOTHING)..."
psql "$DATABASE_URL" -f "$SQL_FILE" 2>&1

echo ""
echo "=== Verifying tables ==="
psql "$DATABASE_URL" -c "
SELECT table_name,
       (SELECT COUNT(*) FROM information_schema.columns c
        WHERE c.table_name = t.table_name) AS cols
FROM information_schema.tables t
WHERE table_schema = 'public'
ORDER BY table_name;
"

echo ""
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "1. Confirm DATABASE_URL is set in Replit Secrets."
echo "2. Update DATABASE_URL in AWS Secrets Manager:"
echo "   bash artifacts/TolipAI-scraper-engine/infrastructure/update-secrets.sh"
echo "3. Restart Railway deployment — it will pick up the new DATABASE_URL."
echo "4. Re-run the GitHub Actions deploy workflow for ECS Fargate."
