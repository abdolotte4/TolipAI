"""Quick login + result test for Propelio and Propwire.

Run from the scraper-engine root:
    python test_logins.py

Results are printed as JSON to stdout.
"""
import asyncio
import json
import os
import sys
import time

# Make sure workers package is importable
sys.path.insert(0, os.path.dirname(__file__))


# ── Propelio test ─────────────────────────────────────────────────────────────


async def test_propelio():
    print("\n" + "=" * 60)
    print("PROPELIO TEST")
    print("=" * 60)
    t0 = time.time()
    try:
        from workers.scrapers.propelio_v2 import search_property, fetch_cash_buyers

        address = "123 Main St, Orlando, FL 32801"
        print(f"  Searching: {address}")
        prop = await search_property(address)
        elapsed = round(time.time() - t0, 1)
        print(f"  Login + search OK ({elapsed}s) — property_id={prop.get('property_id')}")
        print(f"  URL: {prop.get('url')}")

        pid = prop.get("property_id")
        if pid:
            print("  Fetching cash buyers (max 10)...")
            buyers = await fetch_cash_buyers(pid, max_results=10, distance_miles=10)
            print(f"  Cash buyers returned: {len(buyers)}")
            for i, b in enumerate(buyers[:5], 1):
                print(
                    f"    {i}. {b.get('name') or b.get('llc') or '(no name)'} "
                    f"| props={b.get('props_count')} | avg_deal=${b.get('avg_deal')}"
                )
            return {
                "status": "ok",
                "property": prop,
                "buyers_count": len(buyers),
                "buyers_sample": buyers[:5],
            }
        else:
            return {"status": "ok_no_id", "property": prop}

    except Exception as e:
        elapsed = round(time.time() - t0, 1)
        print(f"  FAILED ({elapsed}s): {e}")
        return {"status": "error", "error": str(e)}


# ── Propwire test ─────────────────────────────────────────────────────────────


async def test_propwire():
    print("\n" + "=" * 60)
    print("PROPWIRE TEST")
    print("=" * 60)
    t0 = time.time()
    try:
        from workers.scrapers.propwire import fetch_property, fetch_cash_buyers_nearby

        address = "123 Main St, Orlando, FL 32801"
        print(f"  Fetching property: {address}")
        result = await fetch_property(address)
        elapsed = round(time.time() - t0, 1)
        print(f"  Login + property fetch OK ({elapsed}s)")
        print(f"  URL: {result.get('url')}")
        det = result.get("details") or {}
        print(
            f"  beds={det.get('beds')} baths={det.get('baths')} sqft={det.get('sqft')} "
            f"est_value=${det.get('estimated_value')}"
        )
        own = result.get("owner") or {}
        print(f"  Owner: {own.get('name')} | LLC={own.get('is_llc')} | OO={own.get('owner_occupied')}")

        prop_url = result.get("url")
        if prop_url and "/realestate/" in prop_url:
            print("  Fetching nearby cash buyers (max 10)...")
            buyers = await fetch_cash_buyers_nearby(prop_url, max_results=10)
            print(f"  Cash buyers returned: {len(buyers)}")
            for i, b in enumerate(buyers[:5], 1):
                print(
                    f"    {i}. {b.get('name') or b.get('llc') or '(no name)'} "
                    f"| props={b.get('props_count')} | avg_deal=${b.get('avg_deal')}"
                )
            return {
                "status": "ok",
                "property": result,
                "buyers_count": len(buyers),
                "buyers_sample": buyers[:5],
            }
        else:
            return {"status": "ok_no_url", "property": result}

    except Exception as e:
        elapsed = round(time.time() - t0, 1)
        print(f"  FAILED ({elapsed}s): {e}")
        return {"status": "error", "error": str(e)}


# ── Main ──────────────────────────────────────────────────────────────────────


async def main():
    # Clear stale sessions first
    for f in ["/tmp/propelio_state.json", "/tmp/propwire_state.json"]:
        if os.path.exists(f):
            os.remove(f)
            print(f"Cleared stale session: {f}")

    results = {}
    results["propelio"] = await test_propelio()
    results["propwire"] = await test_propwire()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for svc, r in results.items():
        print(f"  {svc.upper()}: {r['status']}")
        if r.get("error"):
            print(f"    error: {r['error']}")

    print("\nFull JSON output:")
    print(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
