"""Centralised env config + key rotation state for the scraper engine.

LLM: OpenAI (OPENAI_API_KEY) — primary. Amazon Bedrock optional (USE_BEDROCK=1).
Scraping: BrightData / Oxylabs residential proxy + Propelio + Propwire.
Data: ATTOM API optional (ATTOM_API_KEY) for cash-buyer Tier-1 sales data.
Skip-trace: PropertyAPI (PROPERTY_API_KEY).
Dead providers removed: Groq, Cerebras, Together, NVIDIA, OpenRouter,
Moonshot, ScraperAPI, ScrapingBee.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(name)
    return val if val else default


def _env_list(*names: str) -> List[str]:
    """Collect env values for a set of names, dropping empties + duplicates."""
    out: List[str] = []
    for n in names:
        v = os.getenv(n)
        if v and v not in out:
            out.append(v)
    return out


@dataclass
class Settings:
    # ── Service ─────────────────────────────────────────────────────────────
    port: int = int(os.getenv("PORT", "8765"))
    log_level: str = _env("LOG_LEVEL", "info") or "info"
    # Required in production: all non-health endpoints enforce this key via
    # X-API-Key header (or Authorization: Bearer <key>).  Leave unset only in
    # local development where the engine is not internet-exposed.
    scraper_api_key: Optional[str] = _env("SCRAPER_API_KEY")

    # ── Database ────────────────────────────────────────────────────────────
    database_url: Optional[str] = _env("DATABASE_URL")

    # ── LLM — OpenAI only ──────────────────────────────────────────────────
    # All other providers (Groq, Cerebras, Together, NVIDIA, OpenRouter,
    # Moonshot) have been removed. The scraper engine uses only OpenAI.
    openai_api_key: Optional[str] = _env("OPENAI_API_KEY")
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = _env("OPENAI_MODEL", "gpt-4o-mini") or "gpt-4o-mini"

    # ─── Amazon Bedrock ─────────────────────────────────────────────────────
    use_bedrock: bool = os.getenv("USE_BEDROCK", "0") == "1"
    bedrock_region: str = _env("AWS_REGION", "us-east-1") or "us-east-1"
    bedrock_model_id: str = _env("BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0") or "anthropic.claude-3-sonnet-20240229-v1:0"

    # ── Residential proxy ───────────────────────────────────────────────────
    brightdata_username: Optional[str] = _env("BRIGHTDATA_USERNAME")
    brightdata_password: Optional[str] = _env("BRIGHTDATA_PASSWORD")
    # Zone name appended to username: brd-customer-XXXXXX-zone-<zone>
    # If BRIGHTDATA_USERNAME already contains "-zone-" leave this empty.
    brightdata_zone: Optional[str] = _env("BRIGHTDATA_ZONE")
    brightdata_host: str = _env("BRIGHTDATA_HOST", "brd.superproxy.io") or "brd.superproxy.io"
    # 22225 = residential  |  33335 = ISP/residential-fast  |  24000 = scraping browser
    # Default 33335 (ISP) — fastest for JS-heavy sites (Propelio/Propwire)
    brightdata_port: int = int(os.getenv("BRIGHTDATA_PORT", "33335"))
    oxylabs_user: Optional[str] = _env("OXYLABS_USERNAME")
    oxylabs_pass: Optional[str] = _env("OXYLABS_PASSWORD")

    # ── ATTOM API (optional) ────────────────────────────────────────────────
    # Used by cash_buyers.py as Tier-1 sales data source when keys are configured.
    # If no keys are set, pipeline falls back to county deeds then Zillow/Redfin.
    attom_keys: List[str] = field(
        default_factory=lambda: _env_list(
            "ATTOM_API_KEY",
            "ATTOM_API_KEY_1",
            "ATTOM_API_KEY_2",
        )
    )
    property_api_keys: List[str] = field(
        default_factory=lambda: _env_list(
            "PROPERTY_API_KEY",
            "PROPERTY_API_KEY_1",
            "PROPERTY_API_KEY_2",
            "PROPERTY_API_KEY_3",
            "PROPERTY_API_KEY_4",
            "PROPERTY_API_KEY_5",
            "PROPERTY_API_KEY_6",
            "PROPERTY_API_KEY_7",
        )
    )

    # ── Feature flags ──────────────────────────────────────────────────────
    enable_google_dorks: bool = os.getenv("ENABLE_GOOGLE_DORKS", "false").lower() == "true"
    enable_opencorporates: bool = os.getenv("ENABLE_OPENCORPORATES", "true").lower() == "true"
    enable_propertyapi: bool = os.getenv("ENABLE_PROPERTYAPI", "true").lower() == "true"

    # ── Tunables ───────────────────────────────────────────────────────────
    request_timeout: float = float(os.getenv("SCRAPER_TIMEOUT", "45"))
    job_concurrency: int = int(os.getenv("SCRAPER_JOB_CONCURRENCY", "4"))

    # ── Computed helpers ───────────────────────────────────────────────────
    def brightdata_configured(self) -> bool:
        return bool(self.brightdata_username and self.brightdata_password)

    def _brightdata_username_full(self) -> str:
        """Return the complete Bright Data username, appending zone if needed.

        Bright Data format: brd-customer-XXXXXX-zone-ZONE_NAME
        If BRIGHTDATA_USERNAME already contains '-zone-', use it as-is.
        If BRIGHTDATA_ZONE is set and the username doesn't have a zone suffix,
        append it automatically.
        """
        user = self.brightdata_username or ""
        if self.brightdata_zone and "-zone-" not in user:
            user = f"{user}-zone-{self.brightdata_zone}"
        return user

    def proxy_url(self) -> Optional[str]:
        """Return a residential proxy URL if configured."""
        if self.brightdata_configured():
            user = self._brightdata_username_full()
            return f"http://{user}:{self.brightdata_password}" f"@{self.brightdata_host}:{self.brightdata_port}"
        if self.oxylabs_user and self.oxylabs_pass:
            return f"http://{self.oxylabs_user}:{self.oxylabs_pass}@unblock.oxylabs.io:60000"
        return None

    def proxy_dict(self) -> Optional[dict]:
        """Return a {'server', 'username', 'password'} dict for Playwright / Crawl4AI."""
        if self.brightdata_configured():
            return {
                "server": f"http://{self.brightdata_host}:{self.brightdata_port}",
                "username": self._brightdata_username_full(),
                "password": self.brightdata_password or "",
            }
        if self.oxylabs_user and self.oxylabs_pass:
            return {
                "server": "http://unblock.oxylabs.io:60000",
                "username": self.oxylabs_user,
                "password": self.oxylabs_pass,
            }
        return None

    def proxy_dict_pinned(self, session_id: str) -> Optional[dict]:
        """Return a proxy dict with a stable Bright Data session pin.

        Bright Data session pinning: append -session-SESSION_ID to the username.
        The proxy gateway then routes all requests from that session through the
        same exit IP, which is critical for sites that correlate requests by IP
        (clerk portals, JS-heavy SPA login pages, Cloudflare challenge flows).

        session_id should be a short stable identifier like the service name
        ('propelio', 'propwire', 'county_FL_orange') so the same browser context
        always gets the same exit node.
        """
        if self.brightdata_configured():
            user = self._brightdata_username_full()
            # Only append if not already pinned
            if "-session-" not in user:
                # Sanitise: strip chars invalid in Bright Data session IDs
                safe_id = "".join(c if c.isalnum() or c == "_" else "_" for c in session_id)[:32]
                user = f"{user}-session-{safe_id}"
            return {
                "server": f"http://{self.brightdata_host}:{self.brightdata_port}",
                "username": user,
                "password": self.brightdata_password or "",
            }
        # Oxylabs doesn't have per-session pinning in the same way — use rotating
        return self.proxy_dict()

    def has_llm(self) -> bool:
        # OpenAI-only — all other providers removed
        return bool(self.openai_api_key)

    def rotate_key(self, keys: List[str], counter: int) -> Optional[str]:
        """Round-robin key rotation helper."""
        if not keys:
            return None
        return keys[counter % len(keys)]


settings = Settings()
