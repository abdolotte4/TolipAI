# Replit AI Agent — Fix Guide: TolipAI Python-Worker
**Objective:** Remove all fantasy/hallucinated code and replace with real, working scrapers.
**Constraint:** No paid LLM APIs (OpenAI credits exhausted). Use free/local alternatives where possible.
**Target:** 10 high-value county sources with verified, tested scrapers.

**Current Status (Updated 2026-06-03):** This guide was originally written as a prescriptive fix plan. As of the latest codebase review against the 12 uploaded Python files, **most phases remain unimplemented**. This updated guide adds implementation status markers (✅ Done / ⚠️ Partial / ❌ Not started) to each phase and provides a corrected critical path.

---

## Implementation Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Pre-flight (deps, installs) | ❌ Not started |
| 1.1 | Remove LLM extraction from llm.py | ❌ Not started |
| 1.2 | Replace AI URL discovery with hardcoded registry | ⚠️ Partial (file not in upload) |
| 1.3 | Remove people-search scrapers | ⚠️ Partial (osint_skip_trace still used) |
| 1.4 | Delete LLM-based cash buyer discovery | ⚠️ Partial (Propelio/Propwire exist, generic still called) |
| 2.1 | Create counties/ directory | ❌ Not started |
| 2.2 | Create counties/base.py | ❌ Not started |
| 2.3 | Harris County scraper | ❌ Not started |
| 2.4 | Miami-Dade scraper | ❌ Not started |
| 3 | CAPTCHA solver | ❌ Not started |
| 4.1 | playwright-extra-stealth | ❌ Not started |
| 4.2 | Fix proxy strategy | ❌ Not started |
| 5.1 | Pydantic models.py | ❌ Not started |
| 5.2 | DB validation layer | ❌ Not started |
| 6 | County-specific dispatch in main.py | ❌ Not started |
| 7 | camelot-py for PDFs | ⚠️ Partial (OCR exists, camelot missing) |
| 8 | Tests | ❌ Not started |
| 9 | Structured logging | ❌ Not started |
| 10 | SOURCES.md | ❌ Not started |



---

## Phase 0: Pre-Flight Checklist

Before writing any scraper code, do these in order:

1. **Install dependencies** (add to requirements.txt):
```
playwright-extra>=0.4.0
playwright-stealth>=0.0.1
selectolax>=0.3.21
camelot-py[cv]>=0.11.0
pytesseract>=0.3.10
pdf2image>=1.16.3
Pillow>=10.0.0
pydantic>=2.5.0
python-dateutil>=2.8.0
```

2. **Install Playwright browsers with stealth support:**
```bash
pip install playwright-extra playwright-stealth
playwright install chromium
```

3. **Install Tesseract OCR** (for scanned PDFs):
```bash
# In Replit Nix or Dockerfile
apt-get update && apt-get install -y tesseract-ocr tesseract-ocr-eng poppler-utils
```

4. **Verify no LLM API calls remain** (grep check):
```bash
grep -r "openai|moonshot|sk-|parse_distressed_page|discover_deed_source" workers/
# Should return ZERO results after Phase 1
```

---

## Phase 1: Kill All Fantasy Code (Do This First)

### 1.1 Delete parse_distressed_page() in workers/llm.py

**Action:** Remove the entire function. Keep _chat() helper ONLY for non-extraction tasks (e.g., classifying a buyer as "flipper" vs "landlord" AFTER data is already extracted).

**Code to delete:**
```python
# DELETE THIS ENTIRE FUNCTION from workers/llm.py
async def parse_distressed_page(text: str, *, source: str) -> List[Dict[str, Any]]:
    sys = (
        "You extract distressed real-estate listings from scraped text..."
    )
    raw = await _chat(...)
    ...
```

**Replace with:**
```python
# workers/llm.py — keep only classification helpers
async def classify_buyer_type(buyer_data: dict) -> str:
    """Classify an already-extracted buyer as flipper/landlord/hold."""
    # Only use LLM for classification, NEVER for extraction
    ...
```

---

### 1.2 Delete AI URL Discovery in workers/scrapers/county_deeds.py

**Action:** Remove discover_deed_source() and any LLM-based URL guessing.

**Replace with:**
```python
# workers/scrapers/county_deeds.py
DEED_REGISTRY: Dict[str, Dict] = {
    # ONLY verified, manually tested URLs
    "harris_tx": {
        "url": "https://www.hctax.net/Property/PropertyTaxForeclosureSales",
        "type": "public_list",  # no login needed
        "parser": "harris_county_table",
        "notes": "Monthly auction list, HTML table",
    },
    "dallas_tx": {
        "url": "https://www.dallascounty.org/departments/tax/foreclosures.php",
        "type": "public_list",
        "parser": "dallas_county_table",
    },
    "miami_dade_fl": {
        "url": "https://www.realforeclose.com/index.cfm?zaction=auction&zmethod=host&zhost=2",
        "type": "login_required",
        "parser": "realforeclose_table",
        "notes": "Requires login + CAPTCHA",
    },
    # ... add 7 more verified sources
}

async def get_deed_source(county: str, state: str) -> Optional[Dict]:
    """Return verified source config or None."""
    key = f"{county.lower().replace(' ', '_')}_{state.lower()}"
    return DEED_REGISTRY.get(key)
```

**Rule:** If a URL is not in this hardcoded registry, return None and log "Source not implemented: {key}". NEVER guess URLs.

---

### 1.3 Delete People-Search Scrapers in workers/skip_trace.py

**Action:** Remove ALL scrapers for:
- FastPeopleSearch
- CyberBackgroundChecks
- ClustrMaps
- NeighborWho
- Google dorking (fetch_html("https://www.google.com/search?q=..."))

**Replace with:**
```python
# workers/skip_trace.py
SKIP_TRACE_APIS = {
    "batch": {"url": "https://api.batchskiptracing.com/", "requires_key": True},
    "tlo": {"url": "https://www.tlo.com/", "requires_key": True},
}

async def skip_trace_owner(owner_name: str, address: str, api_key: str, provider: str = "batch") -> Optional[Dict]:
    """Skip trace via licensed API only."""
    if provider == "batch":
        return await _batch_skip_trace(owner_name, address, api_key)
    raise ValueError(f"Skip-trace provider '{provider}' not implemented or requires paid API key")
```

**Add to README:**
```markdown
## Skip Tracing
Skip tracing requires a paid API key (BatchSkipTracing, TLO, or LexisNexis).
The project does NOT include people-search scrapers due to:
1. Aggressive bot blocking
2. Terms of Service violations
3. Legal liability (FCRA, GLBA)
Set BATCH_SKIP_TRACING_API_KEY in your environment to enable.
```

---

### 1.4 Delete LLM-Based Cash Buyer Discovery

**Action:** In workers/scrapers/cash_buyers.py, remove:
- find_cash_buyers() that searches Zillow/Redfin
- extract_investor_profile() that uses LLM
- score_buyer_match() that uses LLM

**Replace with:**
```python
# workers/scrapers/cash_buyers.py
from typing import List, Dict, Optional
from workers.scrapers._browser_session import browser_context

async def scrape_cash_buyers_propelio(username: str, password: str) -> List[Dict]:
    """Scrape cash buyer list from authenticated Propelio account."""
    async with browser_context("propelio", login_fn=_propelio_login) as ctx:
        page = await ctx.new_page()
        await page.goto("https://app.propelio.com/#/cash-buyers")
        # Wait for Angular/React table to load
        await page.wait_for_selector("table.buyer-list", timeout=30000)
        rows = await page.query_selector_all("table.buyer-list tbody tr")
        buyers = []
        for row in rows:
            cells = await row.query_selector_all("td")
            if len(cells) >= 4:
                buyers.append({
                    "name": await cells[0].inner_text(),
                    "address": await cells[1].inner_text(),
                    "phone": await cells[2].inner_text(),
                    "email": await cells[3].inner_text(),
                    "deal_count": await cells[4].inner_text() if len(cells) > 4 else None,
                    "source": "propelio",
                })
        return buyers

async def scrape_cash_buyers_propwire(username: str, password: str) -> List[Dict]:
    """Scrape cash buyer list from authenticated Propwire account."""
    async with browser_context("propwire", login_fn=_propwire_login) as ctx:
        page = await ctx.new_page()
        await page.goto("https://app.propwire.com/cash-buyers")
        ...
```

**Rule:** Cash buyers come ONLY from authenticated Propelio/Propwire accounts OR from county deed analysis (LLC buyers, frequent buyers). Never from Zillow "For Sale" listings.

---

## Phase 2: Build Real County Scrapers (10 Sources)

### 2.1 Create workers/scrapers/counties/ directory

```
workers/scrapers/counties/
├── __init__.py
├── base.py              # Shared helpers for county scrapers
├── harris_tx.py         # Harris County, TX
├── dallas_tx.py         # Dallas County, TX
├── miami_dade_fl.py     # Miami-Dade, FL (RealForeclose)
├── broward_fl.py        # Broward, FL (RealForeclose)
├── maricopa_az.py       # Maricopa County, AZ
├── clark_nv.py          # Clark County, NV
├── orange_ca.py         # Orange County, CA
├── los_angeles_ca.py    # LA County, CA
├── cook_il.py           # Cook County, IL
└── fulton_ga.py         # Fulton County, GA
```

---

### 2.2 Create workers/scrapers/counties/base.py

```python
# workers/scrapers/counties/base.py
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import logging
from selectolax.parser import HTMLParser
from workers.scrapers._browser_session import browser_context, _nav_with_fallback

log = logging.getLogger("county_scraper")

class CountyScraper(ABC):
    """Base class for all county scrapers."""

    county: str = ""
    state: str = ""
    source_url: str = ""
    requires_login: bool = False
    requires_captcha: bool = False

    @abstractmethod
    async def scrape(self, days_back: int = 30) -> List[Dict]:
        """Return structured listings. Must be implemented by each county."""
        pass

    def parse_table(self, html: str, selector: str) -> List[Dict]:
        """Extract rows from HTML table using selectolax."""
        tree = HTMLParser(html)
        table = tree.css_first(selector)
        if not table:
            log.warning(f"[{self.county}] Table not found with selector: {selector}")
            return []

        rows = []
        headers = [th.text(strip=True).lower() for th in table.css("thead th")]
        for tr in table.css("tbody tr"):
            cells = [td.text(strip=True) for td in tr.css("td")]
            if len(cells) != len(headers):
                continue
            row = dict(zip(headers, cells))
            rows.append(row)
        return rows

    def validate_listing(self, listing: Dict) -> bool:
        """Ensure required fields are present."""
        required = ["address", "county", "state"]
        for field in required:
            if not listing.get(field):
                log.warning(f"[{self.county}] Missing required field: {field}")
                return False
        return True
```

---

### 2.3 Example: Harris County, TX (harris_tx.py)

```python
# workers/scrapers/counties/harris_tx.py
from datetime import datetime, timedelta
from typing import List, Dict
from workers.scrapers.counties.base import CountyScraper
from workers.scrapers._browser_session import browser_context
import logging

log = logging.getLogger("harris_tx")

class HarrisCountyScraper(CountyScraper):
    county = "Harris"
    state = "TX"
    source_url = "https://www.hctax.net/Property/PropertyTaxForeclosureSales"
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 30) -> List[Dict]:
        listings = []
        cutoff = datetime.now() - timedelta(days=days_back)

        async with browser_context("harris_tx", headless=True) as ctx:
            page = await ctx.new_page()

            # Navigate with fallback strategies
            await _nav_with_fallback(page, self.source_url, log, "harris_tx")

            # Wait for the auction table to load
            await page.wait_for_selector("table#auctionList", timeout=15000)

            # Extract HTML and parse with selectolax
            html = await page.content()
            raw_rows = self.parse_table(html, "table#auctionList")

            for row in raw_rows:
                try:
                    sale_date = datetime.strptime(row.get("sale date", ""), "%m/%d/%Y")
                    if sale_date < cutoff:
                        continue

                    listing = {
                        "address": row.get("property address", ""),
                        "city": row.get("city", ""),
                        "state": "TX",
                        "zip": row.get("zip", ""),
                        "county": "Harris",
                        "case_number": row.get("cause number", ""),
                        "sale_date": sale_date.isoformat(),
                        "sale_type": "tax_foreclosure",
                        "lien_amount": self._parse_money(row.get("minimum bid", "")),
                        "source_url": self.source_url,
                        "scraped_at": datetime.utcnow().isoformat(),
                    }

                    if self.validate_listing(listing):
                        listings.append(listing)

                except Exception as e:
                    log.warning(f"[Harris] Failed to parse row: {e}")
                    continue

            log.info(f"[Harris] Scraped {len(listings)} listings")
            return listings

    def _parse_money(self, val: str) -> Optional[float]:
        if not val:
            return None
        try:
            return float(val.replace("$", "").replace(",", "").strip())
        except ValueError:
            return None
```

---

### 2.4 Example: Miami-Dade, FL — RealForeclose (miami_dade_fl.py)

```python
# workers/scrapers/counties/miami_dade_fl.py
from datetime import datetime, timedelta
from typing import List, Dict
from workers.scrapers.counties.base import CountyScraper
from workers.scrapers._browser_session import browser_context
import logging

log = logging.getLogger("miami_dade_fl")

class MiamiDadeScraper(CountyScraper):
    county = "Miami-Dade"
    state = "FL"
    source_url = "https://www.realforeclose.com/index.cfm?zaction=auction&zmethod=host&zhost=2"
    requires_login = True
    requires_captcha = True  # reCAPTCHA v2 on login

    async def scrape(self, days_back: int = 30) -> List[Dict]:
        listings = []
        cutoff = datetime.now() - timedelta(days=days_back)

        async with browser_context(
            "miami_dade_fl",
            login_fn=self._realforeclose_login,
            headless=True,
        ) as ctx:
            page = await ctx.new_page()

            # After login, navigate to auction list
            await _nav_with_fallback(page, self.source_url, log, "miami_dade_fl")

            # RealForeclose uses a dynamic table — wait for it
            await page.wait_for_selector("table#auctionTable", timeout=20000)

            # Handle pagination
            while True:
                html = await page.content()
                rows = self.parse_table(html, "table#auctionTable")

                for row in rows:
                    # Parse and validate...
                    pass

                # Check for next page
                next_btn = await page.query_selector("a.next-page")
                if not next_btn or not await next_btn.is_visible():
                    break
                await next_btn.click()
                await page.wait_for_timeout(2000)

            return listings

    async def _realforeclose_login(self, page):
        """Login to RealForeclose. CAPTCHA solving required."""
        await page.goto("https://www.realforeclose.com/login")
        await page.fill("input#username", "YOUR_USERNAME")
        await page.fill("input#password", "YOUR_PASSWORD")

        # CAPTCHA solving integration
        captcha_frame = await page.query_selector("iframe[title*='reCAPTCHA']")
        if captcha_frame:
            log.info("[Miami-Dade] CAPTCHA detected — solving...")
            site_key = await captcha_frame.get_attribute("src")
            # Extract sitekey and send to 2Captcha
            # await solve_recaptcha(page, site_key)
            raise NotImplementedError("CAPTCHA solving not yet integrated")

        await page.click("button#loginBtn")
        await page.wait_for_url("**/dashboard**", timeout=15000)
```

---

## Phase 3: Add CAPTCHA Solving

### 3.1 Create workers/captcha_solver.py

```python
# workers/captcha_solver.py
import os
import logging
from typing import Optional
import requests

log = logging.getLogger("captcha")

class CaptchaSolver:
    def __init__(self, provider: str = "2captcha"):
        self.provider = provider
        self.api_key = os.getenv("CAPTCHA_API_KEY")
        if not self.api_key:
            log.warning("No CAPTCHA_API_KEY set — CAPTCHA solving disabled")

    async def solve_recaptcha_v2(self, site_key: str, page_url: str) -> Optional[str]:
        """Solve reCAPTCHA v2 via 2Captcha. Returns g-recaptcha-response token."""
        if not self.api_key:
            return None

        # Submit CAPTCHA to 2Captcha
        resp = requests.post("http://2captcha.com/in.php", data={
            "key": self.api_key,
            "method": "userrecaptcha",
            "googlekey": site_key,
            "pageurl": page_url,
            "json": 1,
        })
        result = resp.json()
        if result.get("status") != 1:
            log.error(f"CAPTCHA submit failed: {result}")
            return None

        captcha_id = result["request"]

        # Poll for result (max 120 seconds)
        for _ in range(24):
            await asyncio.sleep(5)
            resp = requests.get(f"http://2captcha.com/res.php?key={self.api_key}&action=get&id={captcha_id}&json=1")
            result = resp.json()
            if result.get("status") == 1:
                return result["request"]

        log.error("CAPTCHA solving timed out")
        return None

    async def solve_hcaptcha(self, site_key: str, page_url: str) -> Optional[str]:
        """Solve hCaptcha via 2Captcha."""
        if not self.api_key:
            return None
        resp = requests.post("http://2captcha.com/in.php", data={
            "key": self.api_key,
            "method": "hcaptcha",
            "sitekey": site_key,
            "pageurl": page_url,
            "json": 1,
        })
        ...
```

**Environment variable:**
```bash
CAPTCHA_API_KEY=your_2captcha_key_here
```

**Cost:** ~$2-3 per 1,000 reCAPTCHA v2 solves. Budget $50-100/month for 10 counties.

---

## Phase 4: Replace Stealth with Playwright-Extra

### 4.1 Update workers/scrapers/_browser_session.py

**Replace the hand-rolled _STEALTH_SCRIPT and _apply_stealth() with:**

```python
# workers/scrapers/_browser_session.py
from playwright_extra import PlaywrightExtra
from playwright_extra.stealth import stealth_async
from playwright_extra.recaptcha import recaptcha_async

async def browser_context(
    service: str,
    *,
    login_fn: Optional[Callable] = None,
    headless: bool = True,
    user_agent: Optional[str] = None,
) -> AsyncIterator[Any]:
    ...
    pw = PlaywrightExtra()

    browser = await pw.chromium.launch(
        headless=headless,
        executable_path=_exec_path,
        proxy=proxy_cfg,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--no-zygote",
            "--disable-gpu",
            "--disable-software-rasterizer",
        ],
    )

    try:
        ctx = await browser.new_context(
            storage_state=storage_state,
            user_agent=user_agent or DEFAULT_UA,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
            geolocation={"latitude": 32.7767, "longitude": -96.7970},
            permissions=["geolocation"],
            ignore_https_errors=True,
        )

        # Apply playwright-extra-stealth (covers 50+ fingerprint vectors)
        await stealth_async(ctx)

        # Apply recaptcha plugin
        await recaptcha_async(ctx)

        ...
```

**Why this is better:**
- playwright-extra-stealth is actively maintained (covers navigator.userAgentData, Function.prototype.toString, CDP evasion, etc.)
- playwright-extra-recaptcha automatically detects and solves reCAPTCHA if API key is configured
- No more hand-rolled JavaScript that breaks on site updates

---

## Phase 5: Schema Validation & DB Layer

### 5.1 Create workers/models.py

```python
# workers/models.py
from datetime import date, datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field, HttpUrl, validator

class DistressedListing(BaseModel):
    address: str = Field(..., min_length=5, description="Street address")
    city: str = Field(..., min_length=2)
    state: str = Field(..., min_length=2, max_length=2)
    zip: str = Field(..., regex=r"^\d{5}(-\d{4})?$")
    county: str = Field(..., min_length=2)

    case_number: Optional[str] = None
    sale_date: Optional[date] = None
    sale_type: Literal["foreclosure", "tax_lien", "trustee_sale", "probate", "tax_foreclosure"] = Field(...)
    lien_amount: Optional[float] = Field(None, ge=0)
    estimated_value: Optional[float] = Field(None, ge=0)
    property_type: Optional[str] = None

    source_url: HttpUrl
    scraped_at: datetime = Field(default_factory=datetime.utcnow)

    @validator("state")
    def state_uppercase(cls, v):
        return v.upper()

    @validator("address")
    def address_not_po_box(cls, v):
        if "p.o. box" in v.lower() or "po box" in v.lower():
            raise ValueError("PO Box addresses not allowed for property listings")
        return v

class CashBuyer(BaseModel):
    name: str = Field(..., min_length=2)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = Field(None, max_length=2)
    zip: Optional[str] = None
    phone: Optional[str] = Field(None, regex=r"^\d{10}$")
    email: Optional[str] = None
    deal_count: Optional[int] = Field(None, ge=0)
    avg_deal: Optional[float] = Field(None, ge=0)
    buyer_type: Optional[Literal["flipper", "landlord", "wholesaler", "developer"]] = None
    source: str = Field(..., description="propelio, propwire, or county_deeds")
    scraped_at: datetime = Field(default_factory=datetime.utcnow)
```

---

### 5.2 Update workers/db.py to validate before save

```python
# workers/db.py
from workers.models import DistressedListing, CashBuyer
from typing import List, Dict

async def save_listings(job_id: str, listings: List[Dict]) -> Dict:
    """Validate and save listings. Returns summary."""
    valid = []
    invalid = []

    for raw in listings:
        try:
            listing = DistressedListing(**raw)
            valid.append(listing.dict())
        except Exception as e:
            invalid.append({"raw": raw, "error": str(e)})

    if not valid:
        return {
            "job_id": job_id,
            "status": "completed_no_results",
            "valid_count": 0,
            "invalid_count": len(invalid),
            "errors": invalid[:10],  # first 10 errors
        }

    # Save valid listings to DB
    async with async_session() as session:
        ...

    return {
        "job_id": job_id,
        "status": "completed",
        "valid_count": len(valid),
        "invalid_count": len(invalid),
        "errors": invalid[:10],
    }
```

---

## Phase 6: Fix workers/main.py Job Runner

### 6.1 Replace generic pipeline with county-specific dispatch

```python
# workers/main.py
from workers.scrapers.counties import (
    HarrisCountyScraper,
    DallasCountyScraper,
    MiamiDadeScraper,
    # ... import others
)

COUNTY_SCRAPERS = {
    "harris_tx": HarrisCountyScraper,
    "dallas_tx": DallasCountyScraper,
    "miami_dade_fl": MiamiDadeScraper,
    # ... map 10 counties
}

async def run_distressed_job(job_id: str, payload: Dict) -> None:
    county_key = payload.get("county_key")
    days_back = payload.get("days_back", 30)

    if county_key not in COUNTY_SCRAPERS:
        await _update_job_status(job_id, "failed", error=f"County '{county_key}' not implemented")
        return

    scraper = COUNTY_SCRAPERS[county_key]()

    try:
        listings = await scraper.scrape(days_back=days_back)
        result = await save_listings(job_id, listings)
        await _update_job_status(job_id, result["status"], metadata=result)
    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}")
        await _update_job_status(job_id, "failed", error=str(e))
```

**API endpoint:**
```python
@app.post("/scrape/distressed")
async def scrape_distressed(payload: DistressedRequest):
    # payload.county_key = "harris_tx"
    # payload.days_back = 30
    job_id = await _create_job("distressed", payload.dict())
    asyncio.create_task(run_distressed_job(job_id, payload.dict()))
    return {"job_id": job_id, "status": "queued", "message": f"Scraping {payload.county_key}"}
```

---

## Phase 7: Add OCR for Scanned PDFs

### 7.1 Update workers/pdf_parser.py

```python
# workers/pdf_parser.py
import pytesseract
from pdf2image import convert_from_path
from PIL import Image
import camelot
import logging

log = logging.getLogger("pdf_parser")

async def parse_pdf_tables(pdf_path: str) -> List[Dict]:
    """Extract tables from PDF. Falls back to OCR if no text tables found."""

    # Try camelot first (for text-based PDFs with tables)
    try:
        tables = camelot.read_pdf(pdf_path, pages="all")
        if tables and len(tables) > 0:
            results = []
            for table in tables:
                df = table.df
                records = df.to_dict("records")
                results.extend(records)
            if results:
                log.info(f"[PDF] Extracted {len(results)} rows via camelot")
                return results
    except Exception as e:
        log.warning(f"[PDF] Camelot failed: {e}")

    # Fallback: OCR for scanned/image PDFs
    log.info("[PDF] No text tables found — attempting OCR...")
    images = convert_from_path(pdf_path, dpi=300)

    all_text = []
    for i, image in enumerate(images):
        text = pytesseract.image_to_string(image)
        all_text.append(text)
        log.debug(f"[PDF] OCR page {i+1}: {len(text)} chars")

    # TODO: Parse OCR text into structured data
    # This is hard — may require regex or even LLM (but only for OCR text, not HTML)
    return [{"raw_text": "\n".join(all_text), "source": "ocr"}]
```

---

## Phase 8: Testing Requirements

### 8.1 Create tests/test_counties.py

```python
# tests/test_counties.py
import pytest
from workers.scrapers.counties.harris_tx import HarrisCountyScraper
from workers.scrapers.counties.miami_dade_fl import MiamiDadeScraper

@pytest.mark.asyncio
async def test_harris_county_scraper():
    scraper = HarrisCountyScraper()
    listings = await scraper.scrape(days_back=30)

    assert isinstance(listings, list)
    if len(listings) > 0:
        first = listings[0]
        assert "address" in first
        assert "sale_date" in first
        assert "sale_type" in first
        assert first["state"] == "TX"
        assert first["county"] == "Harris"
        # Verify sale_type is valid
        assert first["sale_type"] in ["tax_foreclosure", "trustee_sale", "foreclosure"]
    else:
        pytest.skip("No listings found in date range (site may have changed)")

@pytest.mark.asyncio
async def test_miami_dade_scraper_requires_captcha():
    scraper = MiamiDadeScraper()
    # This should fail gracefully if CAPTCHA key not set
    with pytest.raises(NotImplementedError):
        await scraper.scrape(days_back=30)
```

### 8.2 Create tests/test_schema.py

```python
# tests/test_schema.py
from workers.models import DistressedListing
import pytest
from datetime import date

def test_valid_listing():
    listing = DistressedListing(
        address="123 Main St",
        city="Houston",
        state="tx",  # should auto-uppercase
        zip="77001",
        county="Harris",
        sale_type="tax_foreclosure",
        source_url="https://example.com",
    )
    assert listing.state == "TX"

def test_invalid_po_box():
    with pytest.raises(ValueError):
        DistressedListing(
            address="P.O. Box 123",
            city="Houston",
            state="TX",
            zip="77001",
            county="Harris",
            sale_type="tax_foreclosure",
            source_url="https://example.com",
        )

def test_invalid_zip():
    with pytest.raises(ValueError):
        DistressedListing(
            address="123 Main St",
            city="Houston",
            state="TX",
            zip="abc",  # invalid
            county="Harris",
            sale_type="tax_foreclosure",
            source_url="https://example.com",
        )
```

---

## Phase 9: Logging & Monitoring

### 9.1 Structured logging format

Replace all generic logger.error() calls with structured events:

```python
# workers/scrapers/counties/base.py
import structlog

log = structlog.get_logger("county_scraper")

# In scraper:
log.info(
    "scraper_attempt",
    county=self.county,
    state=self.state,
    url=self.source_url,
    proxy_used=proxy,
)

log.info(
    "scraper_block",
    county=self.county,
    block_type="cloudflare_challenge",  # captcha | rate_limit | bot_detected | timeout
    screenshot_path="/tmp/...",
    html_length=0,
)

log.info(
    "scraper_success",
    county=self.county,
    listings_found=len(listings),
    fields_present=["address", "sale_date", "lien_amount"],
    validation_errors=0,
)

log.info(
    "scraper_empty",
    county=self.county,
    reason="no_listings_in_range",  # | parse_failure | site_changed
    html_length=len(html),
)
```

---

## Phase 10: Documentation

### 10.1 Create SOURCES.md

```markdown
# Data Sources — Implementation Status

## Implemented (Tested)
| County | State | Source | Type | Status | Notes |
|--------|-------|--------|------|--------|-------|
| Harris | TX | hctax.net | Public List | Working | Monthly auction table, no login |
| Dallas | TX | dallascounty.org | Public List | In Progress | HTML table, verify selector |
| Miami-Dade | FL | realforeclose.com | Login + CAPTCHA | Blocked | Needs 2Captcha + credentials |

## Not Implemented
| County | State | Reason |
|--------|-------|--------|
| All others | — | Requires custom Playwright script per county |

## Paid APIs Required
| Data Type | Provider | Cost |
|-----------|----------|------|
| Skip tracing | BatchSkipTracing | $0.15/record |
| Cash buyers (national) | PropStream | $97/month |
| Title/lien data | DataTree | $500+/month |
```

---

## Final Checklist for Replit AI Agent

Before marking the task complete, verify:

- [ ] grep -r "parse_distressed_page" workers/ returns nothing
- [ ] grep -r "discover_deed_source" workers/ returns nothing
- [ ] grep -r "FastPeopleSearch|CyberBackgroundChecks|ClustrMaps" workers/ returns nothing
- [ ] grep -r "openai|moonshot|sk-" workers/ returns nothing (except config/comments)
- [ ] workers/scrapers/counties/ has 10 scraper files
- [ ] Each county scraper has a scrape() method returning List[Dict]
- [ ] Each county scraper uses selectolax or Playwright locators (NOT .get_text() + LLM)
- [ ] workers/models.py has Pydantic models with validation
- [ ] workers/db.py validates with Pydantic before saving
- [ ] workers/captcha_solver.py exists and handles reCAPTCHA + hCaptcha
- [ ] playwright-extra and playwright-stealth are in requirements.txt
- [ ] tests/test_counties.py has tests for all 10 counties
- [ ] tests/test_schema.py validates Pydantic models
- [ ] SOURCES.md documents all sources with realistic status
- [ ] README.md explains that skip-tracing requires paid API keys
- [ ] Jobs with zero results return "completed_no_results" with reason, not "completed"

---

## Budget Reality Check

| Item | Monthly Cost | Required? |
|------|------------|-----------|
| 2Captcha API | $50-100 | Yes (for RealForeclose, county logins) |
| Residential proxies (Bright Data) | $100-300 | Yes (for government sites) |
| Propelio/Propwire subscription | $97-197 | Yes (for cash buyer data) |
| BatchSkipTracing API | $50-200 | Optional (skip tracing only) |
| PropStream API | $97 | Optional (alternative cash buyer source) |
| **Total** | **$300-700** | **Minimum to get real results** |

**Without these paid services, you cannot reliably scrape:**
- Login-walled county portals
- CAPTCHA-protected sites
- Cash buyer lists (these are proprietary data)

---

## What the Fixed Repo Should Look Like

```
workers/
├── main.py                    # FastAPI + job queue (keep, fix status reporting)
├── config.py                  # Settings (keep)
├── db.py                      # Add Pydantic validation layer
├── models.py                  # NEW: Pydantic schemas
├── captcha_solver.py          # NEW: 2Captcha/AntiCaptcha integration
├── circuit_breaker.py         # Keep
├── retry_queue.py             # Keep
├── browser_pool.py            # Keep
├── proxy_pool.py              # Keep
├── http_client.py             # Fix: remove proxy skip for gov sites
├── job_store.py               # Keep
├── pdf_parser.py              # Enhance: add OCR
├── llm.py                     # Strip: only classification helpers
├── ai_research.py             # Review: remove if uses LLM for extraction
├── skip_trace.py              # Rewrite: API-only, no scraping
├── scrapers/
│   ├── _browser_session.py    # Replace stealth with playwright-extra
│   ├── _utils.py              # Keep
│   ├── base.py                # Keep (generic base)
│   ├── propelio_v2.py         # Keep (authenticated)
│   ├── propwire.py            # Keep (authenticated)
│   ├── zillow.py              # Fix (add challenge detection)
│   ├── homeharvest_scraper.py # Review
│   ├── county.py              # Refactor to use counties/
│   ├── county_deeds.py        # Remove AI discovery
│   ├── distressed_sources.py  # Annotate: 10 implemented, 190+ not_implemented
│   ├── cash_buyers.py         # Rewrite: Propelio/Propwire + deed analysis
│   └── counties/              # NEW: Per-county scrapers
│       ├── __init__.py
│       ├── base.py
│       ├── harris_tx.py
│       ├── dallas_tx.py
│       ├── miami_dade_fl.py
│       ├── broward_fl.py
│       ├── maricopa_az.py
│       ├── clark_nv.py
│       ├── orange_ca.py
│       ├── los_angeles_ca.py
│       ├── cook_il.py
│       └── fulton_ga.py
tests/
├── test_counties.py
├── test_schema.py
├── test_captcha.py
└── test_cash_buyers.py
SOURCES.md
README.md
```


---

## Critical Path: What to Do FIRST

Given limited time/resources, prioritize in this order:

1. **Phase 1.1** — Remove 4 LLM extraction functions from `llm.py` (30 min)
2. **Phase 5.1** — Create `workers/models.py` with Pydantic schemas (30 min)
3. **Phase 2.1 + 2.2** — Create `counties/` directory + `base.py` (30 min)
4. **Phase 2.3** — Implement Harris County, TX scraper (2 hours)
5. **Phase 6** — Update `main.py` to dispatch county scrapers (1 hour)
6. **Phase 1.2** — Replace AI URL discovery with hardcoded registry (30 min)
7. **Phase 4.2** — Remove `_PROXY_BLOCKED_DOMAINS` from `http_client.py` (15 min)
8. **Phase 3** — Create `captcha_solver.py` for RealForeclose (1 hour)
9. **Phase 2.4** — Implement Miami-Dade scraper with CAPTCHA (2 hours)
10. **Phase 8** — Write tests for Harris + Miami-Dade (1 hour)

**Total: ~8-10 hours of focused work to get the first 2 counties working end-to-end.**

---

**End of Updated Fix Guide.**
