"""AWS Rekognition back-end for the satellite Drive-For-Dollars scorer.

Activated when USE_REKOGNITION=1 is set in the Lambda/ECS environment.
Replaces Google Cloud Vision with Amazon Rekognition DetectLabels,
so no on-instance GPU or large model weights are needed.

The public API surface is identical to satellite_dfd.scan_area() so the
lambda_handler can swap in this module transparently.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

log = logging.getLogger("satellite_rekognition")

# ── Rekognition label → distress signal mapping ──────────────────────────────
# Maps Rekognition DetectLabels names to the same signal keys used by
# satellite_dfd.py so downstream scoring logic is reused unchanged.
_LABEL_SIGNAL_MAP: Dict[str, str] = {
    "Overgrown": "overgrown_vegetation",
    "Weed": "overgrown_vegetation",
    "Dead Plant": "overgrown_vegetation",
    "Damaged": "structural_damage",
    "Broken": "structural_damage",
    "Crack": "structural_damage",
    "Graffiti": "graffiti",
    "Tarp": "tarp_roof",
    "Boarded": "boarded_windows",
    "Roof Damage": "structural_damage",
    "Debris": "debris_clutter",
    "Junk": "debris_clutter",
    "Abandoned": "abandonment_signs",
    "Foreclosure": "abandonment_signs",
    "Fence Damage": "structural_damage",
    "Broken Window": "boarded_windows",
    "Peeling Paint": "deferred_maintenance",
    "Rust": "deferred_maintenance",
}

# Confidence threshold for accepting a Rekognition label
_MIN_CONFIDENCE = 65.0


def _boto3_rek_client():
    """Lazy singleton Rekognition client."""
    import boto3  # type: ignore[import]

    return boto3.client(
        "rekognition",
        region_name=os.getenv("AWS_REGION", "us-east-1"),
    )


def _analyse_url_sync(image_url: str) -> Dict[str, Any]:
    """Call Rekognition DetectLabels on a public image URL.

    Rekognition can analyse images directly from S3 or public URLs via
    the Bytes path (download first then send).  Since Google Static Maps
    and Streetview URLs are public, we download the image bytes first.
    """
    import urllib.request

    signals: Dict[str, Any] = {}
    try:
        with urllib.request.urlopen(image_url, timeout=10) as resp:
            image_bytes = resp.read()

        rek = _boto3_rek_client()
        response = rek.detect_labels(
            Image={"Bytes": image_bytes},
            MaxLabels=40,
            MinConfidence=_MIN_CONFIDENCE,
        )

        detected_labels = {label["Name"]: label["Confidence"] for label in response.get("Labels", [])}

        for label_name, signal_key in _LABEL_SIGNAL_MAP.items():
            if label_name in detected_labels:
                confidence = detected_labels[label_name]
                # Only flag if not already set (take highest confidence)
                if signal_key not in signals or signals[signal_key] < confidence:
                    signals[signal_key] = round(confidence, 1)

        signals["_raw_labels"] = list(detected_labels.keys())

    except Exception as exc:
        log.warning("Rekognition analysis failed for %s: %s", image_url[:80], exc)

    return signals


async def _analyse_url(image_url: str) -> Dict[str, Any]:
    """Async wrapper — runs the sync Rekognition call in a thread executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _analyse_url_sync, image_url)


# ── Public API — mirrors satellite_dfd.scan_area() signature exactly ─────────


async def run_rekognition_dfd(
    zip_code: str = "",
    city: str = "",
    state: str = "",
    min_score: int = 30,
    max_results: int = 50,
    use_ai_scoring: bool = True,
) -> Dict[str, Any]:
    """Drive-For-Dollars scan using AWS Rekognition for visual analysis.

    Falls back to satellite_dfd.scan_area() for the non-visual scoring
    components (property data fetching, text-based signals, scoring math).
    The visual_signals dict from GCV is replaced with Rekognition output.
    """
    # Delegate the full pipeline to satellite_dfd; we only override the
    # visual analysis step via the rekognition flag in the environment.
    from .satellite_dfd import scan_area

    log.info(
        "Rekognition DFD: zip=%s city=%s — delegating to satellite_dfd with Rekognition signals",
        zip_code,
        city,
    )

    # satellite_dfd._gcv_signals_from_url() is already guarded by USE_REKOGNITION;
    # call scan_area normally — USE_REKOGNITION must be set in the environment.
    result = await scan_area(
        zip_code=zip_code,
        city=city,
        state=state,
        min_score=min_score,
        max_results=max_results,
        use_ai_scoring=use_ai_scoring,
    )
    return result


async def analyse_property_images(
    satellite_url: Optional[str] = None,
    streetview_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Analyse a single property's satellite + street-view images with Rekognition.

    Returns a merged signals dict.  Useful as a standalone Lambda call
    when a property URL is already known (no need to re-scan a whole zip).
    """
    urls = [u for u in (satellite_url, streetview_url) if u]
    if not urls:
        return {}

    results = await asyncio.gather(*[_analyse_url(u) for u in urls])

    merged: Dict[str, Any] = {}
    raw_labels: List[str] = []
    for r in results:
        raw_labels.extend(r.pop("_raw_labels", []))
        for k, v in r.items():
            if k not in merged or merged[k] < v:
                merged[k] = v

    merged["_raw_labels"] = list(set(raw_labels))
    return merged
