---
name: Crawl4AI ProxyConfig
description: Newer crawl4ai versions require a ProxyConfig object not a plain dict for BrowserConfig proxy_config.
---

## The rule
When passing proxy config to `BrowserConfig(proxy_config=...)`, try importing `ProxyConfig` from crawl4ai first. If it exists, use it as a dataclass. Fall back to a plain dict for older versions.

**Why:** crawl4ai >= 0.4 changed the `proxy_config` parameter from accepting a `dict` to requiring a `ProxyConfig` dataclass. Passing a dict causes `AttributeError: 'dict' object has no attribute 'server'` which silently breaks all Crawl4AI-based scraping.

**How to apply:**
```python
try:
    from crawl4ai import ProxyConfig as _ProxyConfig
    _proxy_cfg = _ProxyConfig(server=..., username=..., password=...)
except (ImportError, TypeError):
    _proxy_cfg = {"server": ..., "username": ..., "password": ...}
```
File: `artifacts/TolipAI-scraper-engine/workers/http_client.py` in `fetch_crawl4ai()`.
