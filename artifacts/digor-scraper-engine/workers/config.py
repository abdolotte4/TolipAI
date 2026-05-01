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

    # ── LLM: Groq (primary, free) → NVIDIA → Moonshot ───────────────────────
    groq_api_key: Optional[str] = _env("GROQ_API_KEY")
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = _env("GROQ_MODEL", "llama-3.3-70b-versatile") or "llama-3.3-70b-versatile"

    nvidia_api_key: Optional[str] = _env("NVIDIA_API_KEY")
    nvidia_base_url: str = _env("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1") or ""
    nvidia_model: str = _env("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct") or ""

    moonshot_api_key: Optional[str] = _env("MOONSHOT_KIMI_API_KEY")
    moonshot_base_url: str = _env("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1") or ""
    moonshot_model: str = _env("MOONSHOT_MODEL", "moonshot-v1-8k") or ""

    # ── Scraping providers (auto-CAPTCHA) ──────────────────────────────────
    scraperapi_keys: List[str] = field(default_factory=lambda: _env_list(
        "SCRAPERAPI_KEY", "SCRAPERAPI_KEY_2", "SCRAPERAPI_KEY_3", "SCRAPERAPI_KEY_4",
    ))
    scrapingbee_keys: List[str] = field(default_factory=lambda: _env_list(
        "SCRAPINGBEE_API_KEY", "SCRAPINGBEE_API_KEY_2",
        "SCRAPINGBEE_API_KEY_3", "SCRAPINGBEE_API_KEY_4",
    ))
    webscraper_key: Optional[str] = _env("WEBSCRAPER_API_KEY")

    # ── Residential proxy (for direct Playwright / Crawl4AI) ───────────────
    proxy_host: Optional[str] = _env("PROXY_HOST")
    proxy_user: Optional[str] = _env("PROXY_USER")
    proxy_pass: Optional[str] = _env("PROXY_PASS")
    oxylabs_user: Optional[str] = _env("OXYLABS_USERNAME")
    oxylabs_pass: Optional[str] = _env("OXYLABS_PASSWORD")
    brightdata_token: Optional[str] = _env("BRIGHTDATA_API")

    # ── Property data (already in api-server, useful here too) ─────────────
    property_api_keys: List[str] = field(default_factory=lambda: _env_list(
        "PROPERTY_API_KEY", "PROPERTY_API_KEY_1", "PROPERTY_API_KEY_2",
        "PROPERTY_API_KEY_3", "PROPERTY_API_KEY_4", "PROPERTY_API_KEY_5",
        "PROPERTY_API_KEY_6", "PROPERTY_API_KEY_7",
    ))
    attom_keys: List[str] = field(default_factory=lambda: _env_list(
        "ATTOM_API_KEY", "ATTOM_API_KEY_2",
    ))

    # ── Feature flags ──────────────────────────────────────────────────────
    # Disable Google dorks — burns ScrapingBee credits, requires custom_google=True
    enable_google_dorks: bool = os.getenv("ENABLE_GOOGLE_DORKS", "false").lower() == "true"
    # Disable dead / unreliable paid skip-trace sources
    enable_opencorporates: bool = os.getenv("ENABLE_OPENCORPORATES", "true").lower() == "true"
    enable_propertyapi: bool = os.getenv("ENABLE_PROPERTYAPI", "true").lower() == "true"

    # ── Tunables ───────────────────────────────────────────────────────────
    request_timeout: float = float(os.getenv("SCRAPER_TIMEOUT", "45"))
    job_concurrency: int = int(os.getenv("SCRAPER_JOB_CONCURRENCY", "4"))

    # ── Computed helpers ───────────────────────────────────────────────────
    def proxy_url(self) -> Optional[str]:
        """Return a generic residential proxy URL if configured."""
        if self.proxy_host and self.proxy_user and self.proxy_pass:
            return f"http://{self.proxy_user}:{self.proxy_pass}@{self.proxy_host}"
        if self.oxylabs_user and self.oxylabs_pass:
            return (
                f"http://{self.oxylabs_user}:{self.oxylabs_pass}"
                "@unblock.oxylabs.io:60000"
            )
        return None

    def has_llm(self) -> bool:
        return bool(self.groq_api_key or self.nvidia_api_key or self.moonshot_api_key)


settings = Settings()
