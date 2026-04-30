#!/usr/bin/env bash
# Local development launcher that bypasses pnpm subprocess overhead.
# Each artifact's vite binary is invoked directly, and the api-server
# is built once with esbuild then started with plain node.
# This avoids the corepack EAGAIN issue when 4 pnpm processes spawn at once.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-3000}"
CRM_PORT="${CRM_PORT:-3001}"
TOOLS_PORT="${TOOLS_PORT:-3002}"

# 1. Build api-server once (esbuild — fast, ~2s).
echo "[dev-all] building api-server (esbuild)…"
node artifacts/api-server/build.mjs >/tmp/api-build.log 2>&1 || {
  echo "[dev-all] api-server build failed:"; cat /tmp/api-build.log; exit 1;
}

# 2. Pick an existing vite binary (workspaces hoist or local). Fail if missing.
pick_vite() {
  local d="$1"
  if [ -x "$ROOT/$d/node_modules/.bin/vite" ]; then echo "$ROOT/$d/node_modules/.bin/vite"; return; fi
  if [ -x "$ROOT/node_modules/.bin/vite" ]; then echo "$ROOT/node_modules/.bin/vite"; return; fi
  echo ""
}

start_vite() {
  local name="$1" dir="$2" port="$3"
  local vite_bin
  vite_bin="$(pick_vite "$dir")"
  if [ -z "$vite_bin" ]; then
    echo "[dev-all] WARN: vite not found for $name — skipping. Run 'pnpm install' first."
    return
  fi
  echo "[dev-all] starting $name on :$port"
  ( cd "$dir" && PORT="$port" "$vite_bin" --config vite.config.ts --host 0.0.0.0 --port "$port" ) &
}

# 3. Start API server.
echo "[dev-all] starting api-server on :$API_PORT"
( PORT="$API_PORT" NODE_ENV=development node --enable-source-maps artifacts/api-server/dist/index.mjs ) &

# 4. Start the three vite frontends.
start_vite "digor-website" "artifacts/digor-website" "$WEB_PORT"
start_vite "digor-crm"     "artifacts/digor-crm"     "$CRM_PORT"
start_vite "digor-tools"   "artifacts/digor-tools"   "$TOOLS_PORT"

trap 'echo "[dev-all] shutting down…"; kill 0' INT TERM
wait
