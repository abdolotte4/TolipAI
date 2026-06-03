"""Per-county distressed property scrapers.

Each county has its own module with a scraper class that:
1. Uses Playwright (via browser_context) for real browser interaction
2. Parses HTML tables with selectolax — NEVER with LLM
3. Returns validated DistressedListing dicts
4. Returns [] with a log message when blocked — never raises

Available scrapers:
    harris_tx      — Harris County, TX (tax foreclosure auctions)
    dallas_tx      — Dallas County, TX (trustee sales)
    miami_dade_fl  — Miami-Dade County, FL (RealForeclose — needs CAPTCHA_API_KEY)
    broward_fl     — Broward County, FL (RealForeclose — needs CAPTCHA_API_KEY)
    maricopa_az    — Maricopa County, AZ (tax lien sales)
    clark_nv       — Clark County, NV (trustee sales)
    orange_ca      — Orange County, CA (Notice of Default)
    los_angeles_ca — LA County, CA (tax deed auction)
    cook_il        — Cook County, IL (tax sales)
    fulton_ga      — Fulton County, GA (tax sales)
"""

from .harris_tx import HarrisCountyScraper
from .dallas_tx import DallasCountyScraper
from .miami_dade_fl import MiamiDadeScraper
from .broward_fl import BrowardScraper
from .maricopa_az import MaricopaScraper
from .clark_nv import ClarkCountyScraper
from .orange_ca import OrangeCountyScraper
from .los_angeles_ca import LosAngelesCountyScraper
from .cook_il import CookCountyScraper
from .fulton_ga import FultonCountyScraper

COUNTY_SCRAPERS = {
    "harris_tx": HarrisCountyScraper,
    "dallas_tx": DallasCountyScraper,
    "miami_dade_fl": MiamiDadeScraper,
    "broward_fl": BrowardScraper,
    "maricopa_az": MaricopaScraper,
    "clark_nv": ClarkCountyScraper,
    "orange_ca": OrangeCountyScraper,
    "los_angeles_ca": LosAngelesCountyScraper,
    "cook_il": CookCountyScraper,
    "fulton_ga": FultonCountyScraper,
}

__all__ = [
    "HarrisCountyScraper",
    "DallasCountyScraper",
    "MiamiDadeScraper",
    "BrowardScraper",
    "MaricopaScraper",
    "ClarkCountyScraper",
    "OrangeCountyScraper",
    "LosAngelesCountyScraper",
    "CookCountyScraper",
    "FultonCountyScraper",
    "COUNTY_SCRAPERS",
]
