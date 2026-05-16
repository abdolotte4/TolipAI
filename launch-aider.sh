#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# launch-aider.sh — Aider AI for the TolipAI LLC project
#
# Model priority (tries each in order until one has a valid API key):
#   1. Kimi K2.6 — Moonshot direct API  (MOONSHOT_KIMI_API_KEY)
#   2. Kimi K2.6 — OpenRouter proxy     (OPENROUTER_API_KEY)
#   3. Gemini 2.0 Flash — FREE tier     (GEMINI_API_KEY or GOOGLE_AI_API_KEY)
#   4. Groq Llama 3.3-70b — free        (GROQ_API_KEY)
#   5. Cerebras Llama 3.1-70b — fast    (CEREBRAS_API_KEY)
#   6. Together AI Llama 3.3-70b        (TOGETHER_API_KEY)
#   7. Claude 3.5 Sonnet                (ANTHROPIC_API_KEY)
#   8. GPT-4o                           (OPENAI_API_KEY)
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

# ── Pre-flight: validate API keys before committing to a model ────────────────
# If MOONSHOT_KIMI_API_KEY is set but the account is suspended / out of balance,
# unset it so the elif chain below falls through to the next working provider.
if [ -n "$MOONSHOT_KIMI_API_KEY" ]; then
  if ! python3 - <<'PYEOF' 2>/dev/null
import urllib.request, json, os, sys
req = urllib.request.Request(
    "https://api.moonshot.ai/v1/chat/completions",
    data=json.dumps({
        "model": "moonshot-v1-8k",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1
    }).encode(),
    headers={
        "Authorization": "Bearer " + os.environ["MOONSHOT_KIMI_API_KEY"],
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    urllib.request.urlopen(req, timeout=8)
    sys.exit(0)          # OK — account active
except Exception as e:
    msg = str(e).lower()
    # 402 = payment required, "suspended" or "balance" = no credits
    if "402" in msg or "suspend" in msg or "balance" in msg or "429" in msg:
        sys.exit(1)      # Definitely broken — skip to next provider
    sys.exit(0)          # Other error (network?) — try anyway
PYEOF
    echo "⚠  Moonshot key exists but account suspended/insufficient balance — skipping to next model"
    unset MOONSHOT_KIMI_API_KEY
    unset OPENAI_API_BASE
  fi
fi

# ── Model selection (first matching key wins) ─────────────────────────────────
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
  WEAK_MODEL="openrouter/google/gemini-flash-1.5-8b"
  MAP_TOKENS=8192

elif [ -n "$GEMINI_API_KEY" ] || [ -n "$GOOGLE_AI_API_KEY" ]; then
  # Gemini 2.0 Flash — Google's free tier (large context, fast)
  KEY="${GEMINI_API_KEY:-$GOOGLE_AI_API_KEY}"
  export GEMINI_API_KEY="$KEY"
  echo "✓ Gemini 2.0 Flash — Google free tier (1M context)"
  MODEL="gemini/gemini-2.0-flash"
  WEAK_MODEL="gemini/gemini-2.0-flash-lite"
  MAP_TOKENS=16384

elif [ -n "$GROQ_API_KEY" ]; then
  echo "✓ Groq Llama 3.3-70b — free (add MOONSHOT_KIMI_API_KEY for Kimi K2.6)"
  MODEL="groq/llama-3.3-70b-versatile"
  WEAK_MODEL="groq/llama-3.1-8b-instant"
  MAP_TOKENS=4096

elif [ -n "$CEREBRAS_API_KEY" ]; then
  echo "✓ Cerebras Llama 3.1-70b — very fast"
  MODEL="cerebras/llama3.1-70b"
  WEAK_MODEL="cerebras/llama3.1-8b"
  MAP_TOKENS=4096

elif [ -n "$TOGETHER_API_KEY" ]; then
  echo "✓ Together AI Llama 3.3-70b"
  MODEL="together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo"
  WEAK_MODEL="together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"
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
  echo ""
  echo "   MOONSHOT_KIMI_API_KEY  → https://platform.moonshot.ai  (Kimi K2.6, best)"
  echo "   GEMINI_API_KEY         → https://aistudio.google.com   (FREE — Gemini 2.0 Flash)"
  echo "   GROQ_API_KEY           → https://console.groq.com      (FREE — Llama 3.3-70b)"
  echo "   CEREBRAS_API_KEY       → https://cloud.cerebras.ai     (FREE — ultra fast)"
  echo "   OPENROUTER_API_KEY     → https://openrouter.ai         (many models)"
  echo "   TOGETHER_API_KEY       → https://api.together.ai"
  echo "   ANTHROPIC_API_KEY      → https://console.anthropic.com"
  echo "   OPENAI_API_KEY         → https://platform.openai.com"
  echo ""
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TolipAI LLC — Aider AI"
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
