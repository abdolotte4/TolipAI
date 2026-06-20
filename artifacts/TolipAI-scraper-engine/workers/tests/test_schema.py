"""Schema validation tests for DistressedListing and CashBuyer models.

Run with: pytest workers/tests/test_schema.py -v
"""
import pytest

from workers.models import (
    CashBuyer,
    DistressedListing,
    validate_buyer,
    validate_listing,
    validate_listings,
)

# ── DistressedListing ────────────────────────────────────────────────────────

class TestDistressedListing:
    def _valid(self, **overrides) -> dict:
        base = {
            "address": "123 Main St",
            "city": "Houston",
            "state": "TX",
            "county": "Harris",
            "source_url": "https://www.hctax.net/foreclosures",
            "sale_type": "tax_foreclosure",
        }
        base.update(overrides)
        return base

    def test_valid_minimal(self):
        m = DistressedListing(**self._valid())
        assert m.address == "123 Main St"
        assert m.state == "TX"
        assert m.sale_type == "tax_foreclosure"

    def test_state_uppercased(self):
        m = DistressedListing(**self._valid(state="tx"))
        assert m.state == "TX"

    def test_address_too_short_rejected(self):
        with pytest.raises(Exception):
            DistressedListing(**self._valid(address="1 A"))

    def test_po_box_rejected(self):
        with pytest.raises(Exception):
            DistressedListing(**self._valid(address="P.O. Box 1234"))

    def test_po_box_lowercase_rejected(self):
        with pytest.raises(Exception):
            DistressedListing(**self._valid(address="po box 5678"))

    def test_zip_valid(self):
        m = DistressedListing(**self._valid(zip="77001"))
        assert m.zip == "77001"

    def test_zip_plus4_valid(self):
        m = DistressedListing(**self._valid(zip="77001-1234"))
        assert m.zip == "77001-1234"

    def test_zip_invalid_rejected(self):
        with pytest.raises(Exception):
            DistressedListing(**self._valid(zip="ABCDE"))

    def test_opening_bid_negative_rejected(self):
        with pytest.raises(Exception):
            DistressedListing(**self._valid(opening_bid=-100.0))

    def test_all_sale_types_valid(self):
        valid_types = ["foreclosure", "tax_lien", "trustee_sale", "probate",
                       "tax_foreclosure", "code_violation", "preforeclosure"]
        for t in valid_types:
            m = DistressedListing(**self._valid(sale_type=t))
            assert m.sale_type == t

    def test_invalid_sale_type_rejected(self):
        with pytest.raises(Exception):
            DistressedListing(**self._valid(sale_type="made_up_type"))

    def test_scraped_at_auto_set(self):
        m = DistressedListing(**self._valid())
        assert m.scraped_at is not None
        assert len(m.scraped_at) > 10  # ISO timestamp

    def test_validate_listing_returns_none_on_bad_data(self):
        result = validate_listing({"address": "x", "state": "TX"})
        assert result is None

    def test_validate_listing_returns_model_on_good_data(self):
        result = validate_listing(self._valid())
        assert result is not None
        assert result.city == "Houston"

    def test_validate_listings_drops_bad_keeps_good(self):
        good = self._valid()
        bad = {"address": "x"}
        results = validate_listings([good, bad])
        assert len(results) == 1
        assert results[0].address == "123 Main St"


# ── CashBuyer ────────────────────────────────────────────────────────────────

class TestCashBuyer:
    def _valid(self, **overrides) -> dict:
        base = {
            "buyer_name": "Acme Investments LLC",
            "source": "county_deeds",
        }
        base.update(overrides)
        return base

    def test_valid_minimal(self):
        m = CashBuyer(**self._valid())
        assert m.buyer_name == "Acme Investments LLC"
        assert m.buyer_type == "unknown"

    def test_match_score_clamped(self):
        m = CashBuyer(**self._valid(match_score=50))
        assert 0 <= m.match_score <= 100

    def test_match_score_over_100_rejected(self):
        with pytest.raises(Exception):
            CashBuyer(**self._valid(match_score=150))

    def test_state_uppercased(self):
        m = CashBuyer(**self._valid(state="tx"))
        assert m.state == "TX"

    def test_phone_normalization_10digit(self):
        m = CashBuyer(**self._valid(phones=["7135551234"]))
        assert "+17135551234" in m.phones

    def test_phone_normalization_11digit(self):
        m = CashBuyer(**self._valid(phones=["17135551234"]))
        assert "+17135551234" in m.phones

    def test_phone_dedup(self):
        m = CashBuyer(**self._valid(phones=["7135551234", "7135551234"]))
        assert len(m.phones) == 1

    def test_invalid_short_phone_dropped(self):
        m = CashBuyer(**self._valid(phones=["123"]))
        assert len(m.phones) == 0

    def test_validate_buyer_returns_none_on_bad_data(self):
        result = validate_buyer({"buyer_name": "x"})
        assert result is None  # missing source

    def test_validate_buyer_returns_model_on_good_data(self):
        result = validate_buyer(self._valid())
        assert result is not None


# ── LLM classify_buyer_type (rule-based) ────────────────────────────────────

class TestClassifyBuyerType:
    def test_hedge_fund_by_name_and_volume(self):
        from workers.llm import classify_buyer_type
        result = classify_buyer_type("BlackStone Capital Fund", 20, 500_000)
        assert result["buyer_type"] == "hedge_fund"

    def test_lender_by_name(self):
        from workers.llm import classify_buyer_type
        result = classify_buyer_type("Texas Mortgage Lending LLC", 3, 200_000)
        assert result["buyer_type"] == "lender"

    def test_developer_by_name(self):
        from workers.llm import classify_buyer_type
        result = classify_buyer_type("Sunrise Development Group", 5, 350_000)
        assert result["buyer_type"] == "developer"

    def test_flipper_by_volume_and_low_price(self):
        from workers.llm import classify_buyer_type
        result = classify_buyer_type("John Smith", 7, 120_000)
        assert result["buyer_type"] == "flipper"

    def test_landlord_by_volume_and_high_price(self):
        from workers.llm import classify_buyer_type
        result = classify_buyer_type("John Smith", 7, 280_000)
        assert result["buyer_type"] == "landlord"

    def test_unknown_for_low_volume(self):
        from workers.llm import classify_buyer_type
        result = classify_buyer_type("Jane Doe", 2, 150_000)
        assert result["buyer_type"] == "unknown"

    def test_returns_reason_string(self):
        from workers.llm import classify_buyer_type
        result = classify_buyer_type("ACME LLC", 10, None)
        assert "classification_reason" in result
        assert isinstance(result["classification_reason"], str)


# ── Rule-based match scoring ──────────────────────────────────────────────────

class TestScoreBuyerMatchRuleBased:
    def test_same_zip_gives_high_score(self):
        from workers.llm import score_buyer_match_rule_based
        buyer = {"zip": "77001", "city": "Houston", "state": "TX", "portfolio_size": 10, "avg_purchase_price": 200_000}
        lead = {"zip": "77001", "city": "Houston", "state": "TX", "asking_price": 180_000}
        result = score_buyer_match_rule_based(buyer, lead)
        assert result["match_score"] >= 70
        assert any("ZIP" in r for r in result["match_reasons"])

    def test_same_city_different_zip(self):
        from workers.llm import score_buyer_match_rule_based
        buyer = {"zip": "77002", "city": "Houston", "state": "TX", "portfolio_size": 3}
        lead = {"zip": "77001", "city": "Houston", "state": "TX"}
        result = score_buyer_match_rule_based(buyer, lead)
        assert result["match_score"] >= 25

    def test_different_state_gives_low_score(self):
        from workers.llm import score_buyer_match_rule_based
        buyer = {"zip": "10001", "city": "New York", "state": "NY", "portfolio_size": 1}
        lead = {"zip": "77001", "city": "Houston", "state": "TX"}
        result = score_buyer_match_rule_based(buyer, lead)
        assert result["match_score"] < 15

    def test_score_clamped_at_100(self):
        from workers.llm import score_buyer_match_rule_based
        buyer = {
            "zip": "77001", "city": "Houston", "state": "TX",
            "portfolio_size": 20, "avg_purchase_price": 200_000,
            "buyer_type": "flipper",
        }
        lead = {
            "zip": "77001", "city": "Houston", "state": "TX",
            "asking_price": 200_000, "condition": "distressed",
        }
        result = score_buyer_match_rule_based(buyer, lead)
        assert result["match_score"] <= 100

    def test_returns_reasons_list(self):
        from workers.llm import score_buyer_match_rule_based
        buyer = {"zip": "77001", "state": "TX", "portfolio_size": 5}
        lead = {"zip": "77001", "state": "TX"}
        result = score_buyer_match_rule_based(buyer, lead)
        assert isinstance(result["match_reasons"], list)
