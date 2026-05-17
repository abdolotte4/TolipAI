#!/usr/bin/env bash
# node-start.sh — Install deps, build, and start the Node API server on port 5000
set -e

export PORT=5000
# NODE_ENV is set to production only for the final server process.
# During install + build we need devDependencies (vite, esbuild, etc.)
unset NODE_ENV

# Ensure pnpm v9+ is available (supports catalog: protocol, works with Node 20)
# Check npm global bin first (installed via npm install -g pnpm@9), then fallback paths
NPM_GLOBAL_BIN="$(npm config get prefix 2>/dev/null)/bin"
PNPM_BIN=""
for candidate in \
  "$NPM_GLOBAL_BIN/pnpm" \
  "$(which pnpm 2>/dev/null)" \
  "$HOME/.local/share/pnpm/pnpm" \
  "$HOME/.local/bin/pnpm"; do
  if [ -x "$candidate" ]; then
    PNPM_BIN="$candidate"
    break
  fi
done

if [ -z "$PNPM_BIN" ]; then
  echo "[node-start] pnpm not found — installing pnpm@9 via npm..."
  npm install -g pnpm@9
  PNPM_BIN="$NPM_GLOBAL_BIN/pnpm"
fi

echo "[node-start] Using pnpm: $PNPM_BIN ($("$PNPM_BIN" --version))"

echo "[node-start] Installing workspace dependencies..."
"$PNPM_BIN" install --frozen-lockfile=false --force

echo "[node-start] Building frontends + API server..."
"$PNPM_BIN" --filter @workspace/api-server run build:prod

echo "[node-start] Starting API server on port $PORT..."
export NODE_ENV=production
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
