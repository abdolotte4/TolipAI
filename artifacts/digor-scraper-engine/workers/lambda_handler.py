"""AWS Lambda handler — wraps the scraper engine for serverless API Gateway deployment.

Improvements (2026-05-06):
  1. asyncio.run() — clean event-loop per invocation (no deprecated get_event_loop).
  2. Error granularity: asyncio.TimeoutError → 504, 429/rate strings → 429.
  3. context.aws_request_id logged on every invocation and forwarded as X-Request-Id.
  4. S3 key includes job_id + request_id for per-request traceability.
  5. Bedrock: ALL content blocks joined, not just the first.
  6. /health checks DB with SELECT 1 and reports latency.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, Optional

log = logging.getLogger("lambda_handler")

USE_BEDROCK = os.environ.get("USE_BEDROCK", "").lower() in ("1", "true", "yes")
USE_REKOGNITION = os.environ.get("USE_REKOGNITION", "").lower() in ("1", "true", "yes")
S3_RESULTS_BUCKET = os.environ.get("S3_RESULTS_BUCKET", "")


# ─── Response helpers ─────────────────────────────────────────────────────────

def _resp(status: int, body: Any, request_id: str = "") -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "X-Request-Id": request_id},
        "body": json.dumps(body, default=str),
    }


def _err(status: int, message: str, request_id: str = "") -> Dict[str, Any]:
    return _resp(status, {"error": message, "request_id": request_id}, request_id)


# ─── S3 result storage ────────────────────────────────────────────────────────

async def _store_s3(job_id: str, data: Any, request_id: str = "") -> Optional[str]:
    """Store result JSON in S3. Key includes job_id + request_id for traceability."""
    if not S3_RESULTS_BUCKET:
        return None
    try:
        import aiobotocore.session  # type: ignore[import]
        session = aiobotocore.session.get_session()
        ts = int(time.time())
        rid_suffix = request_id[:8] if request_id else "norid"
        key = f"results/{job_id}/{ts}_{rid_suffix}.json"
        async with session.create_client("s3") as s3:
            await s3.put_object(
                Bucket=S3_RESULTS_BUCKET,
                Key=key,
                Body=json.dumps(data, default=str).encode(),
                ContentType="application/json",
            )
        log.info("[%s] Stored result at s3://%s/%s", request_id, S3_RESULTS_BUCKET, key)
        return key
    except Exception as e:
        log.error("[%s] S3 store failed: %s", request_id, e)
        return None


# ─── Bedrock LLM swap-in ──────────────────────────────────────────────────────

async def _bedrock_completion(
    prompt: str,
    model_id: str = "anthropic.claude-3-haiku-20240307-v1:0",
) -> str:
    """Call Amazon Bedrock Claude. Joins ALL content blocks (not just the first)."""
    try:
        import aiobotocore.session  # type: ignore[import]
        session = aiobotocore.session.get_session()
        async with session.create_client("bedrock-runtime") as br:
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            })
            resp = await br.invoke_model(modelId=model_id, body=body)
            payload = json.loads(await resp["body"].read())
            parts = [
                blk.get("text", "")
                for blk in (payload.get("content") or [])
                if blk.get("type") == "text"
            ]
            return "\n".join(parts)
    except Exception as e:
        log.error("Bedrock completion failed: %s", e)
        return ""


# ─── Route handlers ───────────────────────────────────────────────────────────

async def _handle_health(request_id: str) -> Dict[str, Any]:
    from .db import conn
    from .llm import _dead_providers, _rate_hits, _MAX_RATE_HITS

    db_ok = False
    db_latency_ms = None
    try:
        t0 = time.monotonic()
        async with conn() as c:
            if c:
                await c.fetchval("SELECT 1")
                db_ok = True
        db_latency_ms = int((time.monotonic() - t0) * 1000)
    except Exception as e:
        log.warning("[%s] Health DB check failed: %s", request_id, e)

    return _resp(200, {
        "status": "ok",
        "runtime": "lambda",
        "request_id": request_id,
        "db": {"ok": db_ok, "latency_ms": db_latency_ms},
        "llm": {
            "dead_providers": list(_dead_providers),
            "rate_hit_counts": dict(_rate_hits),
        },
    }, request_id)


async def _handle_distressed(body: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    from . import distressed
    log.info("[%s] distressed request zip=%s state=%s", request_id,
             body.get("zip"), body.get("state"))
    try:
        listings = await asyncio.wait_for(
            distressed.find_distressed(
                zip_code=body.get("zip", ""),
                county_key=body.get("county_key", ""),
                state=body.get("state", ""),
                categories=body.get("categories") or [],
            ),
            timeout=float(os.environ.get("LAMBDA_TIMEOUT_DISTRESSED", "840")),
        )
    except asyncio.TimeoutError:
        log.error("[%s] distressed timed out", request_id)
        return _err(504, "Distressed scrape timed out — try a narrower area", request_id)
    except Exception as e:
        err = str(e)
        if "429" in err or "rate" in err.lower():
            return _err(429, f"Rate limited: {err}", request_id)
        log.exception("[%s] distressed failed", request_id)
        return _err(500, err, request_id)

    job_id = f"distressed-{request_id[:12] if request_id else 'noid'}"
    await _store_s3(job_id, listings, request_id)
    return _resp(200, {"count": len(listings), "results": listings}, request_id)


async def _handle_cash_buyers(body: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    from . import cash_buyers
    lead = {
        "id": body.get("lead_id"),
        "address": body.get("address", ""),
        "zip": body.get("zip", ""),
        "city": body.get("city", ""),
        "state": body.get("state", ""),
    }
    log.info("[%s] cash-buyers request lead_id=%s", request_id, lead["id"])
    try:
        buyers = await asyncio.wait_for(
            cash_buyers.find_cash_buyers(lead, max_buyers=body.get("max_buyers", 50)),
            timeout=float(os.environ.get("LAMBDA_TIMEOUT_CASH_BUYERS", "600")),
        )
    except asyncio.TimeoutError:
        return _err(504, "Cash buyers search timed out", request_id)
    except Exception as e:
        err = str(e)
        if "429" in err or "rate" in err.lower():
            return _err(429, f"Rate limited: {err}", request_id)
        log.exception("[%s] cash-buyers failed", request_id)
        return _err(500, err, request_id)

    job_id = f"cash-buyers-{request_id[:12] if request_id else 'noid'}"
    await _store_s3(job_id, buyers, request_id)
    return _resp(200, {"count": len(buyers), "results": buyers}, request_id)


async def _handle_skip_trace(body: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    from . import skip_trace
    name = body.get("name", "")
    if not name:
        return _err(400, "name is required", request_id)
    log.info("[%s] skip-trace name=%s", request_id, name)
    try:
        result = await asyncio.wait_for(
            skip_trace.trace(
                name,
                llc=body.get("llc"),
                address=body.get("address"),
                state=body.get("state"),
            ),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        return _err(504, "Skip trace timed out", request_id)
    except Exception as e:
        log.exception("[%s] skip-trace failed", request_id)
        return _err(500, str(e), request_id)
    return _resp(200, result, request_id)


async def _handle_satellite(body: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    if USE_REKOGNITION:
        return _err(501, "Rekognition satellite mode not yet implemented", request_id)
    from .scrapers import satellite_dfd
    log.info("[%s] satellite city=%s state=%s", request_id, body.get("city"), body.get("state"))
    try:
        result = await asyncio.wait_for(
            satellite_dfd.analyze(
                city=body.get("city", ""),
                state=body.get("state", ""),
                zip_code=body.get("zip", ""),
                max_properties=body.get("max_properties", 20),
            ),
            timeout=float(os.environ.get("LAMBDA_TIMEOUT_SATELLITE", "600")),
        )
    except asyncio.TimeoutError:
        return _err(504, "Satellite analysis timed out", request_id)
    except Exception as e:
        err = str(e)
        if "429" in err or "rate" in err.lower():
            return _err(429, f"Rate limited: {err}", request_id)
        log.exception("[%s] satellite failed", request_id)
        return _err(500, err, request_id)
    return _resp(200, result, request_id)


# ─── Router ───────────────────────────────────────────────────────────────────

_ROUTES = {
    ("GET",  "/health"):             "_health",
    ("POST", "/health"):             "_health",
    ("POST", "/distressed"):         _handle_distressed,
    ("POST", "/scrape/distressed"):  _handle_distressed,
    ("POST", "/cash-buyers"):        _handle_cash_buyers,
    ("POST", "/scrape/cash-buyers"): _handle_cash_buyers,
    ("POST", "/skip-trace"):         _handle_skip_trace,
    ("POST", "/scrape/skip-trace"):  _handle_skip_trace,
    ("POST", "/satellite"):          _handle_satellite,
    ("POST", "/ai/satellite-dfd"):   _handle_satellite,
}


async def _dispatch(event: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    method = (
        event.get("httpMethod")
        or event.get("requestContext", {}).get("http", {}).get("method", "GET")
    ).upper()
    path = event.get("path") or event.get("rawPath") or "/"

    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64
        raw_body = base64.b64decode(raw_body).decode()
    try:
        body: Dict[str, Any] = json.loads(raw_body) if raw_body else {}
    except json.JSONDecodeError:
        body = {}

    handler = _ROUTES.get((method, path))
    if handler is None:
        return _err(404, f"No route for {method} {path}", request_id)
    if handler == "_health":
        return await _handle_health(request_id)
    return await handler(body, request_id)  # type: ignore[operator]


# ─── Lambda entrypoint ────────────────────────────────────────────────────────

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """AWS Lambda entrypoint.

    Uses asyncio.run() for a clean event loop per invocation.
    Logs aws_request_id on every call for CloudWatch traceability.
    """
    request_id: str = getattr(context, "aws_request_id", "") if context else ""
    log.info(
        "Lambda invoked: request_id=%s path=%s method=%s",
        request_id,
        event.get("path") or event.get("rawPath"),
        event.get("httpMethod"),
    )
    try:
        return asyncio.run(_dispatch(event, request_id))
    except asyncio.TimeoutError:
        log.error("[%s] Top-level asyncio.run timeout", request_id)
        return _err(504, "Handler timed out", request_id)
    except Exception as e:
        log.exception("[%s] Unhandled lambda error: %s", request_id, e)
        return _err(500, str(e), request_id)
