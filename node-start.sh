#!/usr/bin/env bash
# node-start.sh — Install deps (if needed), build (if needed), and start the Node API server on port 5000
set -e

export PORT=5000
unset NODE_ENV

_add_node_to_path() {
  local REPLIT_NODE
  REPLIT_NODE="$(available-pid2-node-paths 2>/dev/null | head -1 | xargs dirname 2>/dev/null)"
  if [ -n "$REPLIT_NODE" ] && [ -x "$REPLIT_NODE/node" ]; then
    export PATH="$REPLIT_NODE:$PATH"
    return 0
  fi
  local NS
  for NS in /nix/store/*-nodejs-*/bin; do
    if [ -x "$NS/node" ]; then
      export PATH="$NS:$PATH"
      return 0
    fi
  done
}
_add_node_to_path

echo "[node-start] node $(node --version 2>/dev/null || echo 'not found')"

NPM_LOCAL_BIN="$HOME/.local/bin"
PNPM_BIN=""

# Check common locations including nix store (newest version wins)
_find_pnpm() {
  for candidate in \
    "$NPM_LOCAL_BIN/pnpm" \
    "$(which pnpm 2>/dev/null)" \
    "$HOME/.local/share/pnpm/pnpm"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"; return 0
    fi
  done
  # Scan nix store for pnpm — pick highest semver by sorting descending
  local NIX_PNPM
  NIX_PNPM="$(ls /nix/store/*pnpm*/bin/pnpm 2>/dev/null | sort -rV | head -1)"
  if [ -x "$NIX_PNPM" ]; then echo "$NIX_PNPM"; return 0; fi
  return 1
}

PNPM_BIN="$(_find_pnpm 2>/dev/null || true)"

if [ -z "$PNPM_BIN" ]; then
  echo "[node-start] pnpm not found — installing pnpm@9 via npm to ~/.local..."
  node /nix/store/*/lib/node_modules/npm/bin/npm-cli.js install -g pnpm@9 --prefix "$HOME/.local" 2>&1 | tail -3
  PNPM_BIN="$NPM_LOCAL_BIN/pnpm"
fi

echo "[node-start] Using pnpm: $PNPM_BIN ($("$PNPM_BIN" --version))"

# ── Skip install if node_modules exists and lock file hasn't changed ──────────
if [ ! -d "node_modules" ]; then
  echo "[node-start] Installing workspace dependencies..."
  "$PNPM_BIN" install --frozen-lockfile=false
else
  echo "[node-start] node_modules present — skipping install."
fi

# ── Skip build if dist/index.mjs is newer than all source files ──────────────
DIST="artifacts/api-server/dist/index.mjs"
NEEDS_BUILD=0

if [ ! -f "$DIST" ]; then
  echo "[node-start] No dist found — building..."
  NEEDS_BUILD=1
else
  # Check if any source file in artifacts/ or lib/ is newer than the dist
  SRC_DIRS="artifacts/api-server/src artifacts/TolipAI-crm/src artifacts/TolipAI-website/src artifacts/TolipAI-tools/src lib/db/src"
  for d in $SRC_DIRS; do
    if [ -d "$d" ]; then
      NEWER=$(find "$d" \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" \) -newer "$DIST" 2>/dev/null | head -1)
      if [ -n "$NEWER" ]; then
        echo "[node-start] Source change detected ($NEWER) — rebuilding..."
        NEEDS_BUILD=1
        break
      fi
    fi
  done
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
  # Ensure pnpm is on PATH so recursive `pnpm run ...` calls inside build scripts work
  export PATH="$(dirname "$PNPM_BIN"):$PATH"
  "$PNPM_BIN" --filter @workspace/api-server run build:prod
else
  echo "[node-start] Dist is up to date — skipping build."
fi

# ── Ensure port is free before starting (prevents EADDRINUSE on restart) ──────
echo "[node-start] Freeing port ${PORT}..."
# Primary: fuser -k is the most reliable method in Replit/NixOS
fuser -k "${PORT}/tcp" 2>/dev/null || true
# Secondary: kill by process name in case fuser missed it
pkill -f "artifacts/api-server/dist/index.mjs" 2>/dev/null || true
sleep 1
# Tertiary: ss-based fallback (POSIX-safe, no PCRE grep)
if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
  echo "[node-start] Port ${PORT} still occupied — extracting PID from ss..."
  SS_LINE=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | head -1 || true)
  # ss output: "pid=1234," — strip prefix and trailing comma without PCRE
  STUCK_PID=$(echo "$SS_LINE" | sed 's/.*pid=\([0-9]*\).*/\1/' | grep -E '^[0-9]+$' | head -1 || true)
  if [ -n "$STUCK_PID" ]; then
    echo "[node-start] Killing stuck PID ${STUCK_PID}..."
    kill -9 "$STUCK_PID" 2>/dev/null || true
  fi
  sleep 2
fi
echo "[node-start] Port ${PORT} is free."

echo "[node-start] Starting API server on port $PORT..."
export NODE_ENV=production

# ── Launch Python scraper engine on port 8000 (background) ───────────────────
_SCRAPER_DIR="$(pwd)/artifacts/TolipAI-scraper-engine"
_PYTHON=""
for _p in \
  "$_SCRAPER_DIR/.venv/bin/python" \
  "$_SCRAPER_DIR/.venv/bin/python3"; do
  if [ -x "$_p" ]; then _PYTHON="$_p"; break; fi
done

if [ -n "$_PYTHON" ]; then
  # Kill any stale instance on port 8000
  fuser -k "8000/tcp" 2>/dev/null || true
  pkill -f "uvicorn workers.main" 2>/dev/null || true
  sleep 1

  # Set shared key so API server can authenticate against engine
  export SCRAPER_ENGINE_URL="http://localhost:8000"
  _KEY="${SCRAPER_API_KEY:-tolipai_local_dev_key}"
  export SCRAPER_API_KEY="$_KEY"
  export WEBSCRAPER_API_KEY="$_KEY"

  echo "[node-start] Starting scraper engine on port 8000 (Python: $_PYTHON)..."
  (cd "$_SCRAPER_DIR" && \
    DATABASE_URL="${DATABASE_URL:-}" \
    SCRAPER_API_KEY="$_KEY" \
    PORT=8000 \
    nohup "$_PYTHON" -m uvicorn workers.main:app \
      --host 0.0.0.0 --port 8000 --log-level warning \
      > /tmp/scraper-engine.log 2>&1 &)
  sleep 4
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "[node-start] Scraper engine healthy ✓"
  else
    echo "[node-start] Scraper engine not yet ready (check /tmp/scraper-engine.log)"
  fi
else
  echo "[node-start] Python venv not found — scraper engine will not start locally."
  echo "[node-start]   Run: cd artifacts/TolipAI-scraper-engine && uv venv .venv && uv pip install -r requirements.txt"
fi

exec node --enable-source-maps artifacts/api-server/dist/index.mjs
