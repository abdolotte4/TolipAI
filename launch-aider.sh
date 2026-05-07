#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# launch-aider.sh — Aider AI for the Digor LLC project
#
# Model priority:
#   1. Kimi K2.6 via Moonshot direct API  (MOONSHOT_KIMI_API_KEY)
#   2. Kimi K2.6 via OpenRouter           (OPENROUTER_API_KEY)
#   3. Groq Llama 3.3-70b                 (GROQ_API_KEY — free fallback)
#   4. Claude 3.5 Sonnet                  (ANTHROPIC_API_KEY)
#   5. GPT-4o                             (OPENAI_API_KEY)
#
# Usage:
#   ./launch-aider.sh                              # Chat mode
#   ./launch-aider.sh workers/main.py              # Pre-load a file
#   ./launch-aider.sh workers/main.py workers/db.py  # Pre-load multiple files
#
# Switching agents:
#   Replit Agent → chat panel (auto-commits)
#   Aider        → this script in Shell tab (commit with: git add -A && git commit)
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

# ── Format / lint commands (passed as CLI flags to avoid YAML parsing issues) ─
FORMAT_CMD="python -m black {file}"
LINT_CMD="python -m flake8 --max-line-length=120 --extend-ignore=E203,W503,E501 {file}"

# ── Model selection: Kimi K2.6 first, Groq fallback ──────────────────────────
EXTRA_FLAGS=""

if [ -n "$MOONSHOT_KIMI_API_KEY" ]; then
  # ── Option 1: Kimi K2.6 via Moonshot direct API ────────────────────────────
  echo "✓ Kimi K2.6 — Moonshot direct API (1M token context)"
  export OPENAI_API_KEY="$MOONSHOT_KIMI_API_KEY"
  export OPENAI_API_BASE="https://api.moonshot.ai/v1"
  MODEL="openai/kimi-k2"
  WEAK_MODEL="openai/moonshot-v1-8k"
  MAP_TOKENS=16384

elif [ -n "$OPENROUTER_API_KEY" ]; then
  # ── Option 2: Kimi K2.6 via OpenRouter ─────────────────────────────────────
  echo "✓ Kimi K2.6 — via OpenRouter (1M token context)"
  MODEL="openrouter/moonshotai/kimi-k2.6"
  WEAK_MODEL="openrouter/openai/gpt-4o-mini"
  MAP_TOKENS=8192

elif [ -n "$GROQ_API_KEY" ]; then
  # ── Option 3: Groq (free fallback) ─────────────────────────────────────────
  echo "✓ Groq Llama 3.3-70b (free fallback — add MOONSHOT_KIMI_API_KEY for Kimi K2.6)"
  MODEL="groq/llama-3.3-70b-versatile"
  WEAK_MODEL="groq/llama-3.1-8b-instant"
  MAP_TOKENS=4096

elif [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "✓ Anthropic Claude 3.5 Sonnet"
  MODEL="claude-3-5-sonnet-20241022"
  WEAK_MODEL="claude-3-haiku-20240307"
  MAP_TOKENS=8192

elif [ -n "$OPENAI_API_KEY" ]; then
  echo "✓ OpenAI GPT-4o"
  MODEL="gpt-4o"
  WEAK_MODEL="gpt-4o-mini"
  MAP_TOKENS=8192

else
  echo ""
  echo "⚠  No API key found! Set one of these in Replit Secrets:"
  echo ""
  echo "   MOONSHOT_KIMI_API_KEY  → https://platform.moonshot.ai  (Kimi K2.6, best)"
  echo "   OPENROUTER_API_KEY     → https://openrouter.ai          (Kimi K2.6 via proxy)"
  echo "   GROQ_API_KEY           → https://console.groq.com       (free)"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Digor LLC — Aider AI (Kimi K2.6 primary / Groq fallback)"
echo "  Model:      $MODEL"
echo "  Context:    ${MAP_TOKENS}K repo map tokens"
echo "  Auto-runs:  black + flake8 after every edit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Just type naturally — Aider works like Replit Agent:"
echo "    fix the bug in cash_buyers.py"
echo "    add error handling to all scrapers"
echo "    refactor workers/main.py to split routes into separate files"
echo ""
echo "  Slash commands:"
echo "    /add workers/main.py db.py   — load files for editing"
echo "    /ls                          — see loaded files"
echo "    /diff                        — see what changed"
echo "    /undo                        — revert last change"
echo "    /run pytest -q               — run a shell command"
echo "    /quit                        — exit"
echo ""
echo "  After edits: git add -A && git commit -m 'your message'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec "$AIDER_BIN" \
  --model "$MODEL" \
  --weak-model "$WEAK_MODEL" \
  --map-tokens "$MAP_TOKENS" \
  --cache-prompts \
  --no-show-model-warnings \
  --format-cmd "$FORMAT_CMD" \
  --lint-cmd "$LINT_CMD" \
  --attribute-author false \
  --attribute-committer false \
  "$@"
