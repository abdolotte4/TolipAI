"""Fargate Spot interruption checkpointing — save and resume job progress via S3.

Problem
───────
  A Fargate Spot task gets SIGTERM with 120 seconds before hard termination.
  Without checkpointing, any long-running job (30-minute Propelio scrape, large
  distressed scan) is lost entirely and must restart from zero on the next
  container.

Solution
────────
  When SIGTERM fires, each active job writes a checkpoint to S3:
    s3://<SPOT_CHECKPOINT_BUCKET>/spot-checkpoints/<job_id>.json

  On the next container start, the app calls recover_checkpoints() which:
    1. Lists all checkpoint objects younger than MAX_CHECKPOINT_AGE_HOURS
    2. Re-queues each one into the retry queue with attempt=0
    3. Deletes the checkpoint so it doesn't re-queue again on subsequent restarts

  The checkpoint stores: job_id, job_type, params, progress (%), and any
  partial results accumulated so far — so the retry doesn't start from zero.

Integration
───────────
  Wire into spot_handler and main.py lifespan:

    # In lifespan startup:
    await spot_checkpoint.recover_checkpoints(retry_queue)

    # Register as a spot shutdown callback:
    from .spot_handler import on_shutdown
    on_shutdown(spot_checkpoint.flush_all_checkpoints)

  Then in each runner, call save_checkpoint() at progress milestones:

    await spot_checkpoint.save_checkpoint(
        job_id=job_id, job_type="cash_buyers",
        params=params, progress=pct, partial_result=results_so_far,
    )

Presigned URLs
──────────────
  Use presigned_download_url(key) to generate a time-limited direct-download
  URL for any S3 object.  Serve this to the client instead of proxying the
  bytes through your API — zero data transfer cost on the server side.
"""
from __future__ import annotations

import gzip
import io
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

log = logging.getLogger("spot_checkpoint")

_BUCKET = os.getenv("SPOT_CHECKPOINT_BUCKET") or os.getenv("S3_CACHE_BUCKET")
_PREFIX = os.getenv("SPOT_CHECKPOINT_PREFIX", "spot-checkpoints/")
_MAX_CHECKPOINT_AGE_HOURS = int(os.getenv("SPOT_CHECKPOINT_MAX_AGE_HOURS", "6"))

# In-memory store of the latest checkpoint per job_id.
# Flushed to S3 on SIGTERM.  Updated via save_checkpoint() at milestones.
_pending: Dict[str, Dict[str, Any]] = {}


# ── S3 helper ─────────────────────────────────────────────────────────────────

async def _s3_client():
    """Return a boto3 aioboto3 S3 client or None if aioboto3 is unavailable."""
    if not _BUCKET:
        return None
    try:
        import aioboto3  # type: ignore[import]
        session = aioboto3.Session()
        return session
    except ImportError:
        log.debug("spot_checkpoint: aioboto3 not installed — S3 checkpointing disabled")
        return None


def _checkpoint_key(job_id: str) -> str:
    return f"{_PREFIX}{job_id}.json.gz"


# ── Save a single checkpoint ──────────────────────────────────────────────────

async def save_checkpoint(
    job_id: str,
    job_type: str,
    params: Dict[str, Any],
    progress: int = 0,
    partial_result: Any = None,
) -> bool:
    """Write a gzip-compressed checkpoint to S3 and update the in-memory store.

    Call at meaningful progress milestones (every 10% or after each source
    completes) so that on spot resume the job doesn't start from zero.

    Returns True on success, False if S3 is unavailable (silently degrades).
    """
    checkpoint = {
        "job_id":        job_id,
        "job_type":      job_type,
        "params":        params,
        "progress":      progress,
        "partial_result": partial_result,
        "saved_at":      time.time(),
        "hostname":      os.uname().nodename if hasattr(os, "uname") else "unknown",
    }
    _pending[job_id] = checkpoint

    session = await _s3_client()
    if session is None:
        return False

    try:
        compressed = gzip.compress(
            json.dumps(checkpoint, default=str).encode(), compresslevel=6
        )
        key = _checkpoint_key(job_id)
        async with session.client("s3") as s3:
            await s3.put_object(
                Bucket=_BUCKET,
                Key=key,
                Body=compressed,
                ContentType="application/json",
                ContentEncoding="gzip",
                Metadata={
                    "job_id":   job_id,
                    "job_type": job_type,
                    "progress": str(progress),
                },
            )
        log.debug("spot_checkpoint: saved %s (progress=%d%%)", key, progress)
        return True
    except Exception as exc:
        log.warning("spot_checkpoint: S3 write failed for %s: %s", job_id, exc)
        return False


# ── Flush all pending checkpoints (called on SIGTERM) ────────────────────────

async def flush_all_checkpoints() -> None:
    """Write all in-memory checkpoints to S3. Called by spot_handler on SIGTERM.

    This is the last-chance write — it handles jobs that haven't hit a
    milestone save yet.  Runs concurrently for speed within the 120s window.
    """
    if not _pending:
        log.info("spot_checkpoint: no pending checkpoints to flush")
        return

    import asyncio
    jobs = list(_pending.items())
    log.info("spot_checkpoint: flushing %d checkpoint(s) to S3...", len(jobs))

    tasks = [
        save_checkpoint(
            job_id=cp["job_id"],
            job_type=cp["job_type"],
            params=cp["params"],
            progress=cp["progress"],
            partial_result=cp.get("partial_result"),
        )
        for _, cp in jobs
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    ok  = sum(1 for r in results if r is True)
    err = sum(1 for r in results if r is not True)
    log.info(
        "spot_checkpoint: flush complete — %d saved, %d failed",
        ok, err,
    )


# ── Recover checkpoints on startup ────────────────────────────────────────────

async def recover_checkpoints(retry_queue: Any) -> int:
    """On container startup, re-queue any checkpoint left by a previous Spot task.

    Args:
        retry_queue: The RetryQueue singleton from retry_queue.py.

    Returns:
        Number of jobs re-queued.
    """
    session = await _s3_client()
    if session is None:
        return 0

    cutoff = time.time() - (_MAX_CHECKPOINT_AGE_HOURS * 3600)
    recovered = 0

    try:
        async with session.client("s3") as s3:
            paginator = s3.get_paginator("list_objects_v2")
            pages = paginator.paginate(Bucket=_BUCKET, Prefix=_PREFIX)

            keys_to_recover: List[str] = []
            async for page in pages:
                for obj in page.get("Contents", []):
                    mod = obj["LastModified"].timestamp()
                    if mod >= cutoff:
                        keys_to_recover.append(obj["Key"])

            for key in keys_to_recover:
                try:
                    resp = await s3.get_object(Bucket=_BUCKET, Key=key)
                    body = await resp["Body"].read()
                    # Decompress
                    try:
                        data = json.loads(gzip.decompress(body))
                    except Exception:
                        data = json.loads(body)

                    job_id   = data["job_id"]
                    job_type = data["job_type"]
                    params   = data.get("params") or {}
                    progress = data.get("progress", 0)

                    # Re-queue with attempt=0 so it gets a fresh retry
                    queued = retry_queue.enqueue(
                        job_id, job_type, params,
                        attempt=0,
                        last_error=f"spot_interrupted at {progress}%",
                    )
                    if queued:
                        recovered += 1
                        log.info(
                            "spot_checkpoint: recovered job %s (%s, was %d%% done)",
                            job_id, job_type, progress,
                        )
                        # Delete checkpoint so it doesn't re-queue on next restart
                        await s3.delete_object(Bucket=_BUCKET, Key=key)
                    else:
                        log.warning(
                            "spot_checkpoint: could not re-queue %s (retry_queue rejected)",
                            job_id,
                        )
                except Exception as exc:
                    log.warning("spot_checkpoint: failed to recover %s: %s", key, exc)

    except Exception as exc:
        log.warning("spot_checkpoint: S3 list failed during recovery: %s", exc)

    if recovered:
        log.info(
            "spot_checkpoint: %d job(s) recovered and re-queued from previous Spot task",
            recovered,
        )
    else:
        log.debug("spot_checkpoint: no checkpoints to recover")

    return recovered


# ── Delete a specific checkpoint (call after job completes successfully) ──────

async def delete_checkpoint(job_id: str) -> None:
    """Remove a checkpoint once the job finishes successfully.

    If a job completes normally (not via Spot resume), its checkpoint should be
    cleaned up so it isn't accidentally re-queued on the next container start.
    """
    _pending.pop(job_id, None)

    session = await _s3_client()
    if session is None:
        return
    try:
        async with session.client("s3") as s3:
            await s3.delete_object(Bucket=_BUCKET, Key=_checkpoint_key(job_id))
        log.debug("spot_checkpoint: deleted checkpoint for completed job %s", job_id)
    except Exception as exc:
        log.debug("spot_checkpoint: delete failed for %s: %s", job_id, exc)


# ── Presigned download URL ────────────────────────────────────────────────────

async def presigned_download_url(
    key: str,
    *,
    expires_in: int = 3600,
    bucket: Optional[str] = None,
) -> Optional[str]:
    """Generate a presigned S3 GET URL for direct client download.

    The client downloads directly from S3 — zero data transfer cost on your
    API server.  Use for CSV exports, large JSON results, screenshots, etc.

    Args:
        key:        S3 object key (e.g. "exports/job-abc123-buyers.csv.gz")
        expires_in: URL lifetime in seconds (default 1 hour)
        bucket:     Override bucket (defaults to S3_CACHE_BUCKET / SPOT_CHECKPOINT_BUCKET)

    Returns:
        A presigned HTTPS URL string, or None if S3 is unavailable.
    """
    b = bucket or _BUCKET
    if not b:
        return None

    session = await _s3_client()
    if session is None:
        return None

    try:
        async with session.client("s3") as s3:
            url = await s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": b, "Key": key},
                ExpiresIn=expires_in,
            )
        return url
    except Exception as exc:
        log.warning("spot_checkpoint.presigned_download_url failed for %s: %s", key, exc)
        return None


# ── CSV compression helper ────────────────────────────────────────────────────

def compress_csv(csv_text: str) -> bytes:
    """Gzip-compress a CSV string before S3 upload.

    A 10 MB CSV → ~1.5 MB gzipped = 85% bandwidth and storage reduction.
    Set Content-Encoding: gzip on the S3 object; browsers decompress
    automatically when served via presigned URL.

    Usage:
        compressed = compress_csv(csv_content)
        async with session.client("s3") as s3:
            await s3.put_object(
                Bucket=bucket, Key="exports/result.csv.gz",
                Body=compressed,
                ContentType="text/csv",
                ContentEncoding="gzip",
            )
        url = await presigned_download_url("exports/result.csv.gz")
    """
    return gzip.compress(csv_text.encode("utf-8"), compresslevel=6)


async def upload_compressed_csv(
    csv_text: str,
    key: str,
    *,
    bucket: Optional[str] = None,
    expires_in: int = 3600,
) -> Optional[str]:
    """Gzip-compress a CSV and upload to S3, returning a presigned download URL.

    Returns the presigned URL string, or None if S3 is unavailable.
    """
    b = bucket or _BUCKET
    if not b:
        return None

    session = await _s3_client()
    if session is None:
        return None

    compressed = compress_csv(csv_text)
    gzip_key   = key if key.endswith(".gz") else f"{key}.gz"

    try:
        async with session.client("s3") as s3:
            await s3.put_object(
                Bucket=b,
                Key=gzip_key,
                Body=compressed,
                ContentType="text/csv",
                ContentEncoding="gzip",
            )
        log.info(
            "spot_checkpoint: uploaded %s (%.1f KB → %.1f KB compressed)",
            gzip_key,
            len(csv_text.encode()) / 1024,
            len(compressed) / 1024,
        )
        return await presigned_download_url(gzip_key, expires_in=expires_in, bucket=b)
    except Exception as exc:
        log.warning("spot_checkpoint.upload_compressed_csv failed for %s: %s", gzip_key, exc)
        return None
