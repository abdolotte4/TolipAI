---
name: BrightData proxy scheme must be http://
description: BrightData superproxy requires http:// scheme; using https:// causes SSL cert errors that silently return empty results from all scrapers.
---

## Rule
`config.py` `proxy_url()` and `proxy_dict()` must construct the proxy URL with `http://` scheme, not `https://`.

## Why
BrightData's superproxy (`brd.superproxy.io`) is an HTTP CONNECT tunnel — it does its own TLS on port 33335. When the client sends an `https://` scheme, Python/httpx attempts to do a TLS handshake *with the proxy itself* over the already-TLS-wrapped connection, which fails with `[SSL: CERTIFICATE_VERIFY_FAILED]`. This error was swallowed silently by catch blocks in `cash_buyers.py`, causing Zillow/Redfin requests to return `[]` with no logged error — making it look like no results were found when in fact every single request was failing at the proxy layer.

## How to apply
- `proxy_url()`: return `f"http://{user}:{pwd}@{host}:{port}"`  (not `https://`)
- `proxy_dict()` / `proxy_dict_pinned()`: same scheme  
- `http_client.py`: when proxy is set, also pass `verify=False` so httpx doesn't try to validate the proxy's inner TLS layer
- `_browser_session.py` uses Playwright `ProxySettings` which correctly handles the http:// scheme and does not need verify=False
