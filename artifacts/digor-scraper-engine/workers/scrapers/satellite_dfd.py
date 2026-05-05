"""Satellite Drive-For-Dollars engine.

Fuses property signals + Google Maps imagery + YOLO visual detections +
LLM reasoning to score property distress 0-100.
"""

from __future__ import annotations
import asyncio, json, logging, os, httpx
from typing import Any, Dict, List, Optional

try:
    from ultralytics import YOLO as _YOLO_CLASS
    _YOLO_AVAILABLE = True
except ImportError:
    _YOLO_CLASS = None  # type: ignore
    _YOLO_AVAILABLE = False

from ..http_client import fetch_html
from ..llm import _chat
from . import zillow, redfin, homeharvest_scraper

log = logging.getLogger("satellite_dfd")

# ─── Concurrency guard for AI calls ───────────────────────────────────────────
_AI_SCORE_SEM: Optional[asyncio.Semaphore] = None

def _get_ai_sem() -> asyncio.Semaphore:
    global _AI_SCORE_SEM
    if _AI_SCORE_SEM is None:
        limit = int(os.getenv("DFD_AI_CONCURRENCY", "4"))
        _AI_SCORE_SEM = asyncio.Semaphore(limit)
    return _AI_SCORE_SEM

# ─── Distress signal weights ──────────────────────────────────────────────────
def _age_score(year_built: Optional[int]) -> int:
    if not year_built: return 0
    age = max(0, 2025 - int(year_built))
    return 20 if age >= 80 else 15 if age >= 50 else 10 if age >= 30 else 5 if age >= 15 else 0

def _days_listed_score(days: Optional[int]) -> int:
    if not days: return 0
    return 20 if days >= 180 else 15 if days >= 90 else 10 if days >= 45 else 5 if days >= 21 else 0

def _price_reduction_score(has_cut: bool) -> int: return 10 if has_cut else 0
def _fsbo_score(is_fsbo: bool) -> int: return 10 if is_fsbo else 0
def _vacancy_score(vacant: bool) -> int: return 15 if vacant else 0
def _equity_score(equity_pct: Optional[float]) -> int:
    if equity_pct is None: return 0
    return 15 if equity_pct >= 50 else 10 if equity_pct >= 30 else 5 if equity_pct >= 15 else 0
def _tax_delinquent_score(delinquent: bool) -> int: return 20 if delinquent else 0
def _ownership_years_score(years: Optional[float]) -> int:
    if years is None: return 0
    return 10 if years >= 20 else 7 if years >= 10 else 3 if years >= 5 else 0

def _compute_score(signals: Dict[str, Any]) -> int:
    score = (
        _age_score(signals.get("year_built"))
        + _days_listed_score(signals.get("days_on_market"))
        + _price_reduction_score(bool(signals.get("price_reduction")))
        + _fsbo_score(bool(signals.get("is_fsbo")))
        + _vacancy_score(bool(signals.get("vacant")))
        + _equity_score(signals.get("equity_pct"))
        + _tax_delinquent_score(bool(signals.get("tax_delinquent")))
        + _ownership_years_score(signals.get("ownership_years"))
    )
    return max(0, min(100, score))

def _category(score: int) -> str:
    return "severe" if score >= 70 else "high" if score >= 50 else "medium" if score >= 30 else "low"

# ─── Google Maps Static API URLs ──────────────────────────────────────────────
def _google_key() -> Optional[str]:
    return os.getenv("GOOGLE_MAPS_API_KEY") or None

def _satellite_url(lat: float, lon: float, zoom: int = 20) -> Optional[str]:
    key = _google_key()
    if not key:
        return None
    return (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={lat},{lon}&zoom={zoom}&size=640x400"
        f"&maptype=satellite&key={key}"
    )

def _streetview_url(lat: float, lon: float, heading: int = 0, pitch: int = 0) -> Optional[str]:
    key = _google_key()
    if not key:
        return None
    return (
        f"https://maps.googleapis.com/maps/api/streetview"
        f"?size=640x400&location={lat},{lon}"
        f"&heading={heading}&pitch={pitch}&fov=90&key={key}"
    )

async def _download_image(url: str, fname: str) -> Optional[str]:
    """Download an image URL to a temp file. Returns path or None on error."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return None
            # Google returns a grey 'no imagery' image for unmapped locations
            # Skip if suspiciously small (< 5KB means it's the error tile)
            if len(r.content) < 5000:
                return None
            with open(fname, "wb") as f:
                f.write(r.content)
        return fname
    except Exception as e:
        log.debug("Image download failed for %s: %s", url, e)
        return None

# ─── YOLO visual distress detection ──────────────────────────────────────────
# YOLOv8n is trained on COCO80. Map detected COCO classes → distress proxies.
# Classes that actually appear in street/aerial property imagery:
_COCO_DISTRESS_MAP: Dict[str, str] = {
    "couch":      "furniture_outside",    # sofa on lawn = vacancy / eviction
    "bed":        "furniture_outside",    # mattress outside = eviction
    "chair":      "items_outside",        # outdoor chairs = neglect
    "suitcase":   "items_piled_outside",  # bags piled up = eviction
    "backpack":   "items_outside",
    "bottle":     "litter",              # scattered bottles = neglect
    "cup":        "litter",
    "car":        "vehicle_clutter",     # will count occurrences below
    "truck":      "vehicle_clutter",
    "motorcycle": "vehicle_clutter",
    "bicycle":    "vehicle_clutter",
    "potted plant": "overgrown_vegetation",
}
# Threshold: if ≥ N vehicles detected, flag vehicle clutter
_VEHICLE_CLUTTER_MIN = 3

_yolo_model = None  # lazy-loaded singleton to avoid OOM at startup
_yolo_lock: Optional[asyncio.Lock] = None  # protects concurrent model-load races


def _get_yolo_lock() -> asyncio.Lock:
    global _yolo_lock
    if _yolo_lock is None:
        _yolo_lock = asyncio.Lock()
    return _yolo_lock


def _get_yolo():
    """Synchronous getter — only call from non-async context or after lock acquired."""
    global _yolo_model
    if _yolo_model is None:
        if not _YOLO_AVAILABLE:
            return None
        try:
            _yolo_model = _YOLO_CLASS("yolov8n.pt")
            log.info("YOLOv8n model loaded (%.1f MB)", _yolo_model_size_mb())
        except Exception as e:
            log.warning("YOLO model load failed: %s", e)
            return None
    return _yolo_model


def _yolo_model_size_mb() -> float:
    try:
        import os as _os
        p = "yolov8n.pt"
        return _os.path.getsize(p) / 1024 / 1024 if _os.path.exists(p) else 0.0
    except Exception:
        return 0.0

def _yolo_signals(image_path: str) -> Dict[str, bool]:
    """Run YOLOv8n on an image and return distress signal dict."""
    model = _get_yolo()
    if model is None:
        return {}
    try:
        results = model(image_path, verbose=False)
        names = results[0].names
        detected = [names[int(cls)] for cls in results[0].boxes.cls]
        vehicle_count = sum(1 for d in detected if d in ("car", "truck", "motorcycle", "bicycle"))
        out: Dict[str, bool] = {
            "furniture_outside":   any(d in ("couch", "bed") for d in detected),
            "items_piled_outside": any(d in ("suitcase", "backpack", "chair") for d in detected),
            "litter":              any(d in ("bottle", "cup") for d in detected),
            "vehicle_clutter":     vehicle_count >= _VEHICLE_CLUTTER_MIN,
            "overgrown_vegetation": "potted plant" in detected,
        }
        log.debug("YOLO detections: %s → signals: %s", detected[:10], out)
        return {k: v for k, v in out.items() if v}  # only return True signals
    except Exception as e:
        log.warning("YOLO inference failed: %s", e)
        return {}

# ─── AI distress reasoning ───────────────────────────────────────────────────
async def _ai_distress_score(address: str, signals: Dict[str, Any], base_score: int,
                              yolo_signals: Dict[str, bool]) -> Dict[str, Any]:
    sys_msg = (
        "You are a real estate distress analyst. Score property distress 0-100. "
        "Return JSON: {\"score\": int, \"rationale\": str, \"category\": str} "
        "where category is one of: low, medium, high, severe."
    )
    sig_lines = "\n".join(f"- {k}: {v}" for k, v in signals.items() if v)
    yolo_lines = "\n".join(f"- VISUAL: {k}" for k, v in yolo_signals.items() if v)
    user_msg = (
        f"Property: {address}\nBase score: {base_score}\n"
        f"Signals:\n{sig_lines}"
        + (f"\nVisual detections (YOLO):\n{yolo_lines}" if yolo_lines else "")
    )
    try:
        raw = await _chat(
            [{"role": "system", "content": sys_msg},
             {"role": "user", "content": user_msg}],
            json_mode=True, max_tokens=180, temperature=0.2,
        )
        data = json.loads(raw)
        score = max(0, min(100, int(data.get("score", base_score))))
        category = data.get("category", _category(score))
        if category not in ("low", "medium", "high", "severe"):
            category = _category(score)
        return {
            "score":    score,
            "rationale": str(data.get("rationale", "")),
            "category": category,
        }
    except Exception as e:
        log.debug("AI distress score failed for %s: %s", address, e)
        return {"score": base_score, "rationale": "", "category": _category(base_score)}

# ─── Listing enrichment ───────────────────────────────────────────────────────
async def _fetch_listings(zip_code: str = "", city: str = "", state: str = "") -> List[Dict[str, Any]]:
    """Fetch listings via HomeHarvest (primary) with Zillow/Redfin as fallback.

    HomeHarvest is preferred because:
    - Runs synchronously inside the container without proxy requirements
    - Returns latitude/longitude natively (required for satellite imagery)
    - Works reliably on Railway without scraping proxies
    """
    async def _safe(fn, **kwargs):
        try: return await fn(**kwargs)
        except Exception as e: log.info("%s failed: %s", fn.__name__, e); return []

    all_listings: List[Dict[str, Any]] = []

    # ── HomeHarvest: primary source (zip or city+state) ───────────────────────
    hh_location = zip_code if zip_code else (f"{city}, {state}" if city and state else "")
    if hh_location:
        hh_active, hh_sold = await asyncio.gather(
            _safe(homeharvest_scraper.scrape_foreclosures,
                  city="", state="", location=hh_location,
                  listing_type="for_sale", site="zillow", limit=50),
            _safe(homeharvest_scraper.scrape_foreclosures,
                  city="", state="", location=hh_location,
                  listing_type="sold", site="realtor.com", limit=30),
        )
        all_listings.extend(hh_active + hh_sold)
        log.info("DFD: HomeHarvest returned %d listings", len(all_listings))

    # ── Zillow/Redfin fallback if HomeHarvest returned nothing ────────────────
    if not all_listings:
        log.info("DFD: HomeHarvest empty — falling back to Zillow/Redfin scrapers")
        active, fsbo, zsold, rsold = await asyncio.gather(
            _safe(zillow.fetch_active_listings, zip_code=zip_code, city=city, state=state, max_results=40),
            _safe(zillow.fetch_fsbo, zip_code=zip_code, city=city, state=state, max_results=25),
            _safe(zillow.fetch_recently_sold, zip_code=zip_code, city=city, state=state, max_results=20),
            _safe(redfin.fetch_recently_sold, zip_code=zip_code, city=city, state=state, max_results=20),
        )
        for p in fsbo:
            p["is_fsbo"] = True
        all_listings.extend(active + fsbo + zsold + rsold)

    # De-duplicate by address
    seen: set = set()
    deduped: List[Dict[str, Any]] = []
    for p in all_listings:
        addr = (p.get("address") or "").strip().lower()
        if addr and addr in seen:
            continue
        if addr:
            seen.add(addr)
        deduped.append(p)
    return deduped

# ─── Public entrypoint ───────────────────────────────────────────────────────
async def scan_area(zip_code: str = "", city: str = "", state: str = "",
                    min_score: int = 30, max_results: int = 50,
                    use_ai_scoring: bool = True) -> Dict[str, Any]:
    log.info("Satellite DFD scan: zip=%s city=%s state=%s min=%d", zip_code, city, state, min_score)
    has_google = bool(_google_key())
    has_yolo = _YOLO_AVAILABLE

    listings = await _fetch_listings(zip_code=zip_code, city=city, state=state)
    log.info("DFD: fetched %d listings", len(listings))

    candidates: List[Dict[str, Any]] = []
    total_above: int = 0

    for p in listings:
        try:
            year_built = int(p.get("year_built") or 0) or None
        except Exception:
            year_built = None

        dom_raw = p.get("days_on_market") or p.get("days") or 0
        try:
            days_on_market: Optional[int] = int(dom_raw) or None
        except Exception:
            days_on_market = None

        signals: Dict[str, Any] = {
            "year_built":      year_built,
            "days_on_market":  days_on_market,
            "price_reduction": bool(p.get("price_reduction") or p.get("price_reduced")),
            "is_fsbo":         bool(p.get("is_fsbo")),
            "vacant":          bool(p.get("vacant") or p.get("vacancy")),
            "equity_pct":      p.get("equity_pct"),
            "tax_delinquent":  bool(p.get("tax_delinquent")),
            "ownership_years": p.get("ownership_years"),
        }
        base_score = _compute_score(signals)
        if base_score < min_score:
            continue
        total_above += 1

        # ── Google Maps image URLs ────────────────────────────────────────────
        lat = p.get("latitude")
        lon = p.get("longitude")
        sat_url: Optional[str] = None
        sv_url: Optional[str] = None
        if has_google and lat and lon:
            sat_url = _satellite_url(float(lat), float(lon))
            sv_url  = _streetview_url(float(lat), float(lon))

        # ── YOLO distress detection on street view ───────────────────────────
        yolo_sigs: Dict[str, bool] = {}
        if has_yolo and has_google and sv_url and base_score >= 40:
            fname = f"/tmp/sv_{lat}_{lon}.jpg"
            img_path = await _download_image(sv_url, fname)
            if img_path:
                # Serialize YOLO inference — the model is a singleton and
                # torch is not thread-safe for concurrent model.forward() calls.
                async with _get_yolo_lock():
                    yolo_sigs = await asyncio.get_event_loop().run_in_executor(
                        None, _yolo_signals, img_path
                    )
                # Each confirmed visual signal bumps score by 5 pts
                yolo_boost = min(20, sum(5 for v in yolo_sigs.values() if v))
                base_score = min(100, base_score + yolo_boost)

        # ── AI reasoning ─────────────────────────────────────────────────────
        if use_ai_scoring:
            async with _get_ai_sem():
                scored = await _ai_distress_score(
                    p.get("address", ""), signals, base_score, yolo_sigs
                )
        else:
            scored = {
                "score":    base_score,
                "rationale": "",
                "category": _category(base_score),
            }

        if scored["score"] < min_score:
            continue

        # ── Normalise value field ─────────────────────────────────────────────
        estimated_value = (
            p.get("estimated_value")
            or p.get("zestimate")
            or p.get("price")
        )

        candidates.append({
            "address":           p.get("address"),
            "city":              p.get("city") or city,
            "state":             p.get("state") or state,
            "zip":               p.get("zip") or zip_code,
            "distress_score":    scored["score"],
            "distress_category": scored["category"],
            "rationale":         scored["rationale"],
            "latitude":          lat,
            "longitude":         lon,
            "satellite_url":     sat_url,
            "streetview_url":    sv_url,
            "zillow_url":        p.get("zillow_url") or p.get("source_url"),
            "estimated_value":   estimated_value,
            "beds":              p.get("beds"),
            "baths":             p.get("baths"),
            "sqft":              p.get("sqft"),
            "year_built":        year_built,
            "source":            p.get("source", "zillow"),
            "signals":           signals,
            "yolo_signals":      yolo_sigs,
        })

        if len(candidates) >= max_results * 2:  # over-fetch then trim after sort
            break

    candidates.sort(key=lambda x: x.get("distress_score", 0), reverse=True)
    top = candidates[:max_results]

    return {
        "zip":                  zip_code,
        "city":                 city,
        "state":                state,
        "total_scanned":        len(listings),
        "total_above_threshold": total_above,
        "min_score_filter":     min_score,
        "google_imagery":       has_google,
        "yolo_available":       has_yolo,
        "results":              top,
        "count":                len(top),
    }
