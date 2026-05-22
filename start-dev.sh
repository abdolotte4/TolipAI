#!/bin/bash
export PATH=$PATH:/home/runner/workspace/.config/npm/node_global/bin

# Start API server on port 3000 (required for login and all /api routes).
# Needs DATABASE_URL, JWT_SECRET, etc. set as environment variables.
# Runs from the pre-built dist/index.mjs — build with:
#   cd artifacts/api-server && pnpm run build
if [ -f /home/runner/workspace/artifacts/api-server/dist/index.mjs ]; then
  echo "[start-dev] Starting API server on port 3000..."
  cd /home/runner/workspace/artifacts/api-server && PORT=3000 node --enable-source-maps ./dist/index.mjs &
  API_PID=$!
else
  echo "[start-dev] WARNING: api-server not built — /api routes will not work."
  echo "            Run: cd artifacts/api-server && pnpm run build"
  API_PID=""
fi

# Start CRM dev server on port 3001
cd /home/runner/workspace/artifacts/TolipAI-crm && PORT=3001 pnpm run dev &
CRM_PID=$!

# Start Tools dev server on port 3002
cd /home/runner/workspace/artifacts/TolipAI-tools && PORT=3002 pnpm run dev &
TOOLS_PID=$!

# Start Website dev server on port 5000 (foreground — keeps the script alive)
# Proxies: /api → :3000 (api-server), /crm → :3001 (CRM Vite), /tools → :3002 (Tools Vite)
cd /home/runner/workspace/artifacts/TolipAI-website && PORT=5000 pnpm run dev

# If website exits, kill the others
kill $CRM_PID $TOOLS_PID 2>/dev/null
[ -n "$API_PID" ] && kill $API_PID 2>/dev/null
