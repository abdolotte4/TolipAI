"""asyncpg pool + schema-aware insert helpers.

Schema lives in lib/db/src/schema/crm.ts (Drizzle).  This module mirrors
the table/column names but uses asyncpg directly to avoid a JS dependency.
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional

import asyncpg

from .config import settings

log = logging.getLogger("db")

_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> Optional[asyncpg.Pool]:
    """Create a singleton pool, or return None if no DATABASE_URL set."""
    global _pool
    if _pool is not None:
        return _pool
    if not settings.database_url:
        log.warning("DATABASE_URL not set — DB persistence disabled")
        return None
    _pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=1,
        max_size=8,
        command_timeout=30,
    )
    log.info("PG pool ready")
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
            ON CONFLICT (id) DO NOTHING
            """,
            job_id, job_type, json.dumps(params), lead_id, campaign_id, created_by,
        )


async def update_job(
    job_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    result_count: Optional[int] = None,
    error: Optional[str] = None,
    completed: bool = False,
) -> None:
    async with conn() as c:
        if c is None:
            return
        sets: List[str] = []
        vals: List[Any] = []
        i = 1
        if status is not None:
            sets.append(f"status=${i}"); vals.append(status); i += 1
        if progress is not None:
            sets.append(f"progress=${i}"); vals.append(progress); i += 1
        if result_count is not None:
            sets.append(f"result_count=${i}"); vals.append(result_count); i += 1
        if error is not None:
            sets.append(f"error=${i}"); vals.append(error); i += 1
        if completed:
            sets.append(f"completed_at=${i}")
            vals.append(datetime.now(timezone.utc).replace(tzinfo=None))
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
    job_id: str, lead_id: int, matches: List[Dict[str, Any]],
) -> int:
    if not matches:
        return 0
    async with conn() as c:
        if c is None:
            return 0
        rows = []
        for m in matches:
            rows.append((
                lead_id,
                job_id,
                m.get("buyer_name") or "Unknown",
                m.get("llc_name"),
                m.get("buyer_type") or "unknown",
                int(m.get("match_score") or 0),
                json.dumps(m.get("match_reasons") or []),
                m.get("portfolio_size"),
                m.get("portfolio_value"),
                m.get("portfolio_appreciation"),
                m.get("avg_purchase_price"),
                m.get("last_purchase_date"),
                m.get("city"), m.get("state"), m.get("zip"),
                m.get("mailing_address"),
                json.dumps(m.get("phones") or []),
                json.dumps(m.get("emails") or []),
                json.dumps(m.get("principals") or []),
                m.get("classification_reason"),
                m.get("source") or "scraper-engine",
                json.dumps(m.get("raw_data") or {}),
            ))
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


async def list_cash_buyers_for_lead(lead_id: int, limit: int = 100) -> List[Dict[str, Any]]:
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
            lead_id, limit,
        )
        return [dict(r) for r in rows]


# ─── distressed_listings ─────────────────────────────────────────────────────

async def insert_distressed_listings(
    job_id: str, listings: List[Dict[str, Any]], campaign_id: Optional[int] = None,
) -> int:
    if not listings:
        return 0
    async with conn() as c:
        if c is None:
            return 0
        rows = []
        for l in listings:
            rows.append((
                job_id,
                campaign_id,
                l.get("distress_type") or "unknown",
                l.get("address") or "Unknown",
                l.get("city"), l.get("state"), l.get("zip"), l.get("county"),
                l.get("parcel_id"), l.get("owner_name"),
                l.get("sale_date"),
                l.get("opening_bid"),
                l.get("estimated_value"),
                l.get("mortgage_balance"),
                l.get("source") or "scraper-engine",
                l.get("source_url"),
                l.get("latitude"), l.get("longitude"),
                json.dumps(l.get("raw_data") or {}),
            ))
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
            job_id, limit,
        )
        return [dict(r) for r in rows]


async def get_lead(lead_id: int) -> Optional[Dict[str, Any]]:
    async with conn() as c:
        if c is None:
            return None
        row = await c.fetchrow("SELECT * FROM crm_leads WHERE id=$1", lead_id)
        return dict(row) if row else None
