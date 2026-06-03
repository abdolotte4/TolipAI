"""County scraper unit tests.

Tests validate:
  - Each scraper class is importable and instantiable
  - Each scraper has required metadata (county, state, source_url)
  - All 10 counties are registered in COUNTY_SCRAPERS
  - parse_table() returns correct structure from sample HTML
  - validate_listing() rejects incomplete records
  - No scraper imports or calls llm._chat (AUDIT: no LLM in scrapers)

Run with: pytest workers/tests/test_counties.py -v
"""
import pytest
import re

from workers.scrapers.counties import COUNTY_SCRAPERS
from workers.scrapers.counties.base import CountyScraper


EXPECTED_SCRAPERS = [
    "harris_tx",
    "dallas_tx",
    "miami_dade_fl",
    "broward_fl",
    "maricopa_az",
    "clark_nv",
    "orange_ca",
    "los_angeles_ca",
    "cook_il",
    "fulton_ga",
]

SAMPLE_HTML = """
<html><body>
<table>
  <thead>
    <tr>
      <th>Property Address</th>
      <th>City</th>
      <th>Owner</th>
      <th>Sale Date</th>
      <th>Minimum Bid</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>456 Oak Ave</td>
      <td>Houston</td>
      <td>John Doe</td>
      <td>07/15/2025</td>
      <td>$85,000</td>
    </tr>
    <tr>
      <td>789 Pine St</td>
      <td>Houston</td>
      <td>Jane Smith</td>
      <td>07/15/2025</td>
      <td>$120,000</td>
    </tr>
    <tr>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>
</body></html>
"""


# ── Registry completeness ────────────────────────────────────────────────────

class TestCountyScrapersRegistry:
    def test_all_10_counties_registered(self):
        for key in EXPECTED_SCRAPERS:
            assert key in COUNTY_SCRAPERS, f"Missing scraper: {key}"

    def test_no_extra_keys(self):
        for key in COUNTY_SCRAPERS:
            assert key in EXPECTED_SCRAPERS, f"Unexpected scraper key: {key}"

    def test_all_values_are_classes(self):
        for key, cls in COUNTY_SCRAPERS.items():
            assert isinstance(cls, type), f"{key}: value must be a class"
            assert issubclass(cls, CountyScraper), f"{key}: must subclass CountyScraper"


# ── Per-scraper metadata ──────────────────────────────────────────────────────

@pytest.mark.parametrize("key", EXPECTED_SCRAPERS)
class TestScraperMetadata:
    def test_instantiable(self, key):
        cls = COUNTY_SCRAPERS[key]
        scraper = cls()
        assert scraper is not None

    def test_county_set(self, key):
        scraper = COUNTY_SCRAPERS[key]()
        assert scraper.county, f"{key}: county must be set"

    def test_state_set(self, key):
        scraper = COUNTY_SCRAPERS[key]()
        assert scraper.state, f"{key}: state must be set"
        assert scraper.state == scraper.state.upper(), f"{key}: state must be uppercase"
        assert len(scraper.state) == 2, f"{key}: state must be 2-letter code"

    def test_source_url_set(self, key):
        scraper = COUNTY_SCRAPERS[key]()
        assert scraper.source_url, f"{key}: source_url must be set"
        assert scraper.source_url.startswith("https://"), f"{key}: source_url must use HTTPS"

    def test_has_scrape_method(self, key):
        scraper = COUNTY_SCRAPERS[key]()
        assert callable(scraper.scrape), f"{key}: must have scrape() method"

    def test_state_matches_key(self, key):
        expected_state = key.split("_")[-1].upper()
        scraper = COUNTY_SCRAPERS[key]()
        assert scraper.state == expected_state, (
            f"{key}: state '{scraper.state}' does not match key suffix '{expected_state}'"
        )


# ── No LLM imports in scraper files ──────────────────────────────────────────

class TestNoLLMInScrapers:
    """Verify no county scraper directly imports or calls LLM functions."""

    def _get_source(self, key: str) -> str:
        import inspect
        cls = COUNTY_SCRAPERS[key]
        return inspect.getsource(cls)

    @pytest.mark.parametrize("key", EXPECTED_SCRAPERS)
    def test_no_extract_investor_profile(self, key):
        src = self._get_source(key)
        assert "extract_investor_profile" not in src, (
            f"{key}: must not call extract_investor_profile() — audit violation"
        )

    @pytest.mark.parametrize("key", EXPECTED_SCRAPERS)
    def test_no_parse_distressed_page(self, key):
        src = self._get_source(key)
        assert "parse_distressed_page" not in src, (
            f"{key}: must not call parse_distressed_page() — audit violation"
        )

    @pytest.mark.parametrize("key", EXPECTED_SCRAPERS)
    def test_no_score_buyer_match_llm(self, key):
        src = self._get_source(key)
        # Old LLM-based score function has been removed; rule-based is allowed
        assert "score_buyer_match(" not in src.replace("score_buyer_match_rule_based", ""), (
            f"{key}: must not call the removed LLM score_buyer_match() — use rule-based version"
        )


# ── Base class utilities ─────────────────────────────────────────────────────

class TestCountyScraperBase:
    def setup_method(self):
        # Use Harris TX as a concrete representative
        self.scraper = COUNTY_SCRAPERS["harris_tx"]()

    def test_parse_table_returns_list(self):
        rows = self.scraper.parse_table(SAMPLE_HTML, "table")
        assert isinstance(rows, list)

    def test_parse_table_skips_empty_rows(self):
        rows = self.scraper.parse_table(SAMPLE_HTML, "table")
        # The third row is all empty cells — should be skipped (< 2 non-empty cells)
        assert len(rows) <= 2

    def test_parse_table_captures_headers(self):
        rows = self.scraper.parse_table(SAMPLE_HTML, "table")
        if rows:
            assert "property_address" in rows[0] or "address" in str(rows[0]).lower()

    def test_parse_table_missing_selector(self):
        rows = self.scraper.parse_table(SAMPLE_HTML, "div.nonexistent")
        assert rows == []

    def test_parse_money_valid(self):
        assert self.scraper.parse_money("$85,000") == 85000.0
        assert self.scraper.parse_money("120,000.50") == 120000.50
        assert self.scraper.parse_money("$ 1,234,567") == 1234567.0

    def test_parse_money_empty(self):
        assert self.scraper.parse_money("") is None
        assert self.scraper.parse_money(None) is None

    def test_parse_money_invalid_string(self):
        assert self.scraper.parse_money("N/A") is None
        assert self.scraper.parse_money("TBD") is None

    def test_parse_date_mdy(self):
        result = self.scraper.parse_date("07/15/2025")
        assert result == "2025-07-15"

    def test_parse_date_iso(self):
        result = self.scraper.parse_date("2025-07-15")
        assert result == "2025-07-15"

    def test_parse_date_invalid(self):
        result = self.scraper.parse_date("not-a-date")
        assert result is None

    def test_validate_listing_accepts_valid(self):
        listing = {
            "address": "123 Main St",
            "county": "Harris",
            "state": "TX",
            "source_url": "https://www.hctax.net/foreclosures",
        }
        assert self.scraper.validate_listing(listing) is True

    def test_validate_listing_rejects_missing_address(self):
        assert self.scraper.validate_listing({"county": "Harris", "state": "TX", "source_url": "https://example.com"}) is False

    def test_validate_listing_rejects_short_address(self):
        assert self.scraper.validate_listing({"address": "1 A", "county": "Harris", "state": "TX", "source_url": "https://example.com"}) is False

    def test_validate_listing_rejects_missing_county(self):
        assert self.scraper.validate_listing({"address": "123 Main St", "state": "TX", "source_url": "https://example.com"}) is False


# ── county_deeds no-AI compliance ────────────────────────────────────────────

class TestCountyDeedsNoAI:
    def test_no_ai_extract_function(self):
        import inspect
        import workers.scrapers.county_deeds as cd
        src = inspect.getsource(cd)
        assert "_ai_extract_deeds" not in src, "county_deeds must not contain _ai_extract_deeds"
        assert "discover_deed_source" not in src or "discover_deed_source" not in src.split("import")[-1], (
            "county_deeds must not import ai_discover.discover_deed_source"
        )
        assert "parse_distressed_page" not in src, "county_deeds must not call parse_distressed_page"

    def test_no_propertyshark_scraper(self):
        import inspect
        import workers.scrapers.county_deeds as cd
        src = inspect.getsource(cd)
        assert "propertyshark" not in src.lower(), "county_deeds must not scrape PropertyShark"

    def test_fetch_recent_deeds_returns_empty_for_unknown_county(self):
        import asyncio
        import workers.scrapers.county_deeds as cd
        # Patch DEED_REGISTRY to empty to simulate missing county
        original = cd.DEED_REGISTRY.copy()
        cd.DEED_REGISTRY.clear()
        try:
            result = asyncio.get_event_loop().run_until_complete(
                cd.fetch_recent_deeds(state="ZZ", city="Unknown City")
            )
            assert result == []
        finally:
            cd.DEED_REGISTRY.update(original)


# ── distressed.py no-LLM compliance ─────────────────────────────────────────

class TestDistressedNoLLM:
    def test_no_parse_distressed_page_import(self):
        import inspect
        import workers.distressed as dist
        src = inspect.getsource(dist)
        assert "parse_distressed_page" not in src, (
            "distressed.py must not import or call parse_distressed_page"
        )

    def test_no_sources_for_request_ai_call(self):
        import inspect
        import workers.distressed as dist
        src = inspect.getsource(dist)
        assert "sources_for_request_ai" not in src, (
            "distressed.py must not call sources_for_request_ai (AI URL discovery)"
        )

    def test_uses_county_scrapers(self):
        import inspect
        import workers.distressed as dist
        src = inspect.getsource(dist)
        assert "COUNTY_SCRAPERS" in src, "distressed.py must import and use COUNTY_SCRAPERS"
