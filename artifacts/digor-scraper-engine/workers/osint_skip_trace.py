"""Free OSINT skip-trace for residential sellers.

Unlike skip_trace.py (which focuses on LLC / investor entity tracing via SOS,
OpenCorporates, SEC EDGAR), this module targets *individual homeowners* by
address — the core need for wholesaling lead gen.

Strategy (all free, no API keys required):
  1. TruePeopleSearch  — reverse address lookup (phones + emails)
  2. FastPeopleSearch  — reverse address lookup (phones)
  3. CyberBackgroundChecks — reverse address lookup (phones + emails)
  4. LLM extraction    — parse whatever HTML we get into structured contacts

DNC flagging:
  - If TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are in env, runs a Twilio
    Lookup on each number (carrier type).  Numbers flagged as VOIP may be
    DNC-adjacent.  Real DNC-list scrubbing requires a paid service
    (e.g. DNC.com, Telnyx).
  - Without Twilio: we mark all numbers as "unverified" and note DNC status
    is unknown.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from .http_client import fetch_html

log = logging.getLogger("osint_skip")

# ─── Public-records sites for reverse-address lookups ────────────────────────

_SITES = [
    {
        "name": "TruePeopleSearch",
        "url": "https://www.truepeoplesearch.com/resultaddress?streetaddress={street}&citystatezip={city}%2C+{state}",
        "render": True,
    },
    {
        "name": "FastPeopleSearch",
        "url": "https://www.fastpeoplesearch.com/address/{street}_{city}-{state}",
        "render": True,
    },
    {
        "name": "CyberBackgroundChecks",
        "url": "https://www.cyberbackgroundchecks.com/address/{street}/{city}/{state}",
        "render": False,
    },
]

# ─── Regex helpers ────────────────────────────────────────────────────────────

_PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_NAME_RE = re.compile(r"\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\b")


def _clean_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return digits


def _extract_contacts(html: str, source: str) -> Dict[str, Any]:
    """Parse HTML from a public-records site into contacts."""
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(" ", strip=True)

    phones = []
    seen_phones: set[str] = set()
    for m in _PHONE_RE.finditer(text):
        cleaned = _clean_phone(m.group())
        if cleaned not in seen_phones and len(re.sub(r"\D", "", cleaned)) >= 10:
            seen_phones.add(cleaned)
            phones.append({"number": cleaned, "source": source, "dnc_status": "unknown"})

    emails = []
    seen_emails: set[str] = set()
    for m in _EMAIL_RE.finditer(text):
        e = m.group().lower()
        if e not in seen_emails and not e.endswith((".png", ".jpg", ".gif", ".css", ".js")):
            seen_emails.add(e)
            emails.append({"email": e, "source": source})

    # Try to extract resident names from the page (capitalized word pairs)
    names: List[str] = []
    seen_names: set[str] = set()
    for m in _NAME_RE.finditer(text[:3000]):
        name = m.group()
        # Filter out obvious UI text
        if (
            len(name) > 5
            and name not in seen_names
            and not any(
                w in name
                for w in (
                    "Search",
                    "Result",
                    "People",
                    "Address",
                    "Phone",
                    "Email",
                    "Background",
                    "Check",
                    "United",
                    "States",
                    "Street",
                )
            )
        ):
            seen_names.add(name)
            names.append(name)

    return {
        "phones": phones,
        "emails": emails,
        "resident_names": names[:5],
        "source": source,
    }


async def _scrape_one_site(site: Dict[str, Any], street: str, city: str, state: str) -> Dict[str, Any]:
    """Fetch one public-records site and extract contacts."""
    url = (
        site["url"]
        .replace("{street}", street.replace(" ", "+"))
        .replace("{city}", city.replace(" ", "+"))
        .replace("{state}", state)
    )
    try:
        html = await fetch_html(url, render=site.get("render", False))
        contacts = _extract_contacts(html, site["name"])
        contacts["url"] = url
        return contacts
    except Exception as e:
        log.debug("OSINT site %s failed for %s: %s", site["name"], street, e)
        return {
            "phones": [],
            "emails": [],
            "resident_names": [],
            "source": site["name"],
            "error": str(e),
        }


def _merge_contacts(*results: Dict[str, Any]) -> Dict[str, Any]:
    """Merge contacts from multiple sites, de-duplicating by phone/email."""
    phones: List[Dict[str, Any]] = []
    emails: List[Dict[str, Any]] = []
    names: List[str] = []
    seen_p: set[str] = set()
    seen_e: set[str] = set()
    seen_n: set[str] = set()

    for r in results:
        for p in r.get("phones", []):
            if p["number"] not in seen_p:
                seen_p.add(p["number"])
                phones.append(p)
        for e in r.get("emails", []):
            if e["email"] not in seen_e:
                seen_e.add(e["email"])
                emails.append(e)
        for n in r.get("resident_names", []):
            if n not in seen_n:
                seen_n.add(n)
                names.append(n)

    return {"phones": phones[:6], "emails": emails[:4], "resident_names": names[:5]}


async def _twilio_dnc_check(phones: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Use Twilio Lookup to flag VOIP numbers (DNC-adjacent) if configured."""
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    if not account_sid or not auth_token:
        return phones

    import httpx as _httpx

    updated = []
    for p in phones:
        number = p["number"]
        try:
            async with _httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    f"https://lookups.twilio.com/v1/PhoneNumbers/{number}",
                    params={"Type": "carrier"},
                    auth=(account_sid, auth_token),
                )
            if r.status_code == 200:
                data = r.json()
                carrier = data.get("carrier") or {}
                line_type = carrier.get("type", "unknown")
                p = {
                    **p,
                    "line_type": line_type,
                    "dnc_status": "flagged" if line_type == "voip" else "clear",
                }
        except Exception as e:
            log.debug("Twilio Lookup failed for %s: %s", number, e)
        updated.append(p)
    return updated


async def trace_by_address(
    street: str,
    city: str,
    state: str,
    *,
    owner_name: Optional[str] = None,
    do_dnc_check: bool = True,
) -> Dict[str, Any]:
    """
    Main entry point — reverse-address OSINT skip trace.

    Returns:
        {
            "street": "...",
            "city": "...",
            "state": "...",
            "owner_name": "...",      # from listing data if available
            "phones": [{"number": "+1...", "source": "...", "dnc_status": "...", "line_type": "..."}],
            "emails": [{"email": "...", "source": "..."}],
            "resident_names": ["..."],
            "verified_mobile_count": int,
            "verified_email_count": int,
        }
    """
    log.info("OSINT skip trace: %s, %s, %s", street, city, state)

    # Scrape all 3 sites concurrently
    tasks = [_scrape_one_site(site, street, city, state) for site in _SITES]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    valid = [r for r in results if isinstance(r, dict)]
    merged = _merge_contacts(*valid)

    phones = merged["phones"]
    if do_dnc_check and phones:
        phones = await _twilio_dnc_check(phones)

    mobile_count = sum(
        1 for p in phones if p.get("line_type") in ("mobile", None, "unknown") and p.get("dnc_status") != "flagged"
    )
    email_count = len(merged["emails"])

    # Prefer owner_name from listing; fall back to first resident name found
    resolved_owner = owner_name or (merged["resident_names"][0] if merged["resident_names"] else None)

    return {
        "street": street,
        "city": city,
        "state": state,
        "owner_name": resolved_owner,
        "phones": phones,
        "emails": merged["emails"],
        "resident_names": merged["resident_names"],
        "verified_mobile_count": mobile_count,
        "verified_email_count": email_count,
    }


def format_markdown_table(leads: List[Dict[str, Any]]) -> str:
    """Render the chained lead-gen results as a Markdown table."""
    lines = [
        "| # | Address | Owner | Est. Equity | Phone(s) | Email(s) | DNC Flag |",
        "|---|---------|-------|-------------|----------|----------|----------|",
    ]
    for i, lead in enumerate(leads, 1):
        addr = lead.get("address") or f"{lead.get('street','')}, {lead.get('city','')}"
        owner = lead.get("owner_name") or "—"
        equity = f"${lead.get('estimated_equity', 0):,.0f}" if lead.get("estimated_equity") else "—"
        phones = "; ".join(p["number"] for p in lead.get("phones", [])[:2]) or "—"
        emails = "; ".join(e["email"] for e in lead.get("emails", [])[:2]) or "—"
        dnc_flag = "⚠️ Yes" if any(p.get("dnc_status") == "flagged" for p in lead.get("phones", [])) else "No"
        lines.append(f"| {i} | {addr} | {owner} | {equity} | {phones} | {emails} | {dnc_flag} |")
    return "\n".join(lines)
