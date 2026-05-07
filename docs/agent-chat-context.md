# Digor Agent Chat Context
> Auto-generated summary of Replit Agent session decisions.
> Aider reads this file automatically for continuity.

## Current Project State (May 2026)

### What Was Built
- **pnpm monorepo**: Express API (`api-server`) + 3 React portals (website, CRM, tools)
- **Python scraper engine** (`digor-scraper-engine`): FastAPI app with 30+ scrapers
- **ATTOM fallback**: `fetchDistressedViaAttom()` added to `attomApi.ts`; fallback routes in `tools.ts`
- **Playwright-first Google Maps endpoint** (`/google-maps`) in `main.py`
- **Bedrock integration** in `llm.py` (structured output via AWS Bedrock)
- **Mode B helpers** in `main.py`: `safe_create_task`, `safe_get_pool`, `_get_scraper_sem`
- **Google Search throttle** and **foreclosure skip_step fix** in main.py
- **Black + Flake8 clean**: all Python files reformatted and lint errors fixed

### Key Architecture Decisions
- LLM calls route through `workers/llm.py._chat()` — primary: **Kimi K2.6** (Moonshot direct or OpenRouter), fallback: Groq (free)
- Kimi K2.6 has 1M token context, 200K input, agent swarm up to 300 agents
- Provider chain order: Moonshot → OpenRouter → Groq → Cerebras → Together → NVIDIA
- All scraper I/O is async (httpx + Playwright + asyncio.gather)
- Jobs are tracked in `job_store.py` (in-memory + DB); clients poll `/job-status/{id}`
- Imports that must follow `_patch_ld_library_path()` in `main.py` use `# noqa: E402`
- The `from .scrapers import county, propelio` imports were removed from `main.py` (unused)

### Known Pre-existing Issues (not caused by recent changes)
- TypeScript errors in `admin.ts`, `leads.ts`, `scraperEngine.ts`, `automation.ts` — missing DB schema members
- Server starts fine despite TS errors (compiled JS runs)

### Flake8 Clean Status (as of May 2026)
All issues resolved:
- F541 f-strings missing placeholders — fixed in `test_logins.py`
- F401 unused imports — removed across all workers
- E741 ambiguous variable `l` — renamed to `listing` / `item` across all files
- E401 multiple imports on one line — split in `http_client.py`, `county_deeds.py`, `satellite_dfd.py`, `skip_trace.py`
- E402 late imports (intentional) — marked `# noqa: E402`
- F824 unused global — removed from `http_client.py`
- F841 unused locals — removed `proxy_dict`, `campaign_id`, `tasks` variables

### Active API Routes (api-server)
- `GET/POST /api/tools/distressed-search` — distressed property search (ATTOM fallback)
- `GET /api/tools/distressed-jobs/:id` — job status
- `POST /api/scraper/*` — proxied to Python engine
- `POST /api/admin/*` — admin endpoints
- `POST /api/crm/leads` — lead management
