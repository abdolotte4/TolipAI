"""Unit tests for distressed scraper pipeline — mocks HTTP, no real network calls."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


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


if __name__ == "__main__":
    t1 = TestDistressedSourceFiltering()
    t1.test_sources_load()
    print("test_sources_load PASSED")
    t1.test_all_sources_have_required_fields()
    print("test_all_sources_have_required_fields PASSED")
    t1.test_no_duplicate_urls()
    print("test_no_duplicate_urls PASSED")
    t1.test_categories_are_known()
    print("test_categories_are_known PASSED")

    t2 = TestHomeharvest()
    t2.test_extract_phones_list()
    print("test_extract_phones_list PASSED")
    t2.test_extract_phones_stringified()
    print("test_extract_phones_stringified PASSED")
    t2.test_extract_phones_empty()
    print("test_extract_phones_empty PASSED")

    print("\nAll distressed pipeline tests passed.")
