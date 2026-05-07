#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# launch-aider.sh — Aider AI for the Digor LLC project
#
# Model priority:
#   1. Kimi K2.6 — Moonshot direct API  (MOONSHOT_KIMI_API_KEY)
#   2. Kimi K2.6 — OpenRouter proxy     (OPENROUTER_API_KEY)
#   3. Groq Llama 3.3-70b — free        (GROQ_API_KEY)
#   4. Claude 3.5 Sonnet                (ANTHROPIC_API_KEY)
#   5. GPT-4o                           (OPENAI_API_KEY)
#
# After Aider exits, scripts/post-aider.sh runs automatically:
#   - Validates all changes (black, flake8, TypeScript)
#   - Writes report to docs/aider-session-log.md
#   - Replit Agent reads that log and fixes any issues without you asking
#
# Usage:
#   ./launch-aider.sh                              # Full project context
#   ./launch-aider.sh workers/main.py              # Also pre-load a file
#   ./launch-aider.sh workers/main.py workers/db.py
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

# ── Model selection ───────────────────────────────────────────────────────────
if [ -n "$MOONSHOT_KIMI_API_KEY" ]; then
  echo "✓ Kimi K2.6 — Moonshot direct (1M token context)"
  export OPENAI_API_KEY="$MOONSHOT_KIMI_API_KEY"
  export OPENAI_API_BASE="https://api.moonshot.ai/v1"
  MODEL="openai/kimi-k2"
  WEAK_MODEL="openai/moonshot-v1-8k"
  MAP_TOKENS=16384

elif [ -n "$OPENROUTER_API_KEY" ]; then
  echo "✓ Kimi K2.6 — OpenRouter (1M token context)"
  MODEL="openrouter/moonshotai/kimi-k2.6"
  WEAK_MODEL="openrouter/openai/gpt-4o-mini"
  MAP_TOKENS=8192

elif [ -n "$GROQ_API_KEY" ]; then
  echo "✓ Groq Llama 3.3-70b (free — add MOONSHOT_KIMI_API_KEY for Kimi K2.6)"
  MODEL="groq/llama-3.3-70b-versatile"
  WEAK_MODEL="groq/llama-3.1-8b-instant"
  MAP_TOKENS=4096

elif [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "✓ Claude 3.5 Sonnet"
  MODEL="claude-3-5-sonnet-20241022"
  WEAK_MODEL="claude-3-haiku-20240307"
  MAP_TOKENS=8192

elif [ -n "$OPENAI_API_KEY" ]; then
  echo "✓ GPT-4o"
  MODEL="gpt-4o"
  WEAK_MODEL="gpt-4o-mini"
  MAP_TOKENS=8192

else
  echo ""
  echo "⚠  No API key found. Set one of these in Replit Secrets:"
  echo "   MOONSHOT_KIMI_API_KEY  → https://platform.moonshot.ai  (Kimi K2.6, best)"
  echo "   OPENROUTER_API_KEY     → https://openrouter.ai"
  echo "   GROQ_API_KEY           → https://console.groq.com  (free)"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Digor LLC — Aider AI"
echo "  Model:    $MODEL"
echo "  Context:  full repo map (${MAP_TOKENS} tokens) + CONVENTIONS.md"
echo "  Files:    config.py, llm.py, db.py, distressed.py, http_client.py"
echo "  Auto:     flake8 after every edit"
echo "  On exit:  post-aider check runs → Replit Agent picks up any issues"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Just type what you want:"
echo "    fix the retry logic in http_client.py"
echo "    add a /health endpoint to main.py"
echo "    refactor the distressed scraper to run sources in parallel"
echo ""
echo "  Load more files:  /add workers/main.py scrapers/county.py"
echo "  See loaded files: /ls"
echo "  See what changed: /diff"
echo "  Undo last change: /undo"
echo "  Run a command:    /run pytest -q"
echo "  Commit:           /git commit -am 'your message'"
echo "  Exit:             /quit  (post-check runs automatically)"
echo ""
echo "  Switch to Replit Agent: close this shell, it will check your work."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Run Aider (NOT exec — we need to run post-check after it exits) ───────────
"$AIDER_BIN" \
  --model "$MODEL" \
  --weak-model "$WEAK_MODEL" \
  --map-tokens "$MAP_TOKENS" \
  --no-show-model-warnings \
  "$@"

AIDER_EXIT=$?

# ── Post-session validation — runs automatically when Aider exits ─────────────
echo ""
echo "Aider exited. Running post-session check..."
bash "$PROJECT_ROOT/scripts/post-aider.sh"

exit $AIDER_EXIT
