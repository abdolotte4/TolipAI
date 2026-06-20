"""AI-powered deed source discovery — PERMANENTLY DISABLED.

AUDIT COMPLIANCE:
  This module previously used LLM (_chat) to hallucinate county deed source URLs.
  The model had no knowledge of which URLs were live, required login, or returned
  useful structured data — it simply guessed plausible-looking government URLs.

  In testing, ~70% of AI-discovered URLs returned 404, 403, or redirected to a
  general homepage with no deed data. The remaining 30% returned HTML that was
  then fed back to a second LLM call (_ai_extract_deeds) which hallucinated
  deed records with fictional buyer names.

  Both calls are now removed. This stub always returns None.

  Replacement strategy:
    - Use the COUNTY_SCRAPERS registry (workers/scrapers/counties/) for the 10
      highest-volume counties (Harris TX, Dallas TX, Miami-Dade FL, Broward FL,
      Maricopa AZ, Clark NV, Orange CA, LA CA, Cook IL, Fulton GA).
    - Use the curated DEED_REGISTRY in distressed_sources.py for other counties.
    - If a county is not covered, return [] and set status = completed_no_results.
    - Add new counties manually after verifying the source URL works correctly.
"""

from __future__ import annotations

import logging
from typing import Optional

log = logging.getLogger("ai_discover")


async def discover_deed_source(state: str, county: str = "", city: str = "") -> Optional[str]:
    """AI URL discovery has been disabled.

    Always returns None. Use COUNTY_SCRAPERS or DEED_REGISTRY instead.
    """
    log.debug(
        "discover_deed_source called for %s/%s — AI discovery disabled, returning None",
        state,
        county or city,
    )
    return None
