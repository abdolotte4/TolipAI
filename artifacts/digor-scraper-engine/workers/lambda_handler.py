"""AWS Lambda entry point for the TolipAI Scraper Engine.

Each Lambda function maps to a specific scraper endpoint.
The handler deserialises the API Gateway event, calls the appropriate
FastAPI route logic directly (bypassing HTTP), and returns a Lambda-
compatible response.

Deployment notes:
  - Set LAMBDA_ENV=1 to activate Lambda-specific paths.
  - Build with:  docker build -f Dockerfile.lambda -t digor-scraper-lambda .
  - Upload the image to ECR and wire it to API Gateway v2 (HTTP API).
  - Set the same environment variables used by Railway (see replit.md).
  - For YOLO / Playwright-heavy endpoints, set Memory=3008MB, Timeout=300s.
  - For lightweight endpoints (distressed_sources, health), 512MB / 30s is fine.

AWS service swap-ins (activate by setting the corresponding env var):
  - YOLO: set USE_REKOGNITION=1  → satellite_dfd uses AWS Rekognition instead of local YOLO
  - LLM:  set USE_BEDROCK=1      → llm.py routes through Amazon Bedrock (Claude 3 Sonnet)
  - DB:   set DATABASE_URL to an RDS/Aurora Postgres connection string
  - Files:set S3_BUCKET to an S3 bucket name for storing scraped results
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, Dict

log = logging.getLogger("lambda_handler")
logging.basicConfig(level=logging.INFO)


def _ok(body: Any, status: int = 200, *, request_id: str | None = None) -> Dict[str, Any]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if request_id:
        headers["X-Request-Id"] = request_id
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps(body, default=str),
    }


def _err(msg: str, status: int = 500, *, request_id: str | None = None) -> Dict[str, Any]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if request_id:
        headers["X-Request-Id"] = request_id
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps({"error": msg}),
    }


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    raw = event.get("body") or "{}"
    if isinstance(raw, str):
        return json.loads(raw)
    return raw or {}


def _classify_exc(exc: Exception) -> int:
    """Map common exception types to HTTP status codes."""
    name = type(exc).__name__.lower()
    msg  = str(exc).lower()
    if "timeout" in name or "timeout" in msg:
        return 504
    if "ratelimit" in name or "rate limit" in msg or "429" in msg or "too many" in msg:
        return 429
    if "notfound" in name or "not found" in msg or "404" in msg:
        return 404
    return 500


# ─── Health check ─────────────────────────────────────────────────────────────

async def _db_ping() -> tuple[bool, float]:
    """Lightweight Aurora/RDS probe — returns (ok, latency_ms)."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return False, 0.0
    try:
        import asyncpg  # type: ignore[import]
        t0 = time.monotonic()
        conn = await asyncpg.connect(db_url)
        await conn.execute("SELECT 1")
        await conn.close()
        return True, round((time.monotonic() - t0) * 1000, 1)
    except Exception:
        return False, 0.0


def health_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    req_id = getattr(context, "aws_request_id", None)
    log.info("Request %s: health_handler started", req_id)
    db_ok, db_ms = asyncio.run(_db_ping())
    return _ok({
        "status": "ok",
        "env": "lambda",
        "bright_data":     bool(os.getenv("BRIGHTDATA_USERNAME")),
        "groq":            bool(os.getenv("GROQ_API_KEY")),
        "db":              db_ok,
        "db_latency_ms":   db_ms,
        "use_rekognition": os.getenv("USE_REKOGNITION") == "1",
        "use_bedrock":     os.getenv("USE_BEDROCK") == "1",
        "s3_bucket":       os.getenv("S3_BUCKET"),
    }, request_id=req_id)


# ─── Distressed search ────────────────────────────────────────────────────────

def distressed_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /distressed/search — start an async distressed-property scrape job."""
    from .distressed import run_distressed_search

    req_id = getattr(context, "aws_request_id", None)
    log.info("Request %s: distressed_handler started", req_id)

    body       = _parse_body(event)
    zip_code   = body.get("zip") or ""
    county_key = body.get("countyKey") or ""
    state      = body.get("state") or ""
    categories = body.get("categories") or []

    if not (zip_code or county_key or state):
        return _err("zip, countyKey, or state is required", 400, request_id=req_id)

    job_id = str(uuid.uuid4())
    try:
        result = asyncio.run(
            run_distressed_search(
                zip_code=zip_code,
                county_key=county_key,
                state=state,
                categories=categories,
            )
        )
        _maybe_store_s3("distressed", result, job_id=job_id, request_id=req_id)
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: distressed_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── Cash buyer discovery ─────────────────────────────────────────────────────

def cash_buyers_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /cash-buyers — find cash buyers for a given lead."""
    from .cash_buyers import find_cash_buyers

    req_id = getattr(context, "aws_request_id", None)
    log.info("Request %s: cash_buyers_handler started", req_id)

    body = _parse_body(event)
    lead = body.get("lead") or body
    if not lead.get("zip") and not lead.get("city"):
        return _err("lead.zip or lead.city is required", 400, request_id=req_id)

    job_id = str(uuid.uuid4())
    try:
        buyers = asyncio.run(
            find_cash_buyers(lead, max_buyers=int(body.get("maxBuyers", 50)))
        )
        _maybe_store_s3("cash_buyers", buyers, job_id=job_id, request_id=req_id)
        return _ok({"buyers": buyers, "count": len(buyers)}, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: cash_buyers_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── Skip trace ───────────────────────────────────────────────────────────────

def skip_trace_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /skip-trace — OSINT skip-trace a name/LLC."""
    from .skip_trace import trace as skip_trace

    req_id = getattr(context, "aws_request_id", None)
    log.info("Request %s: skip_trace_handler started", req_id)

    body = _parse_body(event)
    name = body.get("name") or body.get("owner_name")
    if not name:
        return _err("name is required", 400, request_id=req_id)

    try:
        result = asyncio.run(
            skip_trace(name, llc=body.get("llc"), state=body.get("state"))
        )
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: skip_trace_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── SkyDrive / Satellite AI ──────────────────────────────────────────────────

def satellite_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /satellite — satellite drive-for-dollars distress scoring."""
    req_id = getattr(context, "aws_request_id", None)
    log.info("Request %s: satellite_handler started", req_id)

    if os.getenv("USE_REKOGNITION") == "1":
        from .scrapers.satellite_rekognition import run_rekognition_dfd as run_dfd
    else:
        from .scrapers.satellite_dfd import scan_area as run_dfd  # type: ignore[no-redef]

    body   = _parse_body(event)
    params = {
        "zip_code":       body.get("zip") or body.get("zip_code") or "",
        "city":           body.get("city") or "",
        "state":          body.get("state") or "",
        "min_score":      int(body.get("min_score", 30)),
        "max_results":    int(body.get("maxResults", body.get("max_results", 50))),
        "use_ai_scoring": bool(body.get("use_ai_scoring", True)),
    }
    if not (params["zip_code"] or params["city"]):
        return _err("zip or city is required", 400, request_id=req_id)

    job_id = str(uuid.uuid4())
    try:
        result = asyncio.run(run_dfd(**params))
        _maybe_store_s3("satellite", result, job_id=job_id, request_id=req_id)
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: satellite_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── S3 result storage (optional) ────────────────────────────────────────────

def _maybe_store_s3(
    prefix: str,
    data: Any,
    *,
    job_id: str | None = None,
    request_id: str | None = None,
) -> None:
    """Persist result JSON to S3 if S3_BUCKET is configured.

    Key format: prefix/YYYY/MM/DD/HHMMSS_<job_id>_<request_id>.json
    The job_id and request_id suffixes prevent collisions when multiple jobs
    finish within the same second.
    """
    bucket = os.getenv("S3_BUCKET")
    if not bucket:
        return
    try:
        import boto3  # type: ignore[import]
        from datetime import datetime, timezone
        ts      = datetime.now(timezone.utc).strftime("%Y/%m/%d/%H%M%S")
        suffix  = "_".join(filter(None, [job_id, request_id])) or "result"
        key     = f"{prefix}/{ts}_{suffix}.json"
        boto3.client("s3").put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(data, default=str).encode(),
            ContentType="application/json",
        )
        log.info("Stored result to s3://%s/%s", bucket, key)
    except Exception as exc:
        log.warning("S3 store failed (non-fatal): %s", exc)


# ─── Amazon Bedrock LLM swap-in ───────────────────────────────────────────────

async def _bedrock_chat(messages: list, *, max_tokens: int = 1500) -> str:
    """Replace Groq/Cerebras with Amazon Bedrock Claude when USE_BEDROCK=1."""
    import boto3, json as _json  # type: ignore[import]
    client = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "us-east-1"))
    body = _json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
    })
    resp = client.invoke_model(
        modelId=os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0"),
        body=body,
        contentType="application/json",
        accept="application/json",
    )
    out = _json.loads(resp["body"].read())
    return " ".join(c["text"] for c in out.get("content", []) if "text" in c)


# ─── Router — single Lambda that dispatches by path ──────────────────────────

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Universal router — wire this to API Gateway HTTP API (ANY /{proxy+})."""
    req_id = getattr(context, "aws_request_id", None)
    path   = (event.get("rawPath") or event.get("path") or "/").rstrip("/") or "/"
    method = (event.get("requestContext", {}).get("http", {}).get("method")
              or event.get("httpMethod") or "GET").upper()

    log.info("Request %s: routing %s %s", req_id, method, path)

    routes = {
        ("/health",            "GET"):  health_handler,
        ("/distressed/search", "POST"): distressed_handler,
        ("/cash-buyers",       "POST"): cash_buyers_handler,
        ("/skip-trace",        "POST"): skip_trace_handler,
        ("/satellite",         "POST"): satellite_handler,
    }

    fn = routes.get((path, method))
    if fn is None:
        return _err(f"No route for {method} {path}", 404, request_id=req_id)

    return fn(event, context)
