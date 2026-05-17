#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# generate-backup.sh
# Dumps the live NeonDB to merged.sql and optionally zips it as merged_neondb.zip
#
# Usage:
#   ./scripts/generate-backup.sh           # dump + zip
#   ./scripts/generate-backup.sh --no-zip  # dump only
#   DRY_RUN=1 ./scripts/generate-backup.sh # show what would run
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DB_URL="${NEONDB_URL:-postgresql://neondb_owner:npg_fsD0mvh9zypn@ep-hidden-sound-apu9c516.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require}"
OUTPUT_SQL="merged.sql"
OUTPUT_ZIP="merged_neondb.zip"
NO_ZIP=0
DRY_RUN="${DRY_RUN:-0}"

for arg in "$@"; do
  case "$arg" in
    --no-zip) NO_ZIP=1 ;;
  esac
done

echo "=== TolipAI NeonDB Backup ==="
echo "Timestamp : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Output    : $OUTPUT_SQL"
[ "$NO_ZIP" -eq 0 ] && echo "Zip       : $OUTPUT_ZIP"
echo ""

# ── Dump ─────────────────────────────────────────────────────────────────────
# pg_dump flags:
#   --schema-only         schema DDL only (no COPY/data) — keeps file small
#   --no-owner            skip ownership clauses (AWS/RDS compatibility)
#   --no-privileges       skip GRANT/REVOKE (AWS/RDS compatibility)
#   --if-exists           use IF EXISTS on DROP statements
#   --clean               prepend DROP TABLE IF EXISTS (for clean re-runs)
#   --no-comments         cleaner output
#   --section=pre-data    structure first, then post-data (indexes/constraints)
#
# For a DATA + SCHEMA dump (full restore), remove --schema-only.
# For AWS RDS target, this file is directly usable:  psql $RDS_URL -f merged.sql

if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY RUN] Would run: pg_dump --schema-only ... -f $OUTPUT_SQL"
  echo "[DRY RUN] Would run: zip $OUTPUT_ZIP $OUTPUT_SQL"
  exit 0
fi

echo "Dumping schema from NeonDB..."

# Try pg_dump first (standard PostgreSQL tooling)
if command -v pg_dump &>/dev/null; then
  pg_dump \
    --schema-only \
    --no-owner \
    --no-privileges \
    --if-exists \
    --clean \
    --section=pre-data \
    --section=post-data \
    "$DB_URL" \
    -f "$OUTPUT_SQL"
  echo "✓ pg_dump completed → $OUTPUT_SQL ($(wc -l < "$OUTPUT_SQL") lines)"
else
  # Fallback: use psql to dump via \d+ (schema-level, less complete)
  echo "⚠ pg_dump not found — falling back to psql information_schema export"
  psql "$DB_URL" -c "\i merged.sql" 2>/dev/null || true
  echo "⚠ pg_dump is required for a full backup. Install postgresql-client."
  exit 1
fi

# ── Add header comment ────────────────────────────────────────────────────────
HEADER="-- TolipAI / DigorCRM — PostgreSQL Schema Backup
-- Generated : $(date -u '+%Y-%m-%d %H:%M:%S UTC')
-- Source    : NeonDB (ep-hidden-sound-apu9c516 / us-east-1)
-- Target    : AWS RDS / Aurora PostgreSQL 14+ (no NeonDB-specific features)
-- Usage     : psql \$DATABASE_URL -f merged.sql
-- Notes     : schema-only dump; run AFTER extensions (uuid-ossp, pg_trgm)
"

# Prepend header to the file
TMPFILE=$(mktemp)
echo "$HEADER" > "$TMPFILE"
cat "$OUTPUT_SQL" >> "$TMPFILE"
mv "$TMPFILE" "$OUTPUT_SQL"

echo "✓ Header added"

# ── Zip ───────────────────────────────────────────────────────────────────────
if [ "$NO_ZIP" -eq 0 ]; then
  zip -q "$OUTPUT_ZIP" "$OUTPUT_SQL"
  ZIP_SIZE=$(du -sh "$OUTPUT_ZIP" | cut -f1)
  echo "✓ Zipped → $OUTPUT_ZIP ($ZIP_SIZE)"
fi

echo ""
echo "=== Backup complete ==="
