#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# launch-aider.sh — Start Aider AI for the Digor LLC project
#
# Usage:
#   ./launch-aider.sh                            # Open with project context
#   ./launch-aider.sh workers/main.py            # Also open a specific file
#   ./launch-aider.sh workers/main.py workers/db.py  # Multiple files
#
# Switching agents:
#   Replit Agent → use the chat panel (auto-commits)
#   Aider        → run this in the Shell tab (you commit with: git add -A && git commit)
# ─────────────────────────────────────────────────────────────────────────────

set -e

AIDER_BIN="/home/runner/workspace/.pythonlibs/bin/aider"
PROJECT_ROOT="/home/runner/workspace"

cd "$PROJECT_ROOT"

if [ ! -f "$AIDER_BIN" ]; then
  echo "Installing Aider..."
  pip install aider-chat --quiet
  AIDER_BIN="$(which aider)"
fi

# ── Format / lint / test commands (passed as CLI flags to avoid YAML issues) ──
FORMAT_CMD="python -m black {file}"
LINT_CMD="python -m flake8 --max-line-length=120 --extend-ignore=E203,W503,E501 {file}"
# TEST_CMD="pytest -q"   # uncomment when you have tests

# ── Pick model based on available API keys ────────────────────────────────────
if [ -n "$GROQ_API_KEY" ]; then
  echo "✓ Groq (free tier) — fast, no credits needed"
  MODEL="groq/llama-3.3-70b-versatile"
  WEAK_MODEL="groq/llama-3.1-8b-instant"
  MAP_TOKENS=4096

elif [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "✓ Anthropic Claude"
  MODEL="claude-3-5-sonnet-20241022"
  WEAK_MODEL="claude-3-haiku-20240307"
  MAP_TOKENS=4096

elif [ -n "$OPENROUTER_API_KEY" ]; then
  echo "✓ OpenRouter — using small free model to save credits"
  echo "  Tip: Add GROQ_API_KEY in Replit Secrets for unlimited free usage."
  MODEL="openrouter/meta-llama/llama-3.1-8b-instruct:free"
  WEAK_MODEL="openrouter/meta-llama/llama-3.1-8b-instruct:free"
  MAP_TOKENS=512   # keep very small — free OpenRouter has tiny credit limit

elif [ -n "$OPENAI_API_KEY" ]; then
  echo "✓ OpenAI"
  MODEL="gpt-4o"
  WEAK_MODEL="gpt-4o-mini"
  MAP_TOKENS=4096

else
  echo ""
  echo "⚠  No API key found!"
  echo ""
  echo "   Best option (free): get a Groq API key at https://console.groq.com"
  echo "   Then add it to Replit Secrets as GROQ_API_KEY"
  echo ""
  echo "   Also works: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Digor LLC — Aider AI (chat naturally, just like Replit Agent)"
echo "  Model: $MODEL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Just type what you want:"
echo "    fix the flake8 errors in workers/db.py"
echo "    add retry logic to the cash buyers fetcher"
echo "    refactor all scrapers to use the new http_client helper"
echo ""
echo "  Slash commands:"
echo "    /add workers/main.py scrapers/county.py  — load files for editing"
echo "    /ls                                       — see loaded files"
echo "    /diff                                     — see what changed"
echo "    /undo                                     — revert last change"
echo "    /run pytest -q                            — run a shell command"
echo "    /git add -A && /git commit -m 'msg'       — commit changes"
echo "    /quit                                     — exit"
echo ""
echo "  Tip: Use /add to load multiple files, then describe the change once."
echo "  To switch back to Replit Agent, just close this shell."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec "$AIDER_BIN" \
  --model "$MODEL" \
  --weak-model "$WEAK_MODEL" \
  --map-tokens "$MAP_TOKENS" \
  --cache-prompts \
  --format-cmd "$FORMAT_CMD" \
  --lint-cmd "$LINT_CMD" \
  --attribute-author false \
  --attribute-committer false \
  "$@"
