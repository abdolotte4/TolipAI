"""Satellite Drive-For-Dollars engine (rebuilt).

Fuses property signals + Google Maps imagery + YOLO visual detections +
LLM reasoning to score property distress 0-100.
"""

from __future__ import annotations
import asyncio, json, logging, os, httpx
from typing import Any, Dict, List, Optional
from ultralytics import YOLO
from ..http_client import fetch_html
from ..llm import _chat
from . import zillow, redfin

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

# ─── Google Maps satellite URL + download ─────────────────────────────────────
def _satellite_url(lat: float, lon: float, zoom: int = 20) -> Optional[str]:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key: return None
    return f"https://maps.googleapis.com/maps/api/staticmap?center={lat},{lon}&zoom={zoom}&size=640x640&maptype=satellite&key={key}"

async def _download_satellite(lat: float, lon: float) -> Optional[str]:
    url = _satellite_url(lat, lon)
    if not url: return None
    fname = f"/tmp/sat_{lat}_{lon}.png"
    async with httpx.AsyncClient() as client:
        r = await client.get(url)
        with open(fname, "wb") as f: f.write(r.content)
    return fname

# ─── Google Maps satellite + street view URL helpers ──────────────────────────

def _satellite_url(lat: float, lon: float, zoom: int = 20) -> Optional[str]:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return None
    return (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={lat},{lon}&zoom={zoom}&size=640x640"
        f"&maptype=satellite&key={key}"
    )

def _streetview_url(lat: float, lon: float, heading: int = 0, pitch: int = 0) -> Optional[str]:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return None
    return (
        f"https://maps.googleapis.com/maps/api/streetview"
        f"?size=640x640&location={lat},{lon}&heading={heading}&pitch={pitch}&key={key}"
    )


# ─── YOLO visual distress detection ──────────────────────────────────────────
_yolo_model = YOLO("yolov8n.pt")  # swap for yolov9 if installed

def _yolo_signals(image_path: str) -> Dict[str, bool]:
    results = _yolo_model(image_path)
    detections = [results[0].names[int(cls)] for cls in results[0].boxes.cls]
    return {
        "tall_grass": "grass" in detections,
        "broken_windows": "window_broken" in detections,
        "roof_damage": "roof_damage" in detections,
        "boarded_doors": "boarded_door" in detections,
        "trash": "trash" in detections,
        "abandoned_car": "car_abandoned" in detections,
    }

# ─── AI distress reasoning ───────────────────────────────────────────────────
def _category(score: int) -> str:
    return "severe" if score >= 70 else "high" if score >= 50 else "medium" if score >= 30 else "low"

async def _ai_distress_score(address: str, signals: Dict[str, Any], base_score: int) -> Dict[str, Any]:
    sys_msg = (
        "You are a real estate distress analyst. Fuse property signals + YOLO detections. "
        "Return JSON: {\"score\": int, \"rationale\": str, \"category\": str}"
    )
    sig_lines = "\n".join(f"- {k}: {v}" for k, v in signals.items() if v)
    user_msg = f"Property: {address}\nBase score: {base_score}\nSignals:\n{sig_lines}"
    try:
        raw = await _chat(
            [{"role": "system", "content": sys_msg},
             {"role": "user", "content": user_msg}],
            json_mode=True, max_tokens=150, temperature=0.2,
        )
        data = json.loads(raw)
        return {
            "score": max(0, min(100, int(data.get("score", base_score)))),
            "rationale": data.get("rationale", ""),
            "category": data.get("category", _category(base_score)),
        }
    except Exception as e:
        log.debug("AI distress score failed for %s: %s", address, e)
        return {"score": base_score, "rationale": "", "category": _category(base_score)}

# ─── Zillow/Redfin listing enrichment ────────────────────────────────────────
async def _fetch_listings(zip_code: str = "", city: str = "", state: str = "") -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    async def _safe(fn, **kwargs): 
        try: return await fn(**kwargs)
        except Exception as e: log.info("%s failed: %s", fn.__name__, e); return []
    active, fsbo, zsold, rsold = await asyncio.gather(
        _safe(zillow.fetch_active_listings, zip_code=zip_code, city=city, state=state, max_results=40),
        _safe(zillow.fetch_fsbo, zip_code=zip_code, city=city, state=state, max_results=25),
        _safe(zillow.fetch_recently_sold, zip_code=zip_code, city=city, state=state, max_results=20),
        _safe(redfin.fetch_recently_sold, zip_code=zip_code, city=city, state=state, max_results=20),
    )
    for p in fsbo: p["is_fsbo"] = True
    results.extend(active + fsbo + zsold + rsold)
    seen, deduped = set(), []
    for p in results:
        addr = (p.get("address") or "").strip().lower()
        if addr and addr in seen: continue
        if addr: seen.add(addr)
        deduped.append(p)
    return deduped

# ─── Public entrypoint ───────────────────────────────────────────────────────
async def scan_area(zip_code: str = "", city: str = "", state: str = "",
                    min_score: int = 30, max_results: int = 50,
                    use_ai_scoring: bool = True) -> Dict[str, Any]:
    log.info("Satellite DFD scan: zip=%s city=%s state=%s", zip_code, city, state)
    listings = await _fetch_listings(zip_code=zip_code, city=city, state=state)
    candidates: List[Dict[str, Any]] = []
    for p in listings:
        try:
            year_built = int(p.get("year_built") or 0) or None
        except: year_built = None
        dom_raw =