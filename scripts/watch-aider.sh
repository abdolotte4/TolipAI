#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# watch-aider.sh — Live file watcher for Aider changes
#
# Runs continuously in background. Detects when any Python file in the
# scraper engine changes (saved by Aider or manually) and immediately:
#   1. Runs black --check (auto-fixes if needed)
#   2. Runs flake8 lint
#   3. Updates docs/aider-session-log.md
#   4. Prints a timestamped summary to stdout
#
# This is registered as a Replit workflow so Replit Agent can see its
# output and act on failures automatically.
#
# Usage:
#   bash scripts/watch-aider.sh          # run directly
#   (configured as "Aider Watch" workflow in Replit)
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_ROOT="/home/runner/workspace"
WATCH_DIR="$PROJECT_ROOT/artifacts/digor-scraper-engine/workers"
LOG_FILE="$PROJECT_ROOT/docs/aider-session-log.md"
POLL_INTERVAL=5   # seconds between file-state checks

cd "$PROJECT_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Aider Watch — live code quality monitor"
echo "  Watching: $WATCH_DIR"
echo "  Polling every ${POLL_INTERVAL}s for changed .py files"
echo "  Output:   docs/aider-session-log.md"
echo "  Started:  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Build initial file state snapshot (filename:mtime)
snapshot() {
  find "$WATCH_DIR" -name "*.py" -not -path "*/__pycache__/*" \
    -exec stat -c "%n:%Y" {} \; 2>/dev/null | sort
}

LAST_STATE=$(snapshot)
LAST_CLEAN_RUN=""

run_checks() {
  local changed_files="$1"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  echo ""
  echo "[$timestamp] Change detected:"
  echo "$changed_files" | sed 's|.*/workers/|  workers/|'
  echo ""

  # ── Black check + auto-fix ──────────────────────────────────────────────
  BLACK_OUT=$(echo "$changed_files" | xargs python -m black --check --line-length 120 2>&1 || true)
  if echo "$BLACK_OUT" | grep -q "would reformat"; then
    echo "  ⚠ black: reformatting..."
    echo "$changed_files" | xargs python -m black --line-length 120 2>/dev/null
    BLACK_STATUS="⚠ Auto-reformatted by watcher"
  else
    BLACK_STATUS="✓ Correctly formatted"
  fi
  echo "  black:  $BLACK_STATUS"

  # ── Flake8 lint ─────────────────────────────────────────────────────────
  FLAKE8_OUT=$(echo "$changed_files" | xargs python -m flake8 \
    --max-line-length=120 \
    --extend-ignore=E203,W503,E501 \
    --exclude=__pycache__ 2>&1 || true)
  if [ -n "$FLAKE8_OUT" ]; then
    FLAKE8_STATUS="⚠ Lint errors found — Replit Agent will fix"
    echo "  flake8: $FLAKE8_STATUS"
    echo "$FLAKE8_OUT" | sed 's|.*/workers/|  workers/|'
  else
    FLAKE8_STATUS="✓ Clean"
    echo "  flake8: $FLAKE8_STATUS"
  fi

  # ── Write live log ──────────────────────────────────────────────────────
  mkdir -p "$PROJECT_ROOT/docs"
  cat > "$LOG_FILE" << LOGEOF
# Aider Session Log — Live Monitor
> Last updated: $timestamp (auto-updated every ${POLL_INTERVAL}s by watch-aider.sh)
> Replit Agent reads this file at the start of every session and fixes any ⚠ issues

## Latest Change Detected

**Timestamp:** $timestamp

### Changed Files
\`\`\`
$changed_files
\`\`\`

---

## Validation Results

### Black Formatting
$BLACK_STATUS

### Flake8 Lint
$FLAKE8_STATUS

\`\`\`
${FLAKE8_OUT:-"(all clean)"}
\`\`\`

---

## Action Items for Replit Agent

$(if [ -n "$FLAKE8_OUT" ]; then
  echo "- [ ] Fix flake8 lint errors listed above"
  echo "- [ ] Run: cd artifacts/digor-scraper-engine && python -m flake8 workers/ --max-line-length=120 --extend-ignore=E203,W503,E501"
fi)
$(if echo "$BLACK_OUT" | grep -q "would reformat" 2>/dev/null; then
  echo "- [ ] Black found formatting issues (watcher auto-fixed — review diff)"
fi)
$(if [ -z "$FLAKE8_OUT" ]; then
  echo "- [x] All checks passed — no action needed"
fi)

---

## How This Works

- **watch-aider.sh** runs continuously as a Replit workflow
- Detects every .py file change in workers/ within ${POLL_INTERVAL}s
- Auto-fixes black formatting, flags flake8 issues
- Replit Agent reads this log at session start and fixes remaining issues
LOGEOF

  echo ""
  if [ -n "$FLAKE8_OUT" ]; then
    echo "  [!] Issues logged → Replit Agent will fix on next session"
  else
    echo "  [✓] All clean — log updated"
  fi
  echo ""
}

# ── Main polling loop ─────────────────────────────────────────────────────────
while true; do
  sleep "$POLL_INTERVAL"

  CURRENT_STATE=$(snapshot)

  if [ "$CURRENT_STATE" != "$LAST_STATE" ]; then
    # Find which specific files changed
    CHANGED=$(diff <(echo "$LAST_STATE") <(echo "$CURRENT_STATE") \
      | grep "^>" | sed 's/^> //' | cut -d: -f1 | sort -u || true)

    if [ -n "$CHANGED" ]; then
      run_checks "$CHANGED"
    fi

    LAST_STATE="$CURRENT_STATE"
  fi
done
