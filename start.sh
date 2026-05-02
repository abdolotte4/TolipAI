#!/usr/bin/env bash
# start.sh — wraps uvicorn with Playwright-compatible LD_LIBRARY_PATH.
#
# On Railway (nixpacks/Ubuntu) the Nix system libs are auto-added; this
# script's dynamic resolution is a no-op there.
# On Replit (NixOS) the Nix store hashes differ across rebuilds, so we
# resolve the exact paths at runtime.

set -euo pipefail

# ── Dynamic Nix store lib resolver ──────────────────────────────────────────
# Finds the newest version of each required lib inside /nix/store and builds
# LD_LIBRARY_PATH from those directories.

build_nix_ld_path() {
  python3 - <<'PYEOF'
import os, glob, re

NIX = "/nix/store"
needed = {
    "libX11.so.6":       r"libX11-1\.[0-9]",
    "libXcomposite.so.1":r"libXcomposite-",
    "libXdamage.so.1":   r"libx?Xdamage-",
    "libXext.so.6":      r"libXext-",
    "libXfixes.so.3":    r"libXfixes-",
    "libXrandr.so.2":    r"libXrandr-|libxrandr-",
    "libxcb.so.1":       r"libxcb-1\.",
    "libgbm.so.1":       r"mesa-libgbm-|mesa-[0-9]",
    "libexpat.so.1":     r"expat-2\.",
    "libudev.so.1":      r"eudev-|libudev-zero-",
}

dirs = set()
try:
    entries = os.listdir(NIX)
except Exception:
    entries = []

for soname, pattern in needed.items():
    for e in entries:
        if re.search(pattern, e) and not e.endswith('.drv') and not any(
            s in e for s in ['-dev', '-man', '-doc', '-debug', '-spirv', '-opencl', '-osmesa', '-opengl', '-driversdev']
        ):
            lib_dir = f"{NIX}/{e}/lib"
            if os.path.isdir(lib_dir) and os.path.exists(f"{lib_dir}/{soname}"):
                dirs.add(lib_dir)
                break

print(":".join(sorted(dirs)))
PYEOF
}

NIX_LIBS="$(build_nix_ld_path 2>/dev/null || true)"

if [ -n "$NIX_LIBS" ]; then
  export LD_LIBRARY_PATH="${NIX_LIBS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# ── Install Playwright Chromium browser if missing ──────────────────────────
python3 -m playwright install chromium 2>/dev/null || true

# ── Launch server ────────────────────────────────────────────────────────────
exec python3 -m uvicorn workers.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8765}" \
  --log-level info
