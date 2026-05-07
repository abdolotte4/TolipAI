"""AI-powered discovery of county deed/transfer sources."""

from __future__ import annotations
import logging
from typing import Optional
from ..llm import _chat
from ..http_client import fetch_html

log = logging.getLogger("ai_discover")


async def discover_deed_source(
    state: str, county: str = "", city: str = ""
) -> Optional[str]:
    """
    Use AI + Crawl4AI to discover the official deed/transfer search URL
    for a given state/county/city.

    Returns:
        str: URL of the discovered source, or None if not found.
    """
    query = f"{county or city} County {state} official deed transfer site OR register of deeds OR clerk of court"
    sys_msg = (
        "You are a discovery agent. Given a state/county/city, find the official "
        "government or recorder website that provides deed/transfer records. "
        'Return STRICTLY JSON: {"url": "https://..."}. '
        "Only return official sources (county clerk, recorder, register of deeds). "
        "Skip aggregator sites unless no official source exists."
    )
    try:
        raw = await _chat(
            [
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": query},
            ],
            json_mode=True,
            max_tokens=500,
            temperature=0.1,
        )
        import json

        data = json.loads(raw)
        url = data.get("url")
        if url:
            # quick sanity check: try fetching headers
            try:
                await fetch_html(url, render=False)
                log.info(
                    "Discovered deed source for %s/%s: %s", state, county or city, url
                )
                return url
            except Exception as e:
                log.warning("Discovered URL fetch failed: %s", str(e)[:120])
                return url  # still return, scraper may retry later
    except Exception as e:
        log.warning(
            "AI discovery failed for %s/%s: %s", state, county or city, str(e)[:120]
        )
    return None
