"""AWS Lambda entry point for the TolipAI Scraper Engine.

Each Lambda function maps to a specific scraper endpoint.
The handler deserialises the API Gateway event, calls the appropriate
route logic directly (bypassing HTTP), and returns a Lambda-
compatible response.

Deployment notes:
  - Build with:  docker build -f Dockerfile.lambda -t tolipai-scraper-lambda .
  - Push image to ECR and wire to API Gateway v2 (HTTP API) or Lambda Function URL.
  - Set the same environment variables used by Railway (see README.md).
  - Memory recommendations per endpoint:
      /health, /distressed/search          → 512 MB,  Timeout 30 s
      /satellite, /cash-buyers             → 2048 MB, Timeout 120 s
      /propwire/*, /propelio/*             → 3008 MB, Timeout 300 s
  - BROWSER_STATE_DIR is automatically set to /tmp inside Lambda.

AWS service swap-ins (activate by setting the env var):
  - YOLO: USE_REKOGNITION=1  → satellite uses AWS Rekognition instead of local YOLO
  - LLM:  USE_BEDROCK=1      → llm.py routes through Amazon Bedrock (Claude 3 Sonnet)
  - DB:   DATABASE_URL       → RDS/Aurora Postgres connection string
  - Files:S3_BUCKET          → S3 bucket for storing scraped results as JSON
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

log = logging.getLogger("lambda_handler")
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s %(message)s",
)

# ── Lambda-specific environment setup ────────────────────────────────────────
# Store Playwright browser session state in /tmp (only writable dir in Lambda)
os.environ.setdefault("BROWSER_STATE_DIR", "/tmp")
# Playwright looks for its browser installation here inside the container image
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/ms-playwright")


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _ok(body: Any, status: int = 200, *, request_id: Optional[str] = None) -> Dict[str, Any]:
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key",
    }
    if request_id:
        headers["X-Request-Id"] = request_id
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps(body, default=str),
    }


def _err(msg: str, status: int = 500, *, request_id: Optional[str] = None) -> Dict[str, Any]:
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    }
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
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return raw or {}


def _classify_exc(exc: Exception) -> int:
    """Map common exception types to HTTP status codes."""
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    if "timeout" in name or "timeout" in msg:
        return 504
    if "ratelimit" in name or "rate limit" in msg or "429" in msg or "too many" in msg:
        return 429
    if "notfound" in name or "not found" in msg or "404" in msg:
        return 404
    if "unauthorized" in msg or "auth" in msg or "401" in msg:
        return 401
    return 500


def _run_async(coro) -> Any:
    """Run an async coroutine safely from a Lambda sync handler.

    Lambda may or may not have a running event loop depending on the runtime
    version.  asyncio.run() creates a fresh loop, but fails if one already
    exists.  This wrapper handles both cases.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Already inside a loop (e.g., async Lambda runtime or test) —
            # schedule the coroutine and wait using a thread executor.
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result(timeout=600)
        return loop.run_until_complete(coro)
    except RuntimeError:
        # No event loop at all — create one fresh
        return asyncio.run(coro)


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
    db_ok, db_ms = _run_async(_db_ping())
    return _ok(
        {
            "status": "ok",
            "env": "lambda",
            "bright_data": bool(os.getenv("BRIGHTDATA_USERNAME")),
            "groq": bool(os.getenv("GROQ_API_KEY")),
            "google_cloud": bool(os.getenv("GOOGLE_CLOUD_API_KEY")),
            "db": db_ok,
            "db_latency_ms": db_ms,
            "use_rekognition": os.getenv("USE_REKOGNITION") == "1",
            "use_bedrock": os.getenv("USE_BEDROCK") == "1",
            "s3_bucket": os.getenv("S3_BUCKET"),
            "browser_state_dir": os.getenv("BROWSER_STATE_DIR", "/tmp"),
        },
        request_id=req_id,
    )


# ─── Warmup ──────────────────────────────────────────────────────────────────


def warmup_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Scheduled EventBridge ping to keep the Lambda container warm.

    Call this from a CloudWatch Events rule every 5 minutes on heavyweight
    endpoints (propwire, propelio, satellite) to avoid cold-start delays.
    """
    log.info("Warmup ping received — container is warm")
    return _ok({"warmed": True, "ts": time.time()})


# ─── Distressed search ────────────────────────────────────────────────────────


def distressed_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /distressed/search — run a distressed-property scrape."""
    from .distressed import find_distressed  # correct function name

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    zip_code = body.get("zip") or ""
    county_key = body.get("countyKey") or ""
    state = body.get("state") or ""
    categories = body.get("categories") or []
    source_keys = body.get("sourceKeys") or []

    if not (zip_code or county_key or state):
        return _err("zip, countyKey, or state is required", 400, request_id=req_id)

    log.info("Request %s: distressed_handler state=%s zip=%s", req_id, state, zip_code)
    job_id = str(uuid.uuid4())
    try:
        result = _run_async(
            find_distressed(
                zip_code=zip_code,
                county_key=county_key,
                state=state,
                categories=categories or None,
                source_keys=source_keys or None,
                job_id=job_id,
            )
        )
        _maybe_store_s3("distressed", result, job_id=job_id, request_id=req_id)
        return _ok(
            {"count": len(result), "listings": result, "job_id": job_id},
            request_id=req_id,
        )
    except Exception as exc:
        log.exception("Request %s: distressed_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── Cash buyer discovery ─────────────────────────────────────────────────────


def cash_buyers_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /cash-buyers — find cash buyers for a given lead."""
    from .cash_buyers import find_cash_buyers

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    lead = body.get("lead") or body
    if not lead.get("zip") and not lead.get("city"):
        return _err("lead.zip or lead.city is required", 400, request_id=req_id)

    log.info("Request %s: cash_buyers_handler", req_id)
    job_id = str(uuid.uuid4())
    try:
        buyers = _run_async(find_cash_buyers(lead, max_buyers=int(body.get("maxBuyers", 50))))
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
    body = _parse_body(event)
    name = body.get("name") or body.get("owner_name")
    if not name:
        return _err("name is required", 400, request_id=req_id)

    log.info("Request %s: skip_trace_handler name=%s", req_id, name[:50])
    try:
        result = _run_async(skip_trace(name, llc=body.get("llc"), state=body.get("state")))
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: skip_trace_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── Satellite / Drive-for-Dollars AI ─────────────────────────────────────────


def satellite_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /satellite — satellite drive-for-dollars distress scoring."""
    req_id = getattr(context, "aws_request_id", None)

    if os.getenv("USE_REKOGNITION") == "1":
        from .scrapers.satellite_rekognition import run_rekognition_dfd as run_dfd
    else:
        from .scrapers.satellite_dfd import scan_area as run_dfd  # type: ignore[assignment]

    body = _parse_body(event)
    params = {
        "zip_code": body.get("zip") or body.get("zip_code") or "",
        "city": body.get("city") or "",
        "state": body.get("state") or "",
        "min_score": int(body.get("min_score", 30)),
        "max_results": int(body.get("maxResults", body.get("max_results", 50))),
        "use_ai_scoring": bool(body.get("use_ai_scoring", True)),
    }
    if not (params["zip_code"] or params["city"]):
        return _err("zip or city is required", 400, request_id=req_id)

    log.info(
        "Request %s: satellite_handler zip=%s city=%s",
        req_id,
        params["zip_code"],
        params["city"],
    )
    job_id = str(uuid.uuid4())
    try:
        result = _run_async(run_dfd(**params))  # type: ignore[arg-type]
        _maybe_store_s3("satellite", result, job_id=job_id, request_id=req_id)
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: satellite_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── Propwire endpoints ───────────────────────────────────────────────────────


def propwire_property_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /propwire/property — full property detail from Propwire."""
    from .scrapers.propwire import fetch_property

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    query = body.get("query") or body.get("address") or body.get("url") or ""
    if not query:
        return _err("query (address or Propwire URL) is required", 400, request_id=req_id)

    log.info("Request %s: propwire_property_handler query=%s", req_id, query[:80])
    try:
        result = _run_async(fetch_property(query))
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: propwire_property_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


def propwire_comps_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /propwire/comps — comparable sales from Propwire."""
    from .scrapers.propwire import fetch_comps

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    query = body.get("query") or body.get("address") or body.get("url") or ""
    if not query:
        return _err("query is required", 400, request_id=req_id)

    log.info("Request %s: propwire_comps_handler", req_id)
    try:
        comps = _run_async(fetch_comps(query, max_results=int(body.get("maxResults", 50))))
        return _ok({"comps": comps, "count": len(comps)}, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: propwire_comps_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


def propwire_history_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /propwire/history — sale + mortgage history from Propwire."""
    from .scrapers.propwire import fetch_history

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    query = body.get("query") or body.get("address") or body.get("url") or ""
    if not query:
        return _err("query is required", 400, request_id=req_id)

    log.info("Request %s: propwire_history_handler", req_id)
    try:
        result = _run_async(fetch_history(query))
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: propwire_history_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


def propwire_cash_buyers_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /propwire/cash-buyers — nearby cash buyers from Propwire."""
    from .scrapers.propwire import fetch_cash_buyers_nearby

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    query = body.get("query") or body.get("address") or body.get("url") or ""
    if not query:
        return _err("query is required", 400, request_id=req_id)

    log.info("Request %s: propwire_cash_buyers_handler", req_id)
    try:
        buyers = _run_async(
            fetch_cash_buyers_nearby(
                query,
                max_results=int(body.get("maxResults", 100)),
                radius_miles=float(body.get("radiusMiles", 5.0)),
            )
        )
        return _ok({"buyers": buyers, "count": len(buyers)}, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: propwire_cash_buyers_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── Propelio endpoints ───────────────────────────────────────────────────────


def propelio_comps_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /propelio/comps — comparable sales from Propelio."""
    from .scrapers.propelio_v2 import search_property, fetch_comps

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    address = body.get("address") or ""
    if not address:
        return _err("address is required", 400, request_id=req_id)

    log.info("Request %s: propelio_comps_handler address=%s", req_id, address[:80])
    try:

        async def _run():
            meta = await search_property(address)
            prop_id = meta.get("property_id")
            if not prop_id:
                return {"comps": [], "address": address}
            comps = await fetch_comps(
                prop_id,
                radius_miles=float(body.get("radiusMiles", 0.5)),
                max_results=int(body.get("maxResults", 25)),
            )
            return {"comps": comps, "count": len(comps), "address": address}

        result = _run_async(_run())
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: propelio_comps_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


def propelio_cash_buyers_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /propelio/cash-buyers — cash buyers from Propelio."""
    from .scrapers.propelio_v2 import cash_buyers_for_address

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    address = body.get("address") or ""
    if not address:
        return _err("address is required", 400, request_id=req_id)

    log.info("Request %s: propelio_cash_buyers_handler address=%s", req_id, address[:80])
    try:
        result = _run_async(
            cash_buyers_for_address(
                address,
                max_results=int(body.get("maxResults", 100)),
                distance_miles=int(body.get("distanceMiles", 10)),
                active_within=body.get("activeWithin", "6_MONTHS"),
            )
        )
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: propelio_cash_buyers_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


def propelio_arv_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """POST /propelio/arv — ARV estimate from Propelio comps."""
    from .scrapers.propelio_v2 import estimate_arv

    req_id = getattr(context, "aws_request_id", None)
    body = _parse_body(event)
    address = body.get("address") or ""
    if not address:
        return _err("address is required", 400, request_id=req_id)

    log.info("Request %s: propelio_arv_handler address=%s", req_id, address[:80])
    try:
        result = _run_async(
            estimate_arv(
                address,
                radius_miles=float(body.get("radiusMiles", 0.5)),
            )
        )
        return _ok(result, request_id=req_id)
    except Exception as exc:
        log.exception("Request %s: propelio_arv_handler failed", req_id)
        return _err(str(exc), _classify_exc(exc), request_id=req_id)


# ─── S3 result storage (optional) ────────────────────────────────────────────


def _maybe_store_s3(
    prefix: str,
    data: Any,
    *,
    job_id: Optional[str] = None,
    request_id: Optional[str] = None,
) -> None:
    """Persist result JSON to S3 if S3_BUCKET is configured.

    Key: prefix/YYYY/MM/DD/HHMMSS_<job_id>.json
    """
    bucket = os.getenv("S3_BUCKET")
    if not bucket:
        return
    try:
        import boto3  # type: ignore[import]
        from datetime import datetime, timezone

        ts = datetime.now(timezone.utc).strftime("%Y/%m/%d/%H%M%S")
        suffix = "_".join(filter(None, [job_id, request_id])) or "result"
        key = f"{prefix}/{ts}_{suffix}.json"
        boto3.client("s3").put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(data, default=str).encode(),
            ContentType="application/json",
        )
        log.info("Stored result to s3://%s/%s", bucket, key)
    except Exception as exc:
        log.warning("S3 store failed (non-fatal): %s", exc)


# ─── Amazon Bedrock LLM integration ──────────────────────────────────────────


async def _bedrock_chat(messages: List[Dict[str, Any]], *, max_tokens: int = 1500) -> str:
    """Call Amazon Bedrock Claude when USE_BEDROCK=1.

    This is wired into llm._chat_inner() at startup by patching the provider
    list when USE_BEDROCK is set, so callers never need to change their code.
    """
    import boto3  # type: ignore[import]
    import json as _json
    import asyncio

    def _invoke_sync() -> str:
        client = boto3.client(
            "bedrock-runtime",
            region_name=os.getenv("AWS_REGION", "us-east-1"),
        )
        body = _json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "messages": [
                    {"role": m["role"], "content": m.get("content", "")}
                    for m in messages
                    if m.get("role") in ("user", "assistant")
                ],
            }
        )
        resp = client.invoke_model(
            modelId=os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0"),
            body=body,
            contentType="application/json",
            accept="application/json",
        )
        out = _json.loads(resp["body"].read())
        return " ".join(c["text"] for c in out.get("content", []) if "text" in c)

    # boto3 is sync — run in a thread executor so we don't block the event loop
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _invoke_sync)


def _patch_llm_for_bedrock() -> None:
    """Prepend a Bedrock provider to llm._chat_inner when USE_BEDROCK=1.

    Called once at module init time. Monkey-patches the LLM provider list
    so all existing callers (distressed.py, cash_buyers.py, etc.) transparently
    route through Bedrock without any code changes.
    """
    if os.getenv("USE_BEDROCK") != "1":
        return
    try:
        from . import llm as _llm

        _orig_chat_inner = _llm._chat_inner

        async def _bedrock_first(messages, *, json_mode=True, temperature=0.2, max_tokens=1500):
            try:
                log.info("LLM: routing through Amazon Bedrock")
                return await _bedrock_chat(messages, max_tokens=max_tokens)
            except Exception as exc:
                log.warning("Bedrock failed (%s), falling back to provider chain", exc)
                return await _orig_chat_inner(
                    messages,
                    json_mode=json_mode,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

        _llm._chat_inner = _bedrock_first  # type: ignore[assignment]
        log.info("LLM patched: Amazon Bedrock is primary provider")
    except Exception as exc:
        log.warning("Could not patch LLM for Bedrock: %s", exc)


# Patch at import time so any subsequent handler invocation uses Bedrock
_patch_llm_for_bedrock()


# ─── CORS preflight ──────────────────────────────────────────────────────────


def options_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Handle OPTIONS preflight requests from API Gateway."""
    return {
        "statusCode": 200,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key",
            "Access-Control-Max-Age": "86400",
        },
        "body": "",
    }


# ─── Universal router ─────────────────────────────────────────────────────────

_ROUTES: Dict[tuple, Any] = {
    ("/health", "GET"): health_handler,
    ("/_warmup", "POST"): warmup_handler,
    ("/distressed/search", "POST"): distressed_handler,
    ("/cash-buyers", "POST"): cash_buyers_handler,
    ("/skip-trace", "POST"): skip_trace_handler,
    ("/satellite", "POST"): satellite_handler,
    ("/propwire/property", "POST"): propwire_property_handler,
    ("/propwire/comps", "POST"): propwire_comps_handler,
    ("/propwire/history", "POST"): propwire_history_handler,
    ("/propwire/cash-buyers", "POST"): propwire_cash_buyers_handler,
    ("/propelio/comps", "POST"): propelio_comps_handler,
    ("/propelio/cash-buyers", "POST"): propelio_cash_buyers_handler,
    ("/propelio/arv", "POST"): propelio_arv_handler,
}


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Universal router — wire this to API Gateway HTTP API (ANY /{proxy+})."""
    req_id = getattr(context, "aws_request_id", None)
    path = (event.get("rawPath") or event.get("path") or "/").rstrip("/") or "/"
    method = (event.get("requestContext", {}).get("http", {}).get("method") or event.get("httpMethod") or "GET").upper()

    # Handle CORS preflight globally
    if method == "OPTIONS":
        return options_handler(event, context)

    # EventBridge scheduled warmup event
    if event.get("source") == "aws.events":
        return warmup_handler(event, context)

    log.info("Request %s: routing %s %s", req_id, method, path)

    fn = _ROUTES.get((path, method))
    if fn is None:
        available = [f"{m} {p}" for (p, m) in _ROUTES]
        return _err(
            f"No route for {method} {path}. Available: {available}",
            404,
            request_id=req_id,
        )

    return fn(event, context)
