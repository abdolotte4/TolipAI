#!/usr/bin/env bash
# node-start.sh — Install deps, build, and start the Node API server on port 5000
set -e

export PORT=5000
export NODE_ENV=production

echo "[node-start] Installing workspace dependencies..."
pnpm install --frozen-lockfile=false

echo "[node-start] Building frontends + API server..."
pnpm --filter @workspace/api-server run build:prod

echo "[node-start] Starting API server on port $PORT..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
