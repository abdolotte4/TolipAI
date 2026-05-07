# Digor Agent Chat Context
> Auto-generated summary of Replit Agent session decisions.
> Aider reads this file automatically for continuity.

## Current Project State (May 2026)

### What Was Built
- **pnpm monorepo**: Express API (`api-server`) + 3 React portals (website, CRM, tools)
- **Python scraper engine** (`digor-scraper-engine`): FastAPI app with 30+ scrapers
- **Phone Finder**: CSV upload → Google Maps Places API → phone number extraction (in digor-tools)
- **ATTOM fallback**: `fetchDistressedViaAttom()` in `attomApi.ts`
- **Playwright-first Google Maps endpoint** (`/google-maps`) in `main.py`
- **Bedrock integration** in `llm.py` (USE_BEDROCK=1 env var)
- **Lambda handler** (`lambda_handler.py`): universal AWS Lambda router for all scraper endpoints
- **Dockerfile.lambda**: pre-built for ECR → API Gateway deployment

### Key Architecture Decisions
- LLM calls route through `workers/llm.py._chat()` — priority: Kimi K2.6 (Moonshot/OpenRouter) → Groq → Cerebras → Together → NVIDIA → Bedrock
- All scraper I/O is async (httpx + Playwright + asyncio.gather)
- Jobs tracked in `job_store.py` (in-memory + DB); clients poll `/job-status/{id}`
- boto3 imports are always lazy (`import boto3  # type: ignore[import]`) inside guarded blocks — not a hard dep for local dev
- BeautifulSoup `Tag.get("href")` must be wrapped with `str(... or "")` — returns `str | AttributeValueList | None`

### Type-Fix Patterns (apply these always)
- boto3 lazy import: `import boto3  # type: ignore[import]` inside `if os.getenv("USE_BEDROCK")` or try blocks
- BeautifulSoup href: `href = str(a.get("href", "") or "")` — never `a.get("href", "")`
- Dynamic **kwargs to typed function: `run_fn(**params)  # type: ignore[arg-type]`

### Hillsborough County Clerk — CORRECT URLs (updated May 2026)
- Official Records (Lis Pendens / Deeds): https://publicaccess.hillsclerk.com/TD/
- Probate Case Search: https://publicaccess.hillsclerk.com/
- Old broken URL (do NOT use): https://pubrec2.hillsclerk.com/pubrec/

### Known Pre-existing Issues (not caused by recent changes)
- DB errors: `relation "crm_users" does not exist` — dev database schema not pushed; fix: run drizzle migrations
- `tools_skip_trace_jobs` table missing in dev DB — same root cause

### Flake8 / Black Config
- Line length: 120
- Flake8 ignore: E203, W503, E501
- Python workers path: `artifacts/digor-scraper-engine/workers/`

### AWS Readiness Status
- `Dockerfile.lambda` — complete, targets `public.ecr.aws/lambda/python:3.11`
- `lambda_handler.py` — universal router with all endpoints wired
- S3 storage: activated by `S3_BUCKET` env var
- Bedrock LLM: activated by `USE_BEDROCK=1` env var
- Rekognition visual analysis: activated by `USE_REKOGNITION=1` env var
- See `docs/aws-migration.md` for full migration guide
