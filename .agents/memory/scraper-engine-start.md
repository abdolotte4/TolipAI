---
name: Scraper engine local startup
description: How to start the Python scraper engine locally in Replit NixOS
---

## Prerequisites
- uv is at `/nix/store/6m2322jq0rkfdnv6cm3dq8437djbfv1l-uv-0.9.5/bin/uv`
- pip DOES NOT WORK in Replit NixOS Python (xmlrpc/expat ImportError)
- Always use uv to install packages: `uv venv .venv --python python3.11 && uv pip install ...`
- Venv is at `artifacts/TolipAI-scraper-engine/.venv`

## Packages installed in .venv
Core: fastapi, uvicorn, httpx, beautifulsoup4, asyncpg, aiohttp, openai, tenacity, pdfplumber, PyMuPDF, Pillow, pytesseract

## Auth
- Scraper engine reads `SCRAPER_API_KEY` env var
- API server sends it as `Authorization: Bearer <key>` header
- For local dev: `SCRAPER_API_KEY=tolipai_local_dev_key`
- API server env: `SCRAPER_ENGINE_URL=http://localhost:8000`, `WEBSCRAPER_API_KEY=tolipai_local_dev_key`

## node-start.sh integration
- node-start.sh now auto-starts scraper engine on port 8000 before starting Node API
- Uses nohup + disown to keep engine alive; logs → /tmp/scraper-engine.log
- If SCRAPER_API_KEY is not set, defaults to `tolipai_local_dev_key`

## What NOT to use nohup for in bash tool calls
- Bash command timeout (120s max) kills nohup background processes
- Workflow restart is the only reliable way to start both services
