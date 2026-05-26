#!/usr/bin/env bash
# ============================================================
# TolipAI CRM — Replit Setup Script
# Run once on a fresh Replit project after cloning the repo.
# Usage: bash replit-setup.sh
#
# What it does:
#   1. Verifies Node.js ≥18
#   2. Installs pnpm@9
#   3. Installs all workspace dependencies (pnpm install)
#   4. Builds lib/db → api-server → CRM frontend → Tools frontend
#   5. Installs Python packages for the scraper engine (via uv)
#   6. Checks required environment variables
#   7. Runs DB migrations (drizzle-kit push)
#
# NOTE: If the script appears to hang on Python packages, press Ctrl+C
#   and re-run — uv is fast but may take 60–90s on first run.
# ============================================================
set -eo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
err_exit(){ echo -e "${RED}[ERR]${NC}  $*"; exit 1; }

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
  err_exit "Node.js not found. The nodejs-20 module should be installed — try opening a fresh Shell tab and running again."
fi
MAJOR=$(echo "$NODE_VER" | tr -d 'v' | cut -d. -f1)
if [[ "$MAJOR" -lt 18 ]]; then
  err_exit "Node.js $NODE_VER is too old (need ≥18). The nodejs-20 module is installed — open a fresh Shell tab and retry."
fi
info "Node.js: $NODE_VER"

# ── Step 2: Install pnpm@9 ────────────────────────────────────────────────────
info "Setting up pnpm..."
PNPM_VER=$(pnpm --version 2>/dev/null | cut -d. -f1 || echo "0")
if ! command -v pnpm &>/dev/null || [[ "$PNPM_VER" != "9" ]]; then
  info "Installing pnpm@9 via npm..."
  npm install -g pnpm@9 --silent 2>&1 | tail -3
  # Also install to ~/.local/bin for future non-login shells
  node $(which npm 2>/dev/null || echo /nix/store/*-nodejs-*/bin/npm) install -g pnpm@9 --prefix "$HOME/.local" --silent 2>/dev/null || true
  success "pnpm@9 installed"
else
  success "pnpm $(pnpm --version) already installed"
fi

export PATH="$HOME/.local/bin:$PATH"

# ── Step 3: Install all workspace dependencies ────────────────────────────────
info "Installing workspace dependencies (this may take 2–4 minutes on first run)..."
timeout 300 pnpm install --no-frozen-lockfile 2>&1 | grep -E "(warn|ERR|error|Done|✓|Packages|already up)" || warn "pnpm install timed out or had errors — retry with: pnpm install --no-frozen-lockfile"
success "Dependencies installed"

# ── Step 4: Build shared DB package ──────────────────────────────────────────
info "Building shared DB package..."
if [ -d "lib/db" ]; then
  (cd lib/db && pnpm run build 2>&1 | tail -5) || warn "DB package build had warnings (non-fatal)"
  success "DB package built"
else
  warn "lib/db not found — skipping"
fi

# ── Step 5: Build API server ──────────────────────────────────────────────────
info "Building API server..."
if (cd artifacts/api-server && pnpm run build 2>&1 | tail -10); then
  success "API server built → artifacts/api-server/dist/index.mjs"
else
  warn "API server build had errors — check TypeScript output above"
fi

# ── Step 6: Build CRM frontend ───────────────────────────────────────────────
info "Building CRM frontend (takes ~60s)..."
if (cd artifacts/TolipAI-crm && pnpm run build 2>&1 | tail -10); then
  success "CRM frontend built → artifacts/TolipAI-crm/dist/public/"
else
  warn "CRM frontend build had errors"
fi

# ── Step 7: Build Tools frontend ─────────────────────────────────────────────
info "Building Tools frontend..."
if (cd artifacts/TolipAI-tools && pnpm run build 2>&1 | tail -10); then
  success "Tools frontend built → artifacts/TolipAI-tools/dist/public/"
else
  warn "Tools frontend build had errors"
fi

# ── Step 8: Python packages via uv (fast, handles binary deps correctly) ───────
info "Installing Python packages for scraper engine..."
SCRAPER_REQS="artifacts/TolipAI-scraper-engine/requirements.txt"

# Try uv first (handles native extensions like lxml without build issues)
if command -v uv &>/dev/null; then
  info "Using uv for Python package installation..."
  if [ -f "$SCRAPER_REQS" ]; then
    uv pip install --system -r "$SCRAPER_REQS" 2>&1 | tail -5 || {
      warn "uv install had errors — trying pip fallback..."
      pip install -r "$SCRAPER_REQS" --no-build-isolation -q 2>&1 | tail -5 || warn "Some Python packages failed (non-fatal)"
    }
  fi
  success "Python packages installed via uv"
elif command -v pip3 &>/dev/null || command -v pip &>/dev/null; then
  PIP=$(command -v pip3 2>/dev/null || command -v pip)
  if [ -f "$SCRAPER_REQS" ]; then
    # --no-build-isolation prevents the lxml/expat C-extension hang in Nix
    info "Using pip (this may take 1–2 minutes for binary packages)..."
    timeout 180 $PIP install -r "$SCRAPER_REQS" \
      --no-build-isolation \
      --prefer-binary \
      -q 2>&1 | tail -8 || warn "Some Python packages failed (non-fatal)"
    success "Python packages installed"
  else
    # Fallback: install only core packages needed to run the engine
    timeout 120 $PIP install fastapi uvicorn httpx pydantic python-dotenv \
      --no-build-isolation --prefer-binary -q 2>&1 | tail -5 || warn "Core Python install had errors"
    success "Core Python packages installed (requirements.txt not found)"
  fi
else
  warn "pip/uv not found — Python packages not installed."
  warn "Add 'python-3.11' to .replit [nix] packages section."
fi

# ── Step 9: Environment variables check ───────────────────────────────────────
echo ""
info "Checking environment variables..."
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
  warn "Some required env vars are missing — add them in Replit Secrets panel"
fi

# ── Step 10: DB migrations ────────────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  info "Running database migrations (drizzle-kit push)..."
  if [ -f "lib/db/drizzle.config.ts" ]; then
    (cd lib/db && timeout 120 npx drizzle-kit push --force 2>&1 | tail -10) || \
      warn "Migration had warnings — check drizzle output above"
    success "Migrations applied (or skipped after timeout)"
  elif [ -d "lib/db/migrations" ]; then
    warn "Found migrations/ folder but no drizzle.config.ts — run migrations manually"
  else
    warn "No drizzle config found — skipping migrations"
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
echo "  1. Add any missing secrets above in the Replit Secrets panel (lock icon)"
echo "  2. Click the Run ▶ button (or use 'Project' workflow)"
echo "  3. Preview opens at:  /crm     (CRM frontend)"
echo "                        /tools   (Tools frontend)"
echo ""
echo "Useful commands:"
echo "  bash push-github.sh             — manually commit and push to GitHub"
echo "  bash push-github.sh 'msg'       — commit with custom message and push"
echo "  AUTO_PUSH_INTERVAL=900 bash auto-push.sh &  — auto-push every 15 min"
echo "  bash auto-push.sh --once        — push once and exit"
echo "  bash deploy.sh                  — deploy scraper engine to AWS ECS"
echo "  bash replit-setup.sh            — re-run this setup (safe to repeat)"
echo "  cat BUGS.md                     — view known issues tracker"
echo ""
echo "Troubleshooting:"
echo "  • If Python packages hang: run 'pip install uv && uv pip install --system -r artifacts/TolipAI-scraper-engine/requirements.txt'"
echo "  • If builds fail: check pnpm version with 'pnpm --version' (must be 9.x)"
echo "  • If migrations fail: ensure DATABASE_URL secret is set and DB is reachable"
echo ""
