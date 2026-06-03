"""Pydantic schemas for all scraper output types.

All scrapers MUST validate their output through these models before persisting.
This ensures consistent data shapes, catches extraction errors early, and
prevents malformed records from reaching the database.

Rule: NEVER skip validation. If a record fails validation, log it and discard it.
Do NOT silently coerce bad data — return completed_no_results instead of junk.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class DistressedListing(BaseModel):
    address: str = Field(..., min_length=5, description="Street address")
    city: str = Field(..., min_length=2)
    state: str = Field(..., min_length=2, max_length=2)
    zip: Optional[str] = Field(None, pattern=r"^\d{5}(-\d{4})?$")
    county: str = Field(..., min_length=2)

    case_number: Optional[str] = None
    parcel_id: Optional[str] = None
    owner_name: Optional[str] = None

    sale_date: Optional[str] = None
    sale_type: Literal[
        "foreclosure",
        "tax_lien",
        "trustee_sale",
        "probate",
        "tax_foreclosure",
        "code_violation",
        "preforeclosure",
    ] = "tax_foreclosure"

    opening_bid: Optional[float] = Field(None, ge=0)
    lien_amount: Optional[float] = Field(None, ge=0)
    estimated_value: Optional[float] = Field(None, ge=0)
    mortgage_balance: Optional[float] = Field(None, ge=0)
    property_type: Optional[str] = None

    source_url: str
    source: str = ""
    scraped_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    raw_data: Optional[Dict[str, Any]] = None

    @field_validator("state")
    @classmethod
    def state_uppercase(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("address")
    @classmethod
    def address_not_po_box(cls, v: str) -> str:
        lower = v.lower()
        if "p.o. box" in lower or "po box" in lower:
            raise ValueError("PO Box addresses are not valid property listings")
        return v.strip()

    @field_validator("city", "county")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class CashBuyer(BaseModel):
    buyer_name: str = Field(..., min_length=2)
    llc_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = Field(None, max_length=2)
    zip: Optional[str] = None
    phones: List[str] = Field(default_factory=list)
    emails: List[str] = Field(default_factory=list)
    principals: List[str] = Field(default_factory=list)

    portfolio_size: Optional[int] = Field(None, ge=0)
    portfolio_value: Optional[float] = Field(None, ge=0)
    avg_purchase_price: Optional[float] = Field(None, ge=0)
    last_purchase_date: Optional[str] = None

    buyer_type: Optional[Literal["flipper", "landlord", "wholesaler", "developer", "hedge_fund", "lender", "unknown"]] = "unknown"
    match_score: int = Field(default=0, ge=0, le=100)
    match_reasons: List[str] = Field(default_factory=list)

    source: str = Field(..., description="propelio, propwire, county_deeds, attom")
    raw_data: Optional[Dict[str, Any]] = None

    @field_validator("state")
    @classmethod
    def state_uppercase(cls, v: Optional[str]) -> Optional[str]:
        return v.upper().strip() if v else v

    @field_validator("phones")
    @classmethod
    def normalize_phones(cls, v: List[str]) -> List[str]:
        out = []
        for p in v:
            digits = re.sub(r"\D", "", str(p))
            if len(digits) == 10:
                out.append(f"+1{digits}")
            elif len(digits) == 11 and digits.startswith("1"):
                out.append(f"+{digits}")
        return list(dict.fromkeys(out))


class CountyDeed(BaseModel):
    """A deed transfer record from a county recorder's office."""

    grantor: str = Field(..., min_length=2, description="Seller / transferring party")
    grantee: str = Field(..., min_length=2, description="Buyer / receiving party")
    address: str = Field(..., min_length=5)
    city: Optional[str] = None
    state: str = Field(..., min_length=2, max_length=2)
    zip: Optional[str] = Field(None, pattern=r"^\d{5}(-\d{4})?$")
    county: str = Field(..., min_length=2)

    parcel_id: Optional[str] = None
    recorded_date: Optional[str] = None
    instrument_number: Optional[str] = None
    deed_type: Optional[str] = None

    sale_price: Optional[float] = Field(None, ge=0)
    is_arms_length: Optional[bool] = None
    is_cash_purchase: Optional[bool] = None

    mailing_address: Optional[str] = None
    is_investor: Optional[bool] = None

    source_url: str
    scraped_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    raw_data: Optional[Dict[str, Any]] = None

    @field_validator("state")
    @classmethod
    def state_uppercase(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("grantor", "grantee", "city", "county")
    @classmethod
    def strip_whitespace(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v else v

    @model_validator(mode="after")
    def check_investor_signal(self) -> "CountyDeed":
        if self.mailing_address and self.address:
            mailing_norm = re.sub(r"\s+", " ", self.mailing_address.lower().strip())
            addr_norm = re.sub(r"\s+", " ", self.address.lower().strip())
            if mailing_norm and mailing_norm != addr_norm:
                object.__setattr__(self, "is_investor", True)
        return self


def validate_deed(raw: Dict[str, Any]) -> Optional[CountyDeed]:
    """Validate a raw dict against CountyDeed. Returns None on failure."""
    try:
        return CountyDeed(**raw)
    except Exception as exc:
        import logging
        logging.getLogger("models").warning("Deed validation failed: %s — data: %s", exc, str(raw)[:200])
        return None


def validate_listing(raw: Dict[str, Any]) -> Optional[DistressedListing]:
    """Validate a raw dict against DistressedListing. Returns None on failure."""
    try:
        return DistressedListing(**raw)
    except Exception as exc:
        import logging
        logging.getLogger("models").warning("Listing validation failed: %s — data: %s", exc, str(raw)[:200])
        return None


def validate_buyer(raw: Dict[str, Any]) -> Optional[CashBuyer]:
    """Validate a raw dict against CashBuyer. Returns None on failure."""
    try:
        return CashBuyer(**raw)
    except Exception as exc:
        import logging
        logging.getLogger("models").warning("Buyer validation failed: %s — data: %s", exc, str(raw)[:200])
        return None


def validate_listings(raws: List[Dict[str, Any]]) -> List[DistressedListing]:
    """Validate a list, silently dropping invalid records."""
    return [m for raw in raws if (m := validate_listing(raw)) is not None]
