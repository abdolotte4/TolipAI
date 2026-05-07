# Digor LLC — Project Conventions & Architecture

## Monorepo Structure

```
/
├── artifacts/
│   ├── api-server/          # Express + TypeScript REST API (PORT=8080)
│   │   └── src/
│   │       ├── routes/      # Route handlers (admin, leads, scraperEngine, tools, etc.)
│   │       ├── db/          # Drizzle ORM schema + migrations
│   │       └── index.ts     # App entry point
│   ├── digor-website/       # Public marketing site (PORT=3000)
│   ├── digor-crm/           # Internal CRM portal (PORT=3001)
│   ├── digor-tools/         # Tools portal (PORT=3002)
│   └── digor-scraper-engine/  # Python FastAPI scraper engine (PORT=8001)
│       ├── workers/
│       │   ├── main.py      # FastAPI app entry (2000+ lines)
│       │   ├── db.py        # asyncpg DB helpers
│       │   ├── distressed.py
│       │   ├── cash_buyers.py
│       │   ├── skip_trace.py
│       │   ├── ai_research.py
│       │   ├── http_client.py
│       │   ├── llm.py       # LLM wrapper (Kimi K2 / Bedrock / OpenRouter)
│       │   ├── config.py    # Settings via pydantic-settings
│       │   ├── job_store.py
│       │   ├── osint_skip_trace.py
│       │   ├── pdf_parser.py
│       │   ├── retry_queue.py
│       │   └── scrapers/    # Individual site scrapers
│       │       ├── county.py
│       │       ├── county_deeds.py
│       │       ├── distressed_sources.py
│       │       ├── homeharvest_scraper.py
│       │       ├── propelio.py / propelio_v2.py
│       │       ├── propwire.py
│       │       ├── satellite_dfd.py   # Drive-for-dollars AI engine
│       │       ├── satellite_rekognition.py
│       │       ├── attom.py
│       │       ├── zillow.py / redfin.py
│       │       └── _browser_session.py  # Playwright shared session
│       └── test_logins.py
├── packages/                # Shared TS packages (if any)
├── pnpm-workspace.yaml
├── .aider.conf.yml
├── CONVENTIONS.md           # This file
└── launch-aider.sh          # Start Aider AI assistant
```

## Language & Runtime

- **TypeScript/Node** — api-server, digor-website, digor-crm, digor-tools
  - Package manager: `pnpm` (workspace monorepo)
  - ORM: Drizzle (PostgreSQL)
  - Framework: Express
- **Python 3.11** — digor-scraper-engine
  - Framework: FastAPI + uvicorn
  - HTTP: httpx + tenacity
  - Browser automation: Playwright
  - LLM: OpenRouter / Kimi K2 / AWS Bedrock

## Python Conventions

- Format with `black` (line length 120), lint with `flake8 --max-line-length=120`
- One import per line (no `import a, b, c` — split onto separate lines)
- No ambiguous single-letter variable names (`l`, `O`, `I`) — use descriptive names
- Imports that must come after runtime patches go at their location with `# noqa: E402`
- Remove unused imports; remove unused local variables
- Async everywhere for I/O; use `asyncio.gather` for parallel tasks
- All scraper functions return `List[Dict[str, Any]]`

## TypeScript Conventions

- Strict mode enabled
- No `any` unless necessary
- Route files in `artifacts/api-server/src/routes/`
- Shared types in the route files (no separate types dir currently)

## Environment Variables (set via Replit Secrets)

```
DATABASE_URL          # PostgreSQL connection string
OPENROUTER_API_KEY    # LLM calls (Kimi K2, Claude, GPT-4o)
GROQ_API_KEY          # Fast inference fallback
BRIGHTDATA_PROXY_URL  # Residential proxy for scrapers
ATTOM_API_KEY         # ATTOM property data API
GOOGLE_MAPS_API_KEY   # Google Maps / Places API
GOOGLE_CLOUD_API_KEY  # Cloud Vision (satellite_rekognition)
SIGNALWIRE_*          # Telephony
OPENPHONE_*           # OpenPhone integration
```

## Key Design Patterns

### Scraper Engine Jobs
- Long-running jobs are tracked via `job_store.py` (in-memory dict + DB)
- Endpoints return `job_id` immediately; client polls `/job-status/{job_id}`
- Progress reported via `progress_cb(pct, message)` callbacks

### API → Scraper Bridge
- `artifacts/api-server/src/routes/scraperEngine.ts` proxies requests to the Python engine
- The Python engine runs on its own port (configured via `SCRAPER_ENGINE_URL` env var)

### LLM Integration
- All LLM calls go through `workers/llm.py` → `_chat()` helper
- Supports OpenRouter (primary), Groq (fallback), AWS Bedrock (structured output)
- Default model: `moonshotai/kimi-k2` via OpenRouter

### Browser Sessions
- `workers/scrapers/_browser_session.py` manages persistent Playwright contexts
- Session state stored in `/tmp/<service>_state.json`
- Re-login on cold start; session reuse otherwise

## Running the Project

```bash
# Start all services
pnpm run dev

# Or individually:
PORT=8080 pnpm --filter @workspace/api-server run dev
PORT=3000 pnpm --filter @workspace/digor-website run dev
PORT=3001 pnpm --filter @workspace/digor-crm run dev
PORT=3002 pnpm --filter @workspace/digor-tools run dev

# Python scraper engine
cd artifacts/digor-scraper-engine
uvicorn workers.main:app --reload --port 8001

# Lint + format Python
cd artifacts/digor-scraper-engine
python -m black workers/ test_logins.py
python -m flake8 workers/ test_logins.py --max-line-length=120 --extend-ignore=E203,W503,E501
```

## Switching Between Replit Agent and Aider

- **Replit Agent**: Use the web chat interface in Replit. Agent auto-commits after each task.
- **Aider**: Run `./launch-aider.sh` from the project root in a terminal shell.
  - Aider edits files directly; commit manually with `git add -A && git commit -m "..."`
  - Both tools can be used on the same codebase — just avoid editing the same file simultaneously.
  - Aider reads `CONVENTIONS.md` automatically for project context.
