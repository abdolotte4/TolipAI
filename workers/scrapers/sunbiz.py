"""Florida Sunbiz LLC lookup (extensible to other state SoS).

Looks up an LLC name and pulls its registered agent + officers/managers.
For other states we'd add a similar module per SoS.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

from bs4 import BeautifulSoup

from ..http_client import fetch_html

log = logging.getLogger("sunbiz")


async def search_llc(name: str) -> List[Dict[str, Any]]:
    """Search Sunbiz for entities matching a name. Returns list of hits."""
    if not name:
        return []
    url = (
        "https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults"
        f"?inquiryType=EntityName&searchNameOrder={quote_plus(name.upper())}"
    )
    try:
        html = await fetch_html(url, render=False)
    except Exception as e:  # noqa: BLE001
        log.info("Sunbiz search failed for %s: %s", name, e)
        return []
    soup = BeautifulSoup(html, "lxml")
    rows = soup.select("table#search-results tbody tr") or soup.select("table tbody tr")
    hits: List[Dict[str, Any]] = []
    for row in rows[:10]:
        link = row.find("a")
        if not link:
            continue
        href = link.get("href") or ""
        hits.append({
            "name": link.get_text(strip=True),
            "detail_path": href,
            "status": row.find_all("td")[-1].get_text(strip=True) if row.find_all("td") else "",
        })
    return hits


async def fetch_llc_detail(detail_path: str) -> Optional[Dict[str, Any]]:
    """Pull officers, registered agent, mailing address from an LLC detail page."""
    if not detail_path:
        return None
    if not detail_path.startswith("http"):
        detail_path = f"https://search.sunbiz.org{detail_path}"
    try:
        html = await fetch_html(detail_path, render=False)
    except Exception as e:  # noqa: BLE001
        log.info("Sunbiz detail fetch failed: %s", e)
        return None
    soup = BeautifulSoup(html, "lxml")

    # Officers / managers
    principals: List[Dict[str, str]] = []
    for sec in soup.select("section.detailSection"):
        title = sec.find(["h4", "h2", "h3"])
        if not title:
            continue
        head = title.get_text(strip=True).lower()
        if "officer" in head or "manager" in head or "authorized" in head:
            for p in sec.select("p, span, div"):
                text = p.get_text(" ", strip=True)
                m = re.match(r"(Title|Mgr|MGR|MGRM)[: ]+(.+)", text)
                if m:
                    principals.append({"role": m.group(1), "name": m.group(2)[:120]})

    # Registered agent + mailing
    text_all = soup.get_text("\n", strip=True)
    addr_match = re.search(r"Mailing Address\s*\n([^\n]+\n[^\n]+\n[^\n]+)", text_all)
    agent_match = re.search(r"Registered Agent.*?Name & Address\s*\n([^\n]+)\s*\n([^\n]+\n[^\n]+\n[^\n]+)",
                            text_all, re.DOTALL)

    return {
        "principals": principals[:20],
        "mailing_address": addr_match.group(1).replace("\n", ", ") if addr_match else None,
        "registered_agent": agent_match.group(1) if agent_match else None,
        "registered_agent_address": agent_match.group(2).replace("\n", ", ") if agent_match else None,
    }
