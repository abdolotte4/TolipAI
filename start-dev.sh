#!/bin/bash
export PATH=$PATH:/home/runner/workspace/.config/npm/node_global/bin

# Start CRM dev server on port 3001
cd artifacts/TolipAI-crm && PORT=3001 pnpm run dev &
CRM_PID=$!

# Start Tools dev server on port 3002
cd /home/runner/workspace/artifacts/TolipAI-tools && PORT=3002 pnpm run dev &
TOOLS_PID=$!

# Start Website dev server on port 5000 (foreground — keeps the script alive)
cd /home/runner/workspace/artifacts/TolipAI-website && PORT=5000 pnpm run dev

# If website exits, kill the others
kill $CRM_PID $TOOLS_PID 2>/dev/null
