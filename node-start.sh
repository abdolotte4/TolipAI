#!/usr/bin/env bash
# node-start.sh — Install deps, build, and start the Node API server on port 5000
set -e

export PORT=5000
# NODE_ENV is set to production only for the final server process.
# During install + build we need devDependencies (vite, esbuild, etc.)
unset NODE_ENV

# ── Locate Node.js / npm (Replit NixOS uses nix-store paths) ────────────────
# Replit's workflow runner may not inherit the full PATH, so we resolve node
# and npm explicitly before falling back to whatever is in PATH.
_add_node_to_path() {
  # 1. Try the path reported by available-pid2-node-paths (Replit helper)
  local REPLIT_NODE
  REPLIT_NODE="$(available-pid2-node-paths 2>/dev/null | head -1 | xargs dirname 2>/dev/null)"
  if [ -n "$REPLIT_NODE" ] && [ -x "$REPLIT_NODE/node" ]; then
    export PATH="$REPLIT_NODE:$PATH"
    return 0
  fi
  # 2. Scan /nix/store for a nodejs directory (fast glob, not recursive find)
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

# Ensure pnpm v9+ is available (supports catalog: protocol, works with Node 20)
# Check local bin first (installed via npm --prefix ~/.local), then other fallbacks.
NPM_LOCAL_BIN="$HOME/.local/bin"
NPM_GLOBAL_BIN="$(node /nix/store/*/lib/node_modules/npm/bin/npm-cli.js config get prefix 2>/dev/null | head -1)/bin"
PNPM_BIN=""
for candidate in \
  "$NPM_LOCAL_BIN/pnpm" \
  "$NPM_GLOBAL_BIN/pnpm" \
  "$(which pnpm 2>/dev/null)" \
  "$HOME/.local/share/pnpm/pnpm"; do
  if [ -x "$candidate" ]; then
    PNPM_BIN="$candidate"
    break
  fi
done

if [ -z "$PNPM_BIN" ]; then
  echo "[node-start] pnpm not found — installing pnpm@9 via npm to ~/.local..."
  node /nix/store/*/lib/node_modules/npm/bin/npm-cli.js install -g pnpm@9 --prefix "$HOME/.local" 2>&1 | tail -3
  PNPM_BIN="$NPM_LOCAL_BIN/pnpm"
fi

echo "[node-start] Using pnpm: $PNPM_BIN ($("$PNPM_BIN" --version))"

echo "[node-start] Installing workspace dependencies..."
"$PNPM_BIN" install --frozen-lockfile=false --force

echo "[node-start] Building frontends + API server..."
"$PNPM_BIN" --filter @workspace/api-server run build:prod

echo "[node-start] Starting API server on port $PORT..."
export NODE_ENV=production
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
