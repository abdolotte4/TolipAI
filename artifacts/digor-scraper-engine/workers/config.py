"""Centralised env config + key rotation state for the scraper engine."""
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

    # ── Database ────────────────────────────────────────────────────────────
    database_url: Optional[str] = _env("DATABASE_URL")

    # ── LLM providers ───────────────────────────────────────────────────────
    groq_api_key: Optional[str] = _env("GROQ_API_KEY")
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = _env("GROQ_MODEL", "llama-3.3-70b-versatile") or "llama-3.3-70b-versatile"

    cerebras_api_key: Optional[str] = _env("CEREBRAS_API_KEY")
    cerebras_base_url: str = "https://api.cerebras.ai/v1"
    cerebras_model: str = _env("CEREBRAS_MODEL", "llama3.1-8b") or "llama3.1-8b"

    together_api_key: Optional[str] = _env("TOGETHER_API_KEY")
    together_base_url: str = "https://api.together.xyz/v1"
    together_model: str = _env("TOGETHER_MODEL", "meta-llama/Llama-3.3-70B-Instruct-Turbo") or ""

    nvidia_api_key: Optional[str] = _env("NVIDIA_API_KEY")
    nvidia_base_url: str = _env("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1") or ""
    nvidia_model: str = _env("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct") or ""

    openrouter_api_key: Optional[str] = _env("OPENROUTER_API_KEY")
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = _env("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free") or ""

    moonshot_api_key: Optional[str] = _env("MOONSHOT_KIMI_API_KEY")
    moonshot_base_url: str = _env("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1") or ""
    moonshot_model: str = _env("MOONSHOT_MODEL", "moonshot-v1-8k") or ""

    # ── Scraping providers ──────────────────────────────────────────────────
    scraperapi_keys: List[str] = field(default_factory=lambda: _env_list(
        "SCRAPERAPI_KEY", "SCRAPERAPI_KEY_2", "SCRAPERAPI_KEY_3", "SCRAPERAPI_KEY_4",
    ))
    scrapingbee_keys: List[str] = field(default_factory=lambda: _env_list(
        "SCRAPINGBEE_API_KEY", "SCRAPINGBEE_API_KEY_2",
        "SCRAPINGBEE_API_KEY_3", "SCRAPINGBEE_API_KEY_4",
    ))
    webscraper_key: Optional[str] = _env("WEBSCRAPER_API_KEY")

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

    # ── Property data ───────────────────────────────────────────────────────
    property_api_keys: List[str] = field(default_factory=lambda: _env_list(
        "PROPERTY_API_KEY", "PROPERTY_API_KEY_1", "PROPERTY_API_KEY_2",
        "PROPERTY_API_KEY_3", "PROPERTY_API_KEY_4", "PROPERTY_API_KEY_5",
        "PROPERTY_API_KEY_6", "PROPERTY_API_KEY_7",
    ))
    attom_keys: List[str] = field(default_factory=lambda: _env_list(
        "ATTOM_API_KEY", "ATTOM_API_KEY_2",
    ))

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
            return (
                f"http://{user}:{self.brightdata_password}"
                f"@{self.brightdata_host}:{self.brightdata_port}"
            )
        if self.oxylabs_user and self.oxylabs_pass:
            return f"http://{self.oxylabs_user}:{self.oxylabs_pass}@unblock.oxylabs.io:60000"
        return None

    def proxy_dict(self) -> Optional[dict]:
        """Return a {'server', 'username', 'password'} dict for Playwright / Crawl4AI."""
        if self.brightdata_configured():
            return {
                "server":   f"http://{self.brightdata_host}:{self.brightdata_port}",
                "username": self._brightdata_username_full(),
                "password": self.brightdata_password or "",
            }
        if self.oxylabs_user and self.oxylabs_pass:
            return {
                "server":   "http://unblock.oxylabs.io:60000",
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
                "server":   f"http://{self.brightdata_host}:{self.brightdata_port}",
                "username": user,
                "password": self.brightdata_password or "",
            }
        # Oxylabs doesn't have per-session pinning in the same way — use rotating
        return self.proxy_dict()

    def has_llm(self) -> bool:
        return bool(
            self.groq_api_key or self.cerebras_api_key or self.together_api_key
            or self.nvidia_api_key or self.openrouter_api_key or self.moonshot_api_key
        )

    def rotate_key(self, keys: List[str], counter: int) -> Optional[str]:
        """Round-robin key rotation helper."""
        if not keys:
            return None
        return keys[counter % len(keys)]


settings = Settings()
