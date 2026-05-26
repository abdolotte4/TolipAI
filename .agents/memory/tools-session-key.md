---
name: Tools session storage key
description: Canonical localStorage key for Tools PIN session is tolipai_tools_pin (all lowercase). Mixed-case variant is a bug.
---

# Tools Artifact Session Storage Key

**Canonical key:** `tolipai_tools_pin` (all lowercase)

**Why:** Multiple files previously used `TolipAI_tools_pin` (camelCase) causing sessions to persist incorrectly on 401/403 — the clear-on-error logic targeted one key while the login logic wrote the other. Unified to lowercase in May 2026 audit.

**How to apply:** Any new code reading or writing the Tools PIN session in localStorage must use `tolipai_tools_pin`. Search for `TolipAI_tools_pin` as a linter check — that variant is always wrong.
