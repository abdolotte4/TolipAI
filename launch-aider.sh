#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# launch-aider.sh — Start Aider AI assistant for the Digor LLC project
#
# Usage:
#   ./launch-aider.sh                     # Interactive chat (no files preloaded)
#   ./launch-aider.sh workers/main.py     # Open specific file(s)
#   ./launch-aider.sh --help              # Aider help
#
# Switching between agents:
#   Replit Agent — use the web chat interface (auto-commits changes)
#   Aider        — run this script in the Shell tab
#
# After Aider makes changes, commit with:
#   git add -A && git commit -m "your message"
# ─────────────────────────────────────────────────────────────────────────────

set -e

AIDER_BIN="$HOME/.pythonlibs/bin/aider"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_ROOT"

# Ensure the Aider binary exists
if [ ! -f "$AIDER_BIN" ]; then
  echo "Aider not found at $AIDER_BIN — installing..."
  pip install aider-chat --quiet
  AIDER_BIN="$(which aider)"
fi

# Check for API key (prefer OpenRouter, fallback to Groq)
if [ -n "$OPENROUTER_API_KEY" ]; then
  echo "✓ Using OpenRouter API key"
  export OPENAI_API_BASE="https://openrouter.ai/api/v1"
  export OPENAI_API_KEY="$OPENROUTER_API_KEY"
  MODEL_FLAG=""
elif [ -n "$GROQ_API_KEY" ]; then
  echo "✓ Using Groq API key (fallback)"
  MODEL_FLAG="--model groq/llama-3.3-70b-versatile"
elif [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "✓ Using Anthropic API key"
  MODEL_FLAG="--model claude-3-5-sonnet-20241022"
else
  echo "⚠ No API key found. Set OPENROUTER_API_KEY, GROQ_API_KEY, or ANTHROPIC_API_KEY in Replit Secrets."
  echo "  Replit Agent will set secrets for you if you ask it."
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Digor LLC — Aider AI Assistant"
echo "  Project: $PROJECT_ROOT"
echo "  Config:  .aider.conf.yml"
echo "  Context: CONVENTIONS.md + docs/agent-chat-context.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Commands inside Aider:"
echo "  /add <file>     — add a file to the edit context"
echo "  /drop <file>    — remove a file from context"
echo "  /ls             — list files in context"
echo "  /diff           — show recent changes"
echo "  /run <cmd>      — run a shell command"
echo "  /git <cmd>      — run a git command"
echo "  /quit           — exit Aider"
echo ""
echo "To switch back to Replit Agent, just close this shell and use the chat."
echo ""

# Launch Aider — passes any extra CLI args through (e.g. specific files)
exec "$AIDER_BIN" $MODEL_FLAG "$@"
