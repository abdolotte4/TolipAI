#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# launch-aider.sh — Start Aider AI assistant for the Digor LLC project
#
# Usage:
#   ./launch-aider.sh                          # Chat mode — just type naturally
#   ./launch-aider.sh workers/main.py          # Open a specific file for editing
#   ./launch-aider.sh workers/main.py db.py    # Open multiple files
#
# Switching between agents:
#   Replit Agent → use the chat panel on the left (auto-commits)
#   Aider        → run this script in the Shell tab (you commit manually)
#
# After Aider makes changes, commit with:
#   git add -A && git commit -m "your message"
# ─────────────────────────────────────────────────────────────────────────────

set -e

AIDER_BIN="/home/runner/workspace/.pythonlibs/bin/aider"
PROJECT_ROOT="/home/runner/workspace"

cd "$PROJECT_ROOT"

# Make sure the binary exists
if [ ! -f "$AIDER_BIN" ]; then
  echo "Aider not found — installing..."
  pip install aider-chat --quiet
  AIDER_BIN="$(which aider)"
fi

# ── Pick API key ──────────────────────────────────────────────────────────────
if [ -n "$OPENROUTER_API_KEY" ]; then
  echo "✓ Using OpenRouter (gpt-4o by default — edit .aider.conf.yml to switch models)"
  export OPENROUTER_API_KEY="$OPENROUTER_API_KEY"

elif [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "✓ Using Anthropic (Claude)"
  EXTRA_FLAGS="--model claude-3-5-sonnet-20241022"

elif [ -n "$OPENAI_API_KEY" ]; then
  echo "✓ Using OpenAI"
  EXTRA_FLAGS="--model gpt-4o"

elif [ -n "$GROQ_API_KEY" ]; then
  echo "✓ Using Groq (fast, free tier)"
  EXTRA_FLAGS="--model groq/llama-3.3-70b-versatile"

else
  echo ""
  echo "⚠  No API key found!"
  echo "   Set OPENROUTER_API_KEY in Replit Secrets (Replit Agent can do this for you)."
  echo "   Supported keys: OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Digor LLC — Aider AI (works just like Replit Agent)"
echo "  Just type what you want — no special commands needed."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Examples:"
echo "    fix the flake8 errors in workers/db.py"
echo "    add a /health endpoint to main.py"
echo "    refactor the skip_trace function to be async"
echo ""
echo "  Useful slash commands:"
echo "    /add workers/main.py    — add a file so Aider can edit it"
echo "    /ls                     — see which files are loaded"
echo "    /diff                   — show what Aider changed"
echo "    /undo                   — undo the last change"
echo "    /run flake8 workers/    — run a shell command"
echo "    /quit                   — exit"
echo ""
echo "  To switch back to Replit Agent, just close this shell."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec "$AIDER_BIN" $EXTRA_FLAGS "$@"
