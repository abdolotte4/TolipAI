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
  SRC_DIRS="artifacts/api-server/src artifacts/TolipAI-crm/src lib/db/src"
  for d in $SRC_DIRS; do
    if [ -d "$d" ]; then
      NEWER=$(find "$d" -name "*.ts" -newer "$DIST" 2>/dev/null | head -1)
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

echo "[node-start] Starting API server on port $PORT..."
export NODE_ENV=production
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
