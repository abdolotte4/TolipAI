#!/usr/bin/env bash
# infrastructure/update-lockfile.sh
#
# Regenerates requirements.lock from requirements.in using pip-compile.
# Run this after editing requirements.in, then commit both files.
#
# Usage:
#   ./infrastructure/update-lockfile.sh
#   ./infrastructure/update-lockfile.sh --upgrade      # bump all packages
#   ./infrastructure/update-lockfile.sh --upgrade-package crawl4ai
#
# Prerequisites:
#   pip install pip-tools
#
# The generated requirements.lock pins every package (direct + transitive)
# to exact versions.  Docker installs from requirements.lock, so builds are
# fully reproducible.  The CI validate-lockfile job fails if requirements.lock
# is out of sync with requirements.in.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

REQUIREMENTS_IN="$ROOT/requirements.in"
REQUIREMENTS_LOCK="$ROOT/requirements.lock"

if ! command -v pip-compile &>/dev/null; then
  echo "ERROR: pip-compile not found. Install pip-tools first:"
  echo "  pip install pip-tools"
  exit 1
fi

echo "==> Compiling $REQUIREMENTS_LOCK from $REQUIREMENTS_IN …"
pip-compile \
  "$REQUIREMENTS_IN" \
  --output-file "$REQUIREMENTS_LOCK" \
  --no-header \
  --quiet \
  --resolver backtracking \
  "$@"

echo ""
echo "==> Done. Commit requirements.in and requirements.lock together."
echo "    git add requirements.in requirements.lock && git commit -m 'chore: update dependency lockfile'"
