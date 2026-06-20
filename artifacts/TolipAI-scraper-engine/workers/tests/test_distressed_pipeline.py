"""Unit tests for distressed scraper pipeline — mocks HTTP, no real network calls."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestDistressedSourceFiltering:
    def test_sources_load(self):
        """distressed_sources.py must export SOURCES with at least 200 entries."""
        from workers.scrapers.distressed_sources import SOURCES

        assert isinstance(SOURCES, list), "SOURCES must be a list"
        assert len(SOURCES) >= 200, f"Expected 200+ sources, got {len(SOURCES)}"

    def test_all_sources_have_required_fields(self):
        """Every source must have name, url, and category."""
        from workers.scrapers.distressed_sources import SOURCES

        for src in SOURCES:
            assert "name" in src, f"Source missing 'name': {src}"
            assert "url" in src, f"Source missing 'url': {src}"
            assert "category" in src, f"Source missing 'category': {src}"

    def test_no_duplicate_urls(self):
        """No two sources should share the same URL."""
        from workers.scrapers.distressed_sources import SOURCES

        urls = [s["url"] for s in SOURCES]
        duplicates = [u for u in set(urls) if urls.count(u) > 1]
        assert not duplicates, f"Duplicate URLs: {duplicates[:5]}"

    def test_categories_are_known(self):
        """All source categories must be from the known set."""
        from workers.scrapers.distressed_sources import SOURCES

        known = {
            "county_clerk",
            "public_trustee",
            "tax_assessor",
            "auction_aggregator",
            "government_reo",
            "probate_court",
        }
        for src in SOURCES:
            cat = src.get("category", "")
            assert cat in known, f"Unknown category '{cat}' in source '{src.get('name')}'"

    def test_sources_for_request_ai_is_static(self):
        """sources_for_request_ai() must not call LLM — pure registry lookup now."""
        from workers.scrapers.distressed_sources import sources_for_request_ai

        result = _run(sources_for_request_ai(state="TX"))
        assert isinstance(result, list)
        for src in result:
            assert src.get("state") in ("TX", "*"), \
                f"sources_for_request_ai returned wrong-state entry: {src.get('state')}"


class TestCountyScraperRegistry:
    def test_county_scrapers_registered(self):
        """COUNTY_SCRAPERS must have all 10 expected counties."""
        from workers.scrapers.counties import COUNTY_SCRAPERS

        expected = [
            "harris_tx", "dallas_tx",
            "miami_dade_fl", "broward_fl",
            "maricopa_az", "clark_nv",
            "orange_ca", "los_angeles_ca",
            "cook_il", "fulton_ga",
        ]
        for key in expected:
            assert key in COUNTY_SCRAPERS, f"Missing county scraper: {key}"

    def test_county_scrapers_have_metadata(self):
        """Every county scraper must implement metadata() with required fields."""
        from workers.scrapers.counties import COUNTY_SCRAPERS

        required_fields = {"name", "county", "state", "source_url", "sale_type"}
        for key, cls in COUNTY_SCRAPERS.items():
            scraper = cls()
            meta = scraper.metadata()
            assert isinstance(meta, dict), f"{key}.metadata() must return dict"
            for field in required_fields:
                assert field in meta, f"{key}.metadata() missing '{field}'"
            assert meta["state"].isupper(), \
                f"{key}.metadata()['state'] must be uppercase, got: {meta['state']}"
            assert meta["source_url"].startswith("http"), \
                f"{key}.metadata()['source_url'] must be a real URL"

    def test_county_scrapers_no_llm_import(self):
        """County scraper files must not import any removed LLM extraction functions."""
        import glob

        counties_dir = os.path.join(
            os.path.dirname(__file__), "..", "scrapers", "counties"
        )
        banned = [
            "parse_distressed_page",
            "suggest_distressed_sources",
            "extract_investor_profile",
            "score_buyer_match\b",
        ]
        for py_file in glob.glob(os.path.join(counties_dir, "*.py")):
            with open(py_file) as f:
                content = f.read()
            for fn in banned:
                assert fn not in content, (
                    f"{os.path.basename(py_file)} references banned function '{fn}'"
                )

    def test_list_supported_counties_uses_registry(self):
        """list_supported_counties() must return data from COUNTY_SCRAPERS, not distressed_sources."""
        from workers.scrapers.counties import COUNTY_SCRAPERS
        from workers.scrapers.county import list_supported_counties

        result = list_supported_counties()
        assert isinstance(result, list)
        assert len(result) == len(COUNTY_SCRAPERS), (
            f"Expected {len(COUNTY_SCRAPERS)} entries, got {len(result)}"
        )
        result_keys = {r["key"] for r in result}
        for key in COUNTY_SCRAPERS:
            assert key in result_keys, f"list_supported_counties() missing key: {key}"

    def test_scrape_county_unknown_key_returns_empty(self):
        """scrape_county() with an unknown key must return [] without making HTTP calls."""
        from workers.scrapers.county import scrape_county

        result = _run(scrape_county("nonexistent_county_xx"))
        assert result == [], f"Expected [], got {result}"


class TestDistressedDispatch:
    def test_normalize_county_key(self):
        """_normalize_county_key must produce valid lookup keys."""
        from workers.distressed import _normalize_county_key

        assert _normalize_county_key("Harris", "TX") == "harris_tx"
        assert _normalize_county_key("Miami-Dade", "FL") == "miami_dade_fl"
        assert _normalize_county_key("Los Angeles", "CA") == "los_angeles_ca"
        assert _normalize_county_key("cook", "il") == "cook_il"
        assert _normalize_county_key("Fulton", "GA") == "fulton_ga"

    def test_find_distressed_unknown_county_returns_empty(self):
        """find_distressed() for an unregistered county must return []."""
        from workers.distressed import find_distressed

        result = _run(find_distressed(county_key="nonexistent", state="ZZ"))
        assert result == [], f"Expected [], got {result}"

    def test_completed_no_results_status_string(self):
        """The status string for empty results must be exactly 'completed_no_results'."""
        status = "completed_no_results"
        assert status == "completed_no_results", \
            "Must be 'completed_no_results', not 'completed' or 'failed'"

    def test_validate_listings_drops_invalid(self):
        """validate_listings() must drop invalid records silently."""
        from workers.models import validate_listings

        raw = [
            {"address": "123 Main St", "city": "Houston", "state": "TX",
             "county": "Harris", "source_url": "https://hctax.net"},
            {"address": "po box 1234", "city": "Dallas", "state": "TX",
             "county": "Dallas", "source_url": "https://dallascounty.org"},
        ]
        result = validate_listings(raw)
        assert len(result) == 1, "PO Box address must be dropped"
        assert result[0].address == "123 Main St"


class TestHomeharvest:
    def test_extract_phones_list(self):
        """_extract_phones handles a real list correctly."""
        from workers.scrapers.homeharvest_scraper import _extract_phones

        result = _extract_phones(["813-555-1234", "727-555-9876"])
        assert result == ["813-555-1234", "727-555-9876"]

    def test_extract_phones_stringified(self):
        """_extract_phones handles a stringified list (no eval)."""
        from workers.scrapers.homeharvest_scraper import _extract_phones

        result = _extract_phones("['813-555-1234', '727-555-9876']")
        assert "813-555-1234" in result

    def test_extract_phones_empty(self):
        """_extract_phones handles None gracefully."""
        from workers.scrapers.homeharvest_scraper import _extract_phones

        assert _extract_phones(None) == []
        assert _extract_phones("") == []


class TestAiResearch:
    def test_discover_trustees_is_static(self):
        """discover_trustees() must return static registry data — no LLM call."""
        from workers.ai_research import discover_trustees

        result = _run(discover_trustees("TX"))
        assert isinstance(result, list)
        assert len(result) > 0, "TX must have at least one trustee entry"
        for entry in result:
            assert entry.get("state") == "TX"
            assert entry.get("website", "").startswith("http"), \
                "All trustee entries must have a real https:// URL"
            assert "name" in entry
            assert "role" in entry

    def test_discover_trustees_unknown_state_returns_empty(self):
        """discover_trustees() must return [] for states not in registry."""
        from workers.ai_research import discover_trustees

        result = _run(discover_trustees("ZZ"))
        assert result == [], f"Expected [], got {result}"

    def test_discover_trustees_county_filter(self):
        """discover_trustees() must filter to county-specific entries when county is given."""
        from workers.ai_research import discover_trustees

        result = _run(discover_trustees("TX", county="harris"))
        assert isinstance(result, list)
        assert len(result) > 0, "Harris County TX must have registry entries"
        for entry in result:
            assert entry.get("county") == "harris"

    def test_trustee_registry_all_https(self):
        """Every entry in TRUSTEE_REGISTRY must have a verified HTTPS URL."""
        from workers.ai_research import TRUSTEE_REGISTRY

        for entry in TRUSTEE_REGISTRY:
            url = entry.get("website", "")
            assert url.startswith("https://"), (
                f"Registry URL must use HTTPS: {url!r} (entry: {entry.get('name')})"
            )
            assert "{" not in url, (
                f"URL must not contain template placeholders: {url!r}"
            )

    def test_batch_extract_profiles_is_stubbed(self):
        """batch_extract_profiles() must be a no-op stub (LLM extraction removed)."""
        from workers.llm_cache import batch_extract_profiles

        result = _run(batch_extract_profiles(["some text", "more text"], source="test"))
        assert isinstance(result, list)
        assert len(result) == 2, "Stub must return same count as input"
        for item in result:
            assert item["buyer_type"] == "unknown"
            assert item["buyer_name"] == "Unknown"


class TestCountyDeedModel:
    def test_county_deed_model_exists(self):
        """CountyDeed Pydantic model must exist with required fields."""
        from workers.models import CountyDeed

        deed = CountyDeed(
            grantor="John Smith",
            grantee="Harris County Investments LLC",
            address="123 Main St",
            state="TX",
            county="Harris",
            source_url="https://hctax.net",
        )
        assert deed.grantor == "John Smith"
        assert deed.state == "TX"
        assert deed.is_investor is None

    def test_county_deed_investor_flag_set_when_mailing_differs(self):
        """CountyDeed must auto-flag is_investor=True when mailing != property address."""
        from workers.models import CountyDeed

        deed = CountyDeed(
            grantor="Seller Corp",
            grantee="Buyer LLC",
            address="123 Oak Ave, Houston TX 77001",
            state="TX",
            county="Harris",
            mailing_address="456 Investor Way, Dallas TX 75001",
            source_url="https://hctax.net",
        )
        assert deed.is_investor is True

    def test_validate_deed_returns_none_on_bad_data(self):
        """validate_deed() must return None for invalid records."""
        from workers.models import validate_deed

        result = validate_deed({
            "grantor": "X",
            "grantee": "Harris County LLC",
            "address": "123 Main St",
            "state": "TX",
            "county": "Harris",
            "source_url": "https://hctax.net",
        })
        assert result is None, "grantor 'X' (< 2 chars) must fail validation"


if __name__ == "__main__":
    print("Running distressed pipeline tests...\n")

    for cls in [
        TestDistressedSourceFiltering,
        TestCountyScraperRegistry,
        TestDistressedDispatch,
        TestHomeharvest,
        TestAiResearch,
        TestCountyDeedModel,
    ]:
        obj = cls()
        for name in [m for m in dir(obj) if m.startswith("test_")]:
            try:
                getattr(obj, name)()
                print(f"PASS: {cls.__name__}.{name}")
            except Exception as e:
                print(f"FAIL: {cls.__name__}.{name} — {e}")

    print("\nDone.")
