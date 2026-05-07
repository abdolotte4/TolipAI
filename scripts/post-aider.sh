#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# post-aider.sh — Runs automatically after every Aider session ends.
#
# What it does:
#   1. Detects which files Aider changed (git diff)
#   2. Runs black --check on changed Python files
#   3. Runs flake8 on changed Python files
#   4. Checks for uncommitted changes Aider left behind
#   5. Writes a full report to docs/aider-session-log.md
#
# Replit Agent reads this log at the start of every session and will
# automatically fix any issues Aider left behind.
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_ROOT="/home/runner/workspace"
LOG_FILE="$PROJECT_ROOT/docs/aider-session-log.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
PYTHON_WORKERS="artifacts/digor-scraper-engine/workers"

cd "$PROJECT_ROOT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-Aider check running..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Find changed files ─────────────────────────────────────────────────────
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || echo "")
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || echo "")
UNTRACKED_FILES=$(git ls-files --others --exclude-standard 2>/dev/null | grep -v "^docs/aider-session-log" || echo "")
ALL_CHANGED=$(echo -e "$CHANGED_FILES\n$STAGED_FILES\n$UNTRACKED_FILES" | sort -u | grep -v "^$" || echo "")

CHANGED_PY=$(echo "$ALL_CHANGED" | grep "\.py$" || echo "")
CHANGED_TS=$(echo "$ALL_CHANGED" | grep "\.ts$" || echo "")

if [ -z "$ALL_CHANGED" ]; then
  echo "  ℹ  No file changes detected since last commit."
  CHANGE_SUMMARY="No changes detected — Aider session may have been read-only or changes were already committed."
else
  echo "  Changed files:"
  echo "$ALL_CHANGED" | sed 's/^/    /'
fi

# ── 2. Black formatting check ─────────────────────────────────────────────────
BLACK_STATUS="✓ All changed Python files are correctly formatted"
BLACK_OUTPUT=""
if [ -n "$CHANGED_PY" ]; then
  echo ""
  echo "  Running black --check on changed Python files..."
  BLACK_OUTPUT=$(echo "$CHANGED_PY" | xargs python -m black --check --line-length 120 2>&1 || true)
  if echo "$BLACK_OUTPUT" | grep -q "would reformat"; then
    BLACK_STATUS="⚠ Some files need black formatting"
    echo "  $BLACK_STATUS"
    # Auto-fix: actually run black on them
    echo "$CHANGED_PY" | xargs python -m black --line-length 120 2>/dev/null || true
    BLACK_STATUS="⚠ Found formatting issues — auto-fixed with black (check diff)"
    echo "  Auto-fixed with black ✓"
  else
    echo "  $BLACK_STATUS"
  fi
fi

# ── 3. Flake8 lint check ──────────────────────────────────────────────────────
FLAKE8_STATUS="✓ No lint errors in changed Python files"
FLAKE8_OUTPUT=""
if [ -n "$CHANGED_PY" ]; then
  echo ""
  echo "  Running flake8 on changed Python files..."
  FLAKE8_OUTPUT=$(echo "$CHANGED_PY" | xargs python -m flake8 \
    --max-line-length=120 \
    --extend-ignore=E203,W503,E501 \
    --exclude=__pycache__ 2>&1 || true)
  if [ -n "$FLAKE8_OUTPUT" ]; then
    FLAKE8_STATUS="⚠ Lint issues found — Replit Agent will fix these"
    echo "  $FLAKE8_STATUS:"
    echo "$FLAKE8_OUTPUT" | sed 's/^/    /'
  else
    echo "  $FLAKE8_STATUS"
  fi
fi

# ── 4. Check for uncommitted changes ─────────────────────────────────────────
UNCOMMITTED=""
if [ -n "$CHANGED_FILES" ]; then
  UNCOMMITTED="⚠ Aider left uncommitted changes — commit manually or ask Replit Agent to commit"
  echo ""
  echo "  $UNCOMMITTED"
fi

# ── 5. TypeScript check ───────────────────────────────────────────────────────
TS_STATUS=""
if [ -n "$CHANGED_TS" ]; then
  echo ""
  echo "  Running TypeScript check on changed files..."
  TS_OUTPUT=$(npx tsc --noEmit 2>&1 | head -30 || true)
  if [ -n "$TS_OUTPUT" ]; then
    TS_STATUS="⚠ TypeScript errors detected"
    echo "  $TS_STATUS"
  else
    TS_STATUS="✓ No TypeScript errors"
    echo "  $TS_STATUS"
  fi
fi

# ── 6. Write structured log for Replit Agent ─────────────────────────────────
mkdir -p docs

cat > "$LOG_FILE" << LOGEOF
# Aider Session Log
> Last updated: $TIMESTAMP
> Replit Agent reads this file automatically and will fix any issues marked ⚠

## Session Summary

**Timestamp:** $TIMESTAMP

### Files Changed by Aider
\`\`\`
${ALL_CHANGED:-"(no changes detected)"}
\`\`\`

### Python Files Changed
\`\`\`
${CHANGED_PY:-"(none)"}
\`\`\`

### TypeScript Files Changed
\`\`\`
${CHANGED_TS:-"(none)"}
\`\`\`

---

## Validation Results

### Black Formatting
$BLACK_STATUS

\`\`\`
${BLACK_OUTPUT:-"(all clean)"}
\`\`\`

### Flake8 Lint
$FLAKE8_STATUS

\`\`\`
${FLAKE8_OUTPUT:-"(all clean)"}
\`\`\`

### TypeScript
${TS_STATUS:-"(no TS files changed)"}

### Uncommitted Changes
${UNCOMMITTED:-"✓ All changes committed"}

---

## Action Items for Replit Agent

$(if [ -n "$FLAKE8_OUTPUT" ]; then
  echo "- [ ] Fix flake8 lint errors listed above"
fi)
$(if echo "$BLACK_OUTPUT" | grep -q "would reformat" 2>/dev/null; then
  echo "- [ ] Black auto-fixed some files — review the diff"
fi)
$(if [ -n "$UNCOMMITTED" ]; then
  echo "- [ ] Commit or review Aider's uncommitted changes"
fi)
$(if [ -z "$FLAKE8_OUTPUT" ] && [ -z "$UNCOMMITTED" ]; then
  echo "- [x] All checks passed — no action needed"
fi)

---

## How to Use This Log

**Replit Agent** reads this automatically at the start of every session.
To ask Replit Agent to review Aider's work, just say:
> "check what Aider did last session"

**Aider** can also read this log by typing in Aider chat:
> /read docs/aider-session-log.md
LOGEOF

echo ""
echo "  Report written → docs/aider-session-log.md"
echo ""

# ── 7. Final summary ──────────────────────────────────────────────────────────
HAS_ISSUES=false
[ -n "$FLAKE8_OUTPUT" ] && HAS_ISSUES=true
[ -n "$UNCOMMITTED" ] && HAS_ISSUES=true

if [ "$HAS_ISSUES" = true ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ⚠  Issues found. Replit Agent will fix them automatically."
  echo "     Switch to the chat panel and it will pick up from here."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✓  All checks passed. Aider session was clean."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
echo ""
