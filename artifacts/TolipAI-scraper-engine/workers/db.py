"""asyncpg pool + schema-aware insert helpers.

Schema lives in lib/db/src/schema/crm.ts (Drizzle).  This module mirrors
the table/column names but uses asyncpg directly to avoid a JS dependency.
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional, Union

import asyncio
import re as _re

import asyncpg

from .config import settings

log = logging.getLogger("db")

_pool: Optional[asyncpg.Pool] = None
_pool_lock: asyncio.Lock = asyncio.Lock()


async def init_pool() -> Optional[asyncpg.Pool]:
    """Create a singleton pool, or return None if no DATABASE_URL set.

    Neon DB requires SSL.  We detect Neon (or any URL with sslmode=require)
    and strip the sslmode query param before passing to asyncpg (which does
    not parse it from the DSN), then pass ssl="require" explicitly.
    """
    global _pool
    async with _pool_lock:
        if _pool is not None:
            return _pool
        if not settings.database_url:
            log.warning("DATABASE_URL not set — DB persistence disabled")
            return None

        dsn = settings.database_url
        ssl_param = None
        # Strip ALL query params from the DSN — asyncpg does not parse them from
        # the URL (it doesn't support sslmode=, channel_binding=, etc.) and
        # leaving them causes the DB name to be misread (e.g. "neondb&channel_binding=require").
        # We detect SSL intent from the original URL before stripping.
        if "sslmode=require" in dsn or "sslmode=verify-full" in dsn or "neon.tech" in dsn:
            ssl_param = "require"
        # Remove the entire query string from the DSN
        dsn = _re.sub(r"\?.*$", "", dsn)

        pool_kwargs = dict(min_size=1, max_size=8, command_timeout=30)
        if ssl_param:
            pool_kwargs["ssl"] = ssl_param  # type: ignore[assignment]

        _pool = await asyncpg.create_pool(dsn, **pool_kwargs)
        log.info("PG pool ready (ssl=%s)", ssl_param or "off")
        return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def conn() -> AsyncIterator[Optional[asyncpg.Connection]]:
    pool = await init_pool()
    if pool is None:
        yield None
        return
    async with pool.acquire() as c:
        yield c


# ─── scraper_jobs ────────────────────────────────────────────────────────────


async def create_job(
    job_id: str,
    job_type: str,
    params: Dict[str, Any],
    *,
    lead_id: Optional[int] = None,
    campaign_id: Optional[int] = None,
    created_by: Optional[int] = None,
) -> None:
    async with conn() as c:
        if c is None:
            return
        await c.execute(
            """
            INSERT INTO scraper_jobs
              (id, job_type, status, params, lead_id, campaign_id, created_by)
            VALUES ($1, $2, 'queued', $3::jsonb, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
              status = EXCLUDED.status,
              progress = EXCLUDED.progress,
              updated_at = NOW()
            """,
            job_id,
            job_type,
            json.dumps(params),
            lead_id,
            campaign_id,
            created_by,
        )


async def update_job(
    job_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    result_count: Optional[int] = None,
    error: Optional[str] = None,
    completed: bool = False,
    result: Optional[Any] = None,
) -> None:
    async with conn() as c:
        if c is None:
            return
        sets: List[str] = []
        vals: List[Any] = []
        i = 1
        if status is not None:
            sets.append(f"status=${i}")
            vals.append(status)
            i += 1
        if progress is not None:
            sets.append(f"progress=${i}")
            vals.append(progress)
            i += 1
        if result_count is not None:
            sets.append(f"result_count=${i}")
            vals.append(result_count)
            i += 1
        if error is not None:
            sets.append(f"error=${i}")
            vals.append(error)
            i += 1
        if result is not None:
            sets.append(f"result=${i}")
            vals.append(json.dumps(result, default=str))
            i += 1
        if completed:
            sets.append(f"completed_at=${i}")
            vals.append(datetime.now(timezone.utc))
            i += 1
        if not sets:
            return
        vals.append(job_id)
        await c.execute(
            f"UPDATE scraper_jobs SET {', '.join(sets)} WHERE id=${i}",
            *vals,
        )


async def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    async with conn() as c:
        if c is None:
            return None
        row = await c.fetchrow("SELECT * FROM scraper_jobs WHERE id=$1", job_id)
        return dict(row) if row else None


# ─── cash_buyer_matches ──────────────────────────────────────────────────────


async def insert_cash_buyer_matches(
    job_id: str,
    lead_id: Any,
    matches: List[Dict[str, Any]],
) -> int:
    if not matches:
        return 0
    async with conn() as c:
        if c is None:
            return 0
        # lead_id column is INTEGER — coerce strings to int safely
        try:
            lead_id_str = int(lead_id) if lead_id is not None else None
        except (ValueError, TypeError):
            log.warning("insert_cash_buyer_matches: could not coerce lead_id=%r to int", lead_id)
            lead_id_str = None

        def _to_int(v: Any) -> Optional[int]:
            """Coerce LLM-returned strings/floats to int, None if unparseable."""
            if v is None:
                return None
            try:
                return int(float(str(v).replace(",", "").replace("$", "").strip()))
            except (ValueError, TypeError):
                return None

        def _to_float(v: Any) -> Optional[float]:
            """Coerce LLM-returned strings to float, None if unparseable."""
            if v is None:
                return None
            try:
                return float(str(v).replace(",", "").replace("$", "").strip())
            except (ValueError, TypeError):
                return None

        rows = []
        for m in matches:
            # last_purchase_date: column is TEXT; guard against raw int timestamps
            lpd = m.get("last_purchase_date")
            if lpd is not None and not isinstance(lpd, str):
                lpd = str(lpd)
            rows.append(
                (
                    lead_id_str,
                    job_id,
                    m.get("buyer_name") or "Unknown",
                    m.get("llc_name"),
                    m.get("buyer_type") or "unknown",
                    int(m.get("match_score") or 0),
                    json.dumps(m.get("match_reasons") or []),
                    _to_int(m.get("portfolio_size")),
                    _to_float(m.get("portfolio_value")),
                    _to_float(m.get("portfolio_appreciation")),
                    _to_float(m.get("avg_purchase_price")),
                    lpd,
                    m.get("city"),
                    m.get("state"),
                    m.get("zip"),
                    m.get("mailing_address") or m.get("address"),
                    json.dumps(m.get("phones") or []),
                    json.dumps(m.get("emails") or []),
                    json.dumps(m.get("principals") or []),
                    m.get("classification_reason"),
                    m.get("source") or "scraper-engine",
                    json.dumps(m.get("raw_data") or {}),
                )
            )
        await c.executemany(
            """
            INSERT INTO cash_buyer_matches
              (lead_id, job_id, buyer_name, llc_name, buyer_type, match_score,
               match_reasons, portfolio_size, portfolio_value, portfolio_appreciation,
               avg_purchase_price, last_purchase_date, city, state, zip,
               mailing_address, phones, emails, principals,
               classification_reason, source, raw_data)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22::jsonb)
            """,
            rows,
        )
        return len(rows)


async def insert_cash_buyers_batch(
    lead_id: int,
    job_id: Optional[str],
    buyers: List[Dict[str, Any]],
) -> int:
    """Insert a list of Propelio/Propwire-shaped buyer dicts in a single DB round-trip.

    Replaces the anti-pattern of calling insert_cash_buyer() in a for loop,
    which opens a new pool connection per buyer.  This version acquires one
    connection and issues one executemany for the entire batch.

    Args:
        lead_id: CRM lead row ID.
        job_id:  Scraper job ID (for traceability).
        buyers:  List of buyer dicts in Propelio/Propwire shape.

    Returns:
        Number of rows successfully inserted.
    """
    if not buyers:
        return 0

    from .models import validate_buyer

    matches: List[Dict[str, Any]] = []
    for buyer in buyers:
        types = buyer.get("types") or []
        btype = "unknown"
        if "flipper" in types and "landlord" not in types:
            btype = "flipper"
        elif "landlord" in types:
            btype = "landlord"

        match = {
            "buyer_name":         buyer.get("name") or buyer.get("llc") or "Unknown",
            "llc_name":           buyer.get("llc"),
            "buyer_type":         btype,
            "match_score":        int(min(100, max(0, (buyer.get("props_count") or 0) * 2))),
            "match_reasons":      [f"{buyer.get('props_count', 0)} recent buys"],
            "portfolio_size":     buyer.get("props_count"),
            "portfolio_value":    buyer.get("total_deal"),
            "avg_purchase_price": buyer.get("avg_deal"),
            "last_purchase_date": buyer.get("last_deal"),
            "city":               buyer.get("city"),
            "state":              buyer.get("state"),
            "zip":                buyer.get("zip"),
            "mailing_address":    buyer.get("address"),
            "phones":             buyer.get("phones") or [],
            "emails":             buyer.get("emails") or [],
            "principals":         buyer.get("principals") or [],
            "source":             buyer.get("source") or "scraper-engine",
            "raw_data":           buyer.get("raw") or buyer,
        }
        validated = validate_buyer(match)
        if validated:
            matches.append(validated.model_dump())
        else:
            log.warning("Skipping invalid buyer record in batch: %s", match)

    return await insert_cash_buyer_matches(job_id or "manual", lead_id, matches)


async def insert_cash_buyer(
    lead_id: int,
    job_id: Optional[str],
    buyer: Dict[str, Any],
) -> bool:
    """Insert a single buyer row mapped from Propelio/Propwire payload shape.

    Returns True on success, False if no DB or insert failed silently.
    """
    if not lead_id or not buyer:
        return False
    types = buyer.get("types") or []
    btype = "unknown"
    if "flipper" in types and "landlord" not in types:
        btype = "flipper"
    elif "landlord" in types and "flipper" not in types:
        btype = "landlord"
    elif "landlord" in types and "flipper" in types:
        btype = "landlord"  # flipper+landlord — pick one
    match: Dict[str, Any] = {
        "buyer_name": buyer.get("name") or buyer.get("llc") or "Unknown",
        "llc_name": buyer.get("llc"),
        "buyer_type": btype,
        "match_score": int(min(100, max(0, (buyer.get("props_count") or 0) * 2))),
        "match_reasons": [f"{buyer.get('props_count', 0)} recent buys"],
        "portfolio_size": buyer.get("props_count"),
        "portfolio_value": buyer.get("total_deal"),
        "avg_purchase_price": buyer.get("avg_deal"),
        "last_purchase_date": buyer.get("last_deal"),
        "city": buyer.get("city"),
        "state": buyer.get("state"),
        "zip": buyer.get("zip"),
        "mailing_address": buyer.get("address"),
        "phones": buyer.get("phones") or [],
        "emails": buyer.get("emails") or [],
        "principals": buyer.get("principals") or [],
        "source": buyer.get("source") or "scraper-engine",
        "raw_data": buyer.get("raw") or buyer,
    }
    n = await insert_cash_buyer_matches(job_id or "manual", lead_id, [match])
    return n > 0


async def list_cash_buyers_for_lead(lead_id: Union[int, str], limit: int = 100) -> List[Dict[str, Any]]:
    async with conn() as c:
        if c is None:
            return []
        rows = await c.fetch(
            """
            SELECT * FROM cash_buyer_matches
            WHERE lead_id=$1
            ORDER BY match_score DESC, created_at DESC
            LIMIT $2
            """,
            int(lead_id),
            limit,
        )
        return [dict(r) for r in rows]


# ─── distressed_listings ─────────────────────────────────────────────────────


def _safe_num(v: Any) -> Optional[float]:
    """Coerce LLM-extracted numeric strings to float; return None for blanks / dashes."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("$", "").replace("—", "")
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


async def insert_distressed_listings(
    job_id: str,
    listings: List[Dict[str, Any]],
    campaign_id: Optional[int] = None,
) -> int:
    if not listings:
        return 0
    async with conn() as c:
        if c is None:
            return 0
        rows = []
        for listing in listings:
            rows.append(
                (
                    job_id,
                    campaign_id,
                    listing.get("sale_type") or listing.get("distress_type") or "unknown",
                    listing.get("address") or "Unknown",
                    listing.get("city"),
                    listing.get("state"),
                    listing.get("zip"),
                    listing.get("county"),
                    listing.get("parcel_id"),
                    listing.get("owner_name"),
                    listing.get("sale_date"),
                    _safe_num(listing.get("opening_bid")),
                    _safe_num(listing.get("estimated_value")),
                    _safe_num(listing.get("mortgage_balance")),
                    listing.get("source") or "scraper-engine",
                    listing.get("source_url"),
                    _safe_num(listing.get("latitude")),
                    _safe_num(listing.get("longitude")),
                    json.dumps(listing.get("raw_data") or {}),
                )
            )
        await c.executemany(
            """
            INSERT INTO distressed_listings
              (job_id, campaign_id, distress_type, address, city, state, zip, county,
               parcel_id, owner_name, sale_date, opening_bid, estimated_value,
               mortgage_balance, source, source_url, latitude, longitude, raw_data)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
            """,
            rows,
        )
        return len(rows)


async def list_distressed_for_job(job_id: str, limit: int = 500) -> List[Dict[str, Any]]:
    async with conn() as c:
        if c is None:
            return []
        rows = await c.fetch(
            """
            SELECT * FROM distressed_listings
            WHERE job_id=$1
            ORDER BY sale_date NULLS LAST, created_at DESC
            LIMIT $2
            """,
            job_id,
            limit,
        )
        return [dict(r) for r in rows]


async def insert_property_comps(
    lead_id: int, source: str, comps: List[Dict[str, Any]], job_id: Optional[str] = None
) -> int:
    if not comps:
        return 0
    async with conn() as c:
        if c is None:
            return 0
        rows = []
        for comp in comps:

            def _n(v):
                return float(str(v).replace(",", "").replace("$", "").strip()) if v is not None else None

            def _i(v):
                return int(float(str(v).replace(",", "").replace("$", "").strip())) if v is not None else None

            try:
                rows.append(
                    (
                        lead_id,
                        job_id,
                        source,
                        comp.get("address") or "Unknown",
                        comp.get("city"),
                        comp.get("state"),
                        comp.get("zip"),
                        _i(comp.get("beds")),
                        _n(comp.get("baths")),
                        _i(comp.get("sqft")),
                        _i(comp.get("lot_sqft")),
                        _i(comp.get("year_built")),
                        _n(comp.get("sale_price") or comp.get("price")),
                        _n(comp.get("price_per_sqft")),
                        comp.get("sold_date") or comp.get("soldDate"),
                        comp.get("status"),
                        _n(comp.get("distance_from_subject")),
                        _n(comp.get("latitude")),
                        _n(comp.get("longitude")),
                        comp.get("source_url"),
                        json.dumps(comp),
                    )
                )
            except Exception as e:
                log.debug("skip bad comp row: %s", e)
        if not rows:
            return 0
        await c.executemany(
            """
            INSERT INTO property_comps
              (lead_id, job_id, source, address, city, state, zip,
               beds, baths, sqft, lot_sqft, year_built, sale_price, price_per_sqft,
               sold_date, status, distance_from_subject, latitude, longitude,
               source_url, raw_data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)
            """,
            rows,
        )
        return len(rows)


async def insert_property_history(
    lead_id: int,
    source: str,
    sales: List[Dict[str, Any]],
    mortgages: List[Dict[str, Any]],
) -> int:
    events = [{"event_type": "sale", **s} for s in sales] + [{"event_type": "mortgage", **m} for m in mortgages]
    if not events:
        return 0
    async with conn() as c:
        if c is None:
            return 0
        rows = []
        for ev in events:

            def _n(v):
                return float(str(v).replace(",", "").replace("$", "").strip()) if v is not None else None

            rows.append(
                (
                    lead_id,
                    source,
                    ev.get("event_type", "sale"),
                    ev.get("event_date") or ev.get("date") or ev.get("saleDate"),
                    _n(ev.get("sale_price") or ev.get("amount") or ev.get("price")),
                    _n(ev.get("mortgage_amount") or ev.get("loanAmount")),
                    ev.get("lender_name") or ev.get("lender"),
                    ev.get("buyer_name") or ev.get("buyer"),
                    ev.get("seller_name") or ev.get("seller"),
                    ev.get("document_type") or ev.get("docType"),
                    json.dumps(ev),
                )
            )
        await c.executemany(
            """
            INSERT INTO property_history
              (lead_id, source, event_type, event_date, sale_price, mortgage_amount,
               lender_name, buyer_name, seller_name, document_type, raw_data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
            """,
            rows,
        )
        return len(rows)


async def upsert_property_tax(
    lead_id: int, source: str, tax: Dict[str, Any], tax_history: List[Dict[str, Any]]
) -> None:
    async with conn() as c:
        if c is None:
            return

        def _n(v):
            return float(str(v).replace(",", "").replace("$", "").strip()) if v is not None else None

        await c.execute(
            """
            INSERT INTO property_tax
              (lead_id, source, assessed_value, market_value, land_value,
               improvement_value, annual_tax, tax_year, parcel_id,
               legal_description, tax_history)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
            ON CONFLICT DO NOTHING
            """,
            lead_id,
            source,
            _n(tax.get("assessed_value")),
            _n(tax.get("market_value")),
            _n(tax.get("land_value")),
            _n(tax.get("improvement_value")),
            _n(tax.get("annual_tax")),
            str(tax.get("tax_year") or "") or None,
            tax.get("parcel_id"),
            tax.get("legal_description"),
            json.dumps(tax_history or []),
        )


async def insert_skip_trace_result(lead_id: Optional[int], subject_name: str, result: Dict[str, Any]) -> None:
    async with conn() as c:
        if c is None:
            return
        await c.execute(
            """
            INSERT INTO skip_trace_results
              (lead_id, subject_name, llc_name, phones, emails,
               principals, addresses, sources, raw_data)
            VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb)
            """,
            lead_id,
            subject_name,
            result.get("llc_name"),
            json.dumps(result.get("phones") or []),
            json.dumps(result.get("emails") or []),
            json.dumps(result.get("principals") or []),
            json.dumps(result.get("addresses") or []),
            json.dumps(result.get("sources") or []),
            json.dumps(result),
        )


async def get_lead(lead_id: int) -> Optional[Dict[str, Any]]:
    async with conn() as c:
        if c is None:
            return None
        row = await c.fetchrow("SELECT * FROM crm_leads WHERE id=$1", lead_id)
        return dict(row) if row else None
