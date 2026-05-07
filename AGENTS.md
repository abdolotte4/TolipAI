cat <<EOF > AGENTS.md
# Digor Project Architecture
- **Monorepo Structure**: artifacts/ (apps), lib/ (shared logic), scripts/ (utility).
- **Database**: PostgreSQL (NeonDB) managed via Drizzle in lib/db.
- **Goal**: Build 'artifacts/digor-scraper-engine' using Crawl4AI and pdfplumber.
- **Rule**: Prioritize 'lib/db/schema.ts' for all data models.
EOF
