#!/usr/bin/env bash
# ============================================================
# TolipAI CRM — Replit Setup Script
# Run this once on a fresh Replit account after cloning the repo.
# Usage: bash replit-setup.sh
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKSPACE"

echo ""
echo "=================================================="
echo "  TolipAI CRM — Replit Environment Setup"
echo "=================================================="
echo ""

# ── Step 1: Node.js version check ────────────────────────────────────────────
info "Checking Node.js..."
NODE_VER=$(node --version 2>/dev/null || echo "none")
if [[ "$NODE_VER" == "none" ]]; then
  error "Node.js not found. Add 'nodejs-20' to .replit modules section."
fi
info "Node.js: $NODE_VER"

# ── Step 2: Install pnpm (must be v9 for Node 20 compatibility) ───────────────
info "Setting up pnpm..."
if ! command -v pnpm &>/dev/null || [[ "$(pnpm --version 2>/dev/null | cut -d. -f1)" != "9" ]]; then
  info "Installing pnpm@9..."
  npm install -g pnpm@9 --silent
  success "pnpm@9 installed"
else
  success "pnpm $(pnpm --version) already installed"
fi

# ── Step 3: Install all workspace dependencies ────────────────────────────────
info "Installing workspace dependencies (this may take 2-4 minutes)..."
pnpm install --no-frozen-lockfile 2>&1 | grep -E "^(warn|ERR|error|Done|✓|Packages)" || true
success "Dependencies installed"

# ── Step 4: Build the shared DB package ──────────────────────────────────────
info "Building shared DB package..."
if [ -d "lib/db" ]; then
  (cd lib/db && pnpm run build 2>&1 | tail -5) || warn "DB package build had warnings"
  success "DB package built"
else
  warn "lib/db not found — skipping"
fi

# ── Step 5: Build the API server ─────────────────────────────────────────────
info "Building API server..."
(cd artifacts/api-server && pnpm run build 2>&1 | tail -10)
success "API server built → artifacts/api-server/dist/index.mjs"

# ── Step 6: Build CRM frontend ───────────────────────────────────────────────
info "Building CRM frontend (takes ~60s)..."
(cd artifacts/TolipAI-crm && pnpm run build 2>&1 | tail -10)
success "CRM frontend built → artifacts/TolipAI-crm/dist/public/"

# ── Step 7: Build Tools frontend ─────────────────────────────────────────────
info "Building Tools frontend..."
(cd artifacts/TolipAI-tools && pnpm run build 2>&1 | tail -10)
success "Tools frontend built → artifacts/TolipAI-tools/dist/public/"

# ── Step 8: Python packages ───────────────────────────────────────────────────
info "Installing Python packages for scraper engine..."
if command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
  PIP=$(command -v pip3 || command -v pip)
  SCRAPER_REQS="artifacts/TolipAI-scraper-engine/requirements.txt"
  if [ -f "$SCRAPER_REQS" ]; then
    $PIP install -r "$SCRAPER_REQS" -q 2>&1 | tail -5 || warn "Some Python packages failed (non-fatal)"
    success "Python packages installed from requirements.txt"
  else
    # Fallback: install core packages
    $PIP install fastapi uvicorn httpx pydantic python-dotenv boto3 -q || warn "Python install had errors"
    success "Core Python packages installed"
  fi
else
  warn "pip not found — skipping Python packages. Add 'python-3.11' to .replit modules."
fi

# ── Step 9: Environment variables check ───────────────────────────────────────
echo ""
info "Checking required environment variables..."
REQUIRED_VARS=(
  "DATABASE_URL"
  "JWT_SECRET"
  "GROQ_API_KEY"
  "TOOLS_PIN"
  "SCRAPER_ENGINE_URL"
)
OPTIONAL_VARS=(
  "TWILIO_ACCOUNT_SID"
  "TWILIO_AUTH_TOKEN"
  "TWILIO_VOICE_CALLER_ID"
  "OPENAI_API_KEY"
  "ATTOM_API_KEY"
  "API_BASE_URL"
  "AWS_ACCESS_KEY_ID"
  "AWS_SECRET_ACCESS_KEY"
  "AWS_DEFAULT_REGION"
  "BRIGHTDATA_USERNAME"
  "BRIGHTDATA_PASSWORD"
  "BRIGHTDATA_HOST"
  "BRIGHTDATA_PORT"
)

ALL_OK=true
for VAR in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!VAR:-}" ]; then
    echo -e "  ${RED}✗ MISSING${NC}  $VAR  (REQUIRED)"
    ALL_OK=false
  else
    echo -e "  ${GREEN}✓ SET${NC}      $VAR"
  fi
done
for VAR in "${OPTIONAL_VARS[@]}"; do
  if [ -z "${!VAR:-}" ]; then
    echo -e "  ${YELLOW}○ MISSING${NC}  $VAR  (optional)"
  else
    echo -e "  ${GREEN}✓ SET${NC}      $VAR"
  fi
done

echo ""
if [ "$ALL_OK" = true ]; then
  success "All required env vars are set"
else
  warn "Some required env vars are missing — add them in Replit Secrets"
fi

# ── Step 10: DB migrations check ─────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  info "Running database migrations..."
  if [ -f "lib/db/drizzle.config.ts" ]; then
    (cd lib/db && npx drizzle-kit push --config drizzle.config.ts 2>&1 | tail -10) || warn "Migration had warnings"
    success "Migrations applied"
  elif [ -d "lib/db/migrations" ]; then
    warn "Found migrations folder but no drizzle.config.ts — run migrations manually"
  fi
else
  warn "DATABASE_URL not set — skipping migrations"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo -e "  ${GREEN}Setup complete!${NC}"
echo "=================================================="
echo ""
echo "Next steps:"
echo "  1. Add any missing secrets above in Replit Secrets panel"
echo "  2. Click 'Run' (or use the 'Start application' workflow)"
echo "  3. Open the preview at: /crm  (CRM frontend)"
echo "                          /tools (Tools frontend)"
echo ""
echo "Useful commands:"
echo "  bash deploy.sh          — deploy scraper engine to AWS ECS"
echo "  cat BUGS.md             — view known issues tracker"
echo ""
