# TolipAI CRM & Tools Platform

![CI](https://github.com/Agawish24/TolipAI/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node 22](https://img.shields.io/badge/node-22-brightgreen)
![pnpm 10](https://img.shields.io/badge/pnpm-10-orange)
![Deploy: Railway](https://img.shields.io/badge/deploy-Railway-blueviolet)

**[▶ Live Demo](https://heroic-curiosity-production-dc5a.up.railway.app/crm/)** — Login: `demo@tolipai.com` / `Demo2026!`

> Demo is read-only friendly — seeded with 15 realistic fake leads across Cleveland, Detroit, Atlanta, Memphis, Houston, Pittsburgh, St. Louis, and Louisville.

A full-stack real estate wholesaling platform built to solve real acquisition, communication, and analysis problems for real estate investors, wholesalers, and agents. The system combines a multi-tenant CRM, an internal tools suite, a public-facing marketing website, and a shared API server — all running as a monorepo deployed on Railway.

---

## Table of Contents

- [Getting Started (dev)](#getting-started-dev)
- [Deploying](#deploying)
- [Screenshots](#screenshots)
- [Business Problem & Case Study](#business-problem--case-study)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Applications](#applications)
  - [TolipAI CRM](#tolipai-crm)
  - [TolipAI Tools](#tolipai-tools)
  - [TolipAI Website](#tolipai-website)
  - [API Server](#api-server)
- [AI Integrations](#ai-integrations)
- [Third-Party APIs & Integrations](#third-party-apis--integrations)
- [Database Schema](#database-schema)
- [Key Engineering Decisions](#key-engineering-decisions)
- [Environment Variables](#environment-variables)
- [Production Notes](#production-notes)

---

## Getting Started (dev)

### Prerequisites

- [Node.js 22](https://nodejs.org/) — required (`nodejs-22` Nix module installed)
- [pnpm 10](https://pnpm.io/installation) — `npm install -g pnpm`
- PostgreSQL (local or remote — see `DATABASE_URL` below)

### Setup

```bash
# 1. Clone and install all workspace dependencies
git clone https://github.com/Agawish24/TolipAI.git
cd tolipai
pnpm install

# 2. Copy the environment template and fill in your values
cp .env.example .env
#    At minimum: DATABASE_URL, JWT_SECRET, CRM_ADMIN_EMAIL, CRM_ADMIN_PASSWORD, TOOLS_PIN

# 3. Push the schema to your database (runs Drizzle migrations)
cd lib/db && pnpm run push && cd ../..

# 4. Run the full type-check across the monorepo
pnpm run typecheck
```

### Running locally

Each application has its own dev server. Open separate terminals:

```bash
# API server (Express 5 — required by all front-ends)
pnpm --filter @workspace/api-server run dev

# CRM portal  →  http://localhost:<PORT>/crm/
pnpm --filter @workspace/TolipAI-crm run dev

# Tools portal  →  http://localhost:<PORT>/tools/
pnpm --filter @workspace/TolipAI-tools run dev

# Public website  →  http://localhost:<PORT>/
pnpm --filter @workspace/TolipAI-website run dev
```

> **Replit users:** workflows for each service are pre-configured. Use the
> Run button or the workflow panel to start them individually.

### Build (production)

```bash
pnpm run build        # typecheck + build all packages
```

For architecture details, JWT rules, and comp math see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Live Demo Setup

To populate a deployed instance with realistic fake data for demos:

```bash
# 1. Make sure DATABASE_URL is set in your environment
# 2. Run the demo seed (idempotent — safe to re-run)
pnpm --filter @workspace/api-server seed:demo
```

This creates:
- **Campaign:** TolipAI Demo
- **Login:** `demo@tolipai.com` / `Demo2026!`
- **15 fake leads** across Cleveland, Detroit, Atlanta, Memphis, Houston, Pittsburgh, St. Louis, and Louisville — with realistic ARV/MAO math, deal statuses (new → closed), activity notes, tasks, and comps
- No real PII — all names, phones, and emails are fictional

After seeding, update the demo URL in `artifacts/tolipai-website/src/components/sections/Hero.tsx` and `README.md` (search for `YOUR_RAILWAY_APP`).

---

## Deploying

### Local (Docker-free)

The full stack runs without Docker. You just need Node 22, pnpm 10, and a PostgreSQL instance.

```bash
# Start all four services (each in its own terminal)
pnpm --filter @workspace/api-server run dev   # API on $PORT
pnpm --filter @workspace/TolipAI-crm run dev    # CRM  on $PORT
pnpm --filter @workspace/TolipAI-tools run dev  # Tools on $PORT
pnpm --filter @workspace/TolipAI-website run dev # Site on $PORT
```

Set `DATABASE_URL` in your `.env` to point at a local PostgreSQL instance
(e.g. `postgresql://postgres:password@localhost:5432/tolipai`).

### Railway (production)

This repo ships with a [`railway.json`](./railway.json) that defines the build and start commands.

1. Push the repo to GitHub
2. Create a new Railway project → "Deploy from GitHub repo"
3. Railway auto-detects the monorepo and applies `railway.json`
4. Add all env vars from `.env.example` in the Railway Variables panel
5. Provision a Railway PostgreSQL plugin — the `DATABASE_URL` is injected automatically
6. Run `pnpm run push` once (via Railway's shell or a one-off deploy command) to push the schema

Railway serves all four applications behind a single domain using path-based routing:

| Path | Application |
|---|---|
| `/` | TolipAI Website (public marketing) |
| `/crm/` | TolipAI CRM |
| `/tools/` | TolipAI Tools |
| `/api/` | API Server |

### Other platforms (Render / Cloud Run)

Any platform that supports a Node.js build command works. The key requirements are:
- Node 22 runtime
- `pnpm install` + `pnpm run build` as the build step
- `DATABASE_URL` as an environment variable pointing at a PostgreSQL instance
- All other env vars from `.env.example` added to the platform's secrets manager

---

## Screenshots

### TolipAI CRM — Comparable Sales & ARV

Six comps fetched from ATTOM, filtered by property type and sqft ratio, adjusted per comp, with median ARV auto-calculated. Below-threshold ARV/asking ratio flagged in red.

![CRM Comps & ARV](./docs/screenshots/crm-comps-detail.png)

### TolipAI CRM — AI Deal Scorer

Llama 3.1 70B scores the deal 1–10 with profit potential, seller motivation, deal risk, and urgency subscores — plus a concrete opening price recommendation.

![AI Deal Scorer](./docs/screenshots/crm-ai-deal-scorer.png)

### TolipAI CRM — Lead Detail

Full lead profile: property data fetched from ATTOM, integrated Dialer & SMS panel, deal scoring, AI Seller Script, and AI Offer Letter — all in one view.

![Lead Detail](./docs/screenshots/crm-lead-detail.png)

### TolipAI CRM — Lead List with Bulk Actions

Pipeline view with live deal scores, phone + email columns, one-click access to the dialer. **Multi-select checkboxes** let you select up to 200 leads and bulk-update their status in one click via the floating action toolbar. PII redacted in this screenshot.

![Lead List](./docs/screenshots/crm-lead-list.png)

### TolipAI CRM — AI Offer Letter

One-click AI-generated cash offer letter personalized to the seller's situation, property, and your calculated MAO.

![AI Offer Letter](./docs/screenshots/crm-offer-letter.png)

---

### TolipAI Tools — ARV Calculator

Enter any address, choose radius and max comps, and get a full comp table with individual adjustments, median ARV, MAO (70% rule), and conservative offer (65% rule).

![ARV Calculator v1](./docs/screenshots/tools-arv-v1.png)

![ARV Calculator v2](./docs/screenshots/tools-arv-v2.png)

### TolipAI Tools — Repair Cost Estimator

Describe repairs in plain language and get an itemized AI-generated scope of work with line-item costs you can apply directly as the ERC.

![Repair Estimator](./docs/screenshots/tools-repair-estimator.png)

### TolipAI Tools — Property Lookup

Full property profile — AVM, equity, owner, mortgage, and contact info pulled from ATTOM. Owner name and contact info redacted in this screenshot.

![Property Lookup](./docs/screenshots/tools-property-lookup.png)

### TolipAI Tools — Opportunity Finder

Pull motivated-seller property lists by ZIP or county with ATTOM mortgage-based filters (Absentee Owner, Free & Clear, Pre-Foreclosure, Tax Delinquent, Vacant/Abandoned, High Equity).

![Opportunity Finder](./docs/screenshots/tools-opportunity-finder.png)

### TolipAI Tools — Lead Scraper

Bulk keyword × location automation across Google Maps, Google Search, NAR Directory, and Zillow. Select keywords and cities, run all combos sequentially, export results as CSV.

![Lead Scraper](./docs/screenshots/tools-lead-scraper.png)

---

## Business Problem & Case Study

### The Problem

Real estate wholesalers and investors typically rely on 4–6 disconnected tools:

- A lead capture form (Typeform, JotForm)
- A spreadsheet or basic CRM for tracking deals
- A separate phone dialer (Google Voice, SignalWire)
- Manual comps from Zillow or MLS
- A third-party skip trace service ($0.15–$0.50/record)
- A separate distressed list provider ($200–$800/month)

This fragmentation causes deals to fall through the cracks, data to go stale, and teams to waste hours on manual lookups. A wholesaler working 50 leads per month would spend 20–30% of their time on data entry and cross-referencing tools that don't talk to each other.

### The Solution

TolipAI is a unified platform that consolidates every step of the wholesaling workflow:

1. **Lead intake** — Public submission links let motivated sellers submit directly; CRM agents capture inbound leads in a structured 6-section form
2. **Property intelligence** — One click pulls property data (beds/baths/sqft/year/value), skip traces the owner for phone and email, and fetches recently-sold comps automatically
3. **AI-assisted underwriting** — Llama 3.1 70B scores deals 1–10, estimates repair costs from free-text descriptions, generates seller scripts, and writes offer letters — all from within the deal record
4. **ARV calculation** — ATTOM comp data filtered by property type and sqft ratio, adjusted for beds/baths/year/time, with ATTOM AVM as a secondary signal
5. **Communication** — Twilio Voice SDK browser dialer logs calls and SMS messages directly inside the lead record; live call transcription + real-time AI coaching during calls
6. **Distressed list building** — ATTOM mortgage data used to find absentee owners and free-and-clear properties by ZIP or city; enriched with skip trace in one job
7. **Automated follow-up** — Email sequences with per-day-offset scheduling run in the background without any manual trigger

### Measured Impact

| Problem | Before | After |
|---|---|---|
| Time to underwrite a deal | 45–90 minutes across 4 tools | Under 3 minutes in one screen |
| Skip trace cost per record | $0.15–$0.50 (third-party) | Self-hosted via PropertyAPI key rotation |
| ARV accuracy (multi-family contamination) | Frequent 20–40% overestimates | Filtered to SFR comps within ±43% sqft |
| Lead follow-up consistency | Manual and inconsistent | Automated day-offset email sequences |
| Team accountability | Spreadsheets with no audit trail | Role-gated CRM with task assignments and aging alerts |

### Case Study Walkthrough — Lead to Offer in Under 3 Minutes

**Scenario:** Inbound motivated-seller call. Homeowner at `4821 W Cholla St, Phoenix, AZ 85029`
is behind on payments and wants to close in 30 days.

**Step 1 — Lead captured (0:00)**

Agent opens "New Lead" in the CRM, fills in seller name, phone, address, and motivation
("behind on payments"). Saves the record. Total time: ~40 seconds.

**Step 2 — Property data fetched (0:40)**

Agent clicks "Fetch Property Data". One API call to PropertyAPI.co returns:
- 3 bed / 2 bath / 1,420 sqft / built 1978 / SFR
- Owner-confirmed absentee (matches mailing address in another state)
- AVM estimate: $285,000

Fields auto-populate into the lead record. No manual entry.

**Step 3 — Comps pulled and ARV calculated (1:10)**

Agent clicks "Fetch Comps". ATTOM returns 6 SFR sales within 0.5 mi, last 18 months,
all filtered to 810–2,485 sqft. After per-comp adjustments:

| Address | Sale Price | Adjusted |
|---|---|---|
| 4803 W Dahlia Dr | $272,000 | $278,400 |
| 4915 W Cholla St | $265,000 | $271,500 |
| 4701 W Joan De Arc | $291,000 | $284,200 |
| 5003 W Cinnabar Ave | $288,500 | $280,100 |
| 4822 W Gardenia Ave | $275,000 | $277,800 |
| 4600 W Eva St | $269,000 | $275,600 |

**Comp-based ARV: $278,950** (median of adjusted values)
**ATTOM AVM: $281,000** (confidence: 82%) — delta: +0.7% ✓

**Step 4 — AI deal score (1:45)**

Asking price: $195,000. Estimated repairs (from seller description — "roof is 15 years old,
kitchen needs update"): AI Repair Estimator returns `$28,500` line-item breakdown.

- MAO = $278,950 × 0.70 − $28,500 = **$166,765**
- AI Deal Score: **8 / 10**
  - Strengths: strong comp coverage, motivated seller, 30-day close timeline
  - Risk: roof age — confirm scope before locking in repair budget
  - Recommendation: Submit offer at $162,000 with 7-day inspection contingency

**Step 5 — Offer letter generated (2:30)**

Agent clicks "Generate Offer Letter". AI produces a professional PDF-ready offer
document with the property address, offer price ($162,000), 7-day inspection period,
and 30-day closing. Printed and emailed to seller in one click.

**Total elapsed time: ~2 minutes 45 seconds.**

Without TolipAI, this same workflow required pulling up Zillow/MLS for comps (15–20 min),
running a separate skip trace ($0.35/record), manually calculating MAO on a spreadsheet,
and drafting an offer letter in Word. Typical elapsed time: 60–90 minutes.

---

## Architecture Overview

```
monorepo/
├── artifacts/
│   ├── api-server/        Express 5 API — all business logic and integrations
│   ├── TolipAI-crm/       React + Vite CRM portal  (/crm/)
│   ├── TolipAI-tools/     React + Vite internal tools (/tools/)
│   └── TolipAI-website/   React + Vite public marketing site (/)
├── lib/
│   ├── api-spec/          OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/  Generated React Query hooks
│   ├── api-zod/           Generated Zod schemas
│   └── db/                Drizzle ORM schema + PostgreSQL connection
└── scripts/               One-off utility scripts (seeding, migrations)
```

All four applications share a single PostgreSQL database and are served behind a single Railway deployment. The API server runs on a dedicated port; the three React apps are built as static assets and served at path-based routes.

For a full deep-dive into request lifecycle, inbound call routing, JWT payload structure, comparable sales math, API key rotation, and data flow diagrams, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Tech Stack

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js | 22 | Runtime |
| TypeScript | 5.x | Type safety across the entire monorepo |
| Express | 5 | HTTP framework |
| PostgreSQL | 17 (NeonDB) | Primary database |
| Drizzle ORM | latest | Type-safe query builder + schema management |
| Zod | v4 | Runtime validation |
| esbuild | latest | Production bundler (CJS output) |
| pnpm workspaces | 10 | Monorepo package management |
| bcryptjs | latest | Password hashing |
| jsonwebtoken | latest | JWT auth (HS256, 7-day TTL) |
| Pino | latest | Structured JSON logging |

### Frontend (CRM + Tools + Website)
| Technology | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| Vite | 7 | Dev server and build tool |
| TypeScript | 5.x | Type safety |
| TanStack Query | v5 | Server state, caching, mutations |
| TanStack Router | latest | File-based routing |
| Tailwind CSS | v4 | Utility-first styling |
| shadcn/ui | latest | Component library (Radix UI primitives) |
| Framer Motion | latest | Scroll-triggered animations (website) |
| @dnd-kit | latest | Drag-and-drop Kanban board |
| Orval | latest | OpenAPI → React Query hooks codegen |

### AI / LLM
| Technology | Purpose |
|---|---|
| Groq API | Primary inference — sub-second responses via Llama 3.3 70B |
| OpenAI API | Whisper transcription (call recordings), GPT-4o-mini (post-call coaching), GPT-4o Realtime (AI voice agent) |
| Meta Llama 3.3 70B Versatile | Deal scoring, repair estimation, seller scripts, offer letters, live coaching suggestions |

### Telephony
| Technology | Purpose |
|---|---|
| Twilio Voice SDK (`@twilio/voice-sdk`) | Browser-based WebRTC calling (outbound + inbound) |
| Twilio Voice Intelligence | Real-time call transcription webhooks (`/twilio/voice/transcript`) |
| Twilio REST API | Call control, recording, participant management, power dialer |
| Twilio TwiML | Call routing, conference rooms, voicemail, inbound IVR |
| OpenAI Realtime API (gpt-4o-realtime-preview) | AI voice agent for unanswered inbound calls |

### Communications
| Technology | Purpose |
|---|---|
| OpenPhone | Alternative telephony integration with per-lead message threading |
| SMTP (Nodemailer) | Outbound email for automated sequences and contact form |

### Data & Valuation APIs
| API | Purpose |
|---|---|
| ATTOM Data | Comps (`sale/snapshot`), property snapshot, AVM (`attomavm/detail`), mortgage/owner detail (`detailmortgageowner`) |
| PropertyAPI.co | Property data enrichment, skip trace (up to 8 key rotation), AVM |
| Rentcast | Rental valuation and AVM for CRM leads |
| US Census Bureau | Free county FIPS resolution for geo-targeted distressed searches |
| Zippopotam.us | Free ZIP code lookup by city/state for distressed search expansion |

### Infrastructure & Payments
| Technology | Purpose |
|---|---|
| Railway | Deployment platform (Railpack builder) |
| NeonDB | Serverless PostgreSQL 17 |
| Stripe | Subscription management and checkout |
| AWS Fargate Spot | Python scraper engine (Playwright + FastAPI) |
| Sentry | Error tracking (optional — gated on `SENTRY_DSN`) |

---

## Applications

### TolipAI CRM

Multi-tenant CRM built for real estate wholesaling teams. Each client organization is isolated in its own Campaign workspace.

#### Role-Based Access Control

| Role | Access |
|---|---|
| `super_admin` | TolipAI staff; cross-campaign visibility; can create campaigns and campaign admins; can view any user's stored plain-text password |
| `admin` | Campaign admin; manages their campaign's users, leads, tasks, links |
| `sales` | Full lead read/write within their campaign |
| `va` | View/edit leads assigned to them only |

#### CRM Pages

| Page | Description |
|---|---|
| Dashboard | Live deal stats: active leads, tasks due, pipeline value, ARV totals |
| Lead List | Paginated lead table with aging badges (7-day orange, 14-day+ red), quick filters, and call motivation emoji (🔥✅⚡❄️) from last AI call score |
| New Lead | 6-section structured intake form: seller info, property details, motivation, financials, notes |
| Lead Detail | Full deal workspace — see below |
| Pipeline | Drag-and-drop Kanban board with all 7 status columns; visual aging indicators |
| Tasks | Cross-lead task list with due dates and assignees |
| Buyers List | Buyer database for deal assignment and co-wholesaling |
| Email Sequences | Automated follow-up sequences with day-offset steps and template variables |
| **Manual Dialer** (`/integrations/phone-numbers`) | OpenPhone-style 3-column inbox: owned Twilio numbers → unified call+SMS conversation list → full message thread with compose box and call button. See [MANUAL_DIALER_PLAN.md](./MANUAL_DIALER_PLAN.md) for the full roadmap. |
| Campaign Management | Super admin: create/manage client campaigns |
| Team Users | Admin: invite and manage team members; super admin can view any user's stored password |
| Submission Links | Tokenized public links for seller self-submission |
| Billing | Admin: open Stripe Customer Portal to manage subscription, invoices, and payment method |

#### Lead Detail — Full Feature Breakdown

The lead detail page is the core of the CRM. Every feature below is accessible from a single screen:

**Property Data**
- One-click property data fetch via PropertyAPI.co (auto-fills beds/baths/sqft/type/year/coordinates)
- Manual field editing with condition scoring (1–10 slider), occupancy, and rental flag

**Comparable Sales & ARV**
- Auto-fetch comps: 4-step radius search (0.1mi → 0.25mi → 0.5mi → 1mi), filters to last 24 months, up to 8 comps
- Manual comp entry with address, beds/baths/sqft/year/sale price
- Adjustment engine: `$12,500/bed`, `$7,500/bath`, `$50/sqft`, `$150/year-built`
- Automatic ARV recalculation and MAO update after each comp change
- Deal quality flag: warns when `ARV / asking price < 1.7x`
- **ATTOM comp fetch**: radius-based lat/lon query via `sale/snapshot`, property-type filter (excludes multi-family), sqft ratio filter (0.57–1.75×), time-appreciation adjustment (3%/year)
- **Rentcast AVM**: on-demand rental/sale valuation with range
- **ATTOM AVM**: secondary automated valuation from `attomavm/detail` with confidence score and low/high range

**AI Features (Groq — Llama 3.3 70B)**
- **AI Deal Scorer**: Scores the deal 1–10 with detailed reasoning; considers ARV, asking price, repair estimate, MAO, seller motivation, property condition, and timeline
- **AI Repair Estimator**: Parses a free-text property description ("roof needs work, kitchen dated, HVAC is 15 years old") and returns a line-item cost breakdown with total; one-click apply to the deal record
- **AI Seller Script**: Generates a structured call script with an opener, discovery questions, objection handling, and close — personalized to the seller's motivation and situation
- **AI Offer Letter**: Generates a professional offer letter with deal terms, contingencies, and closing timeline; rendered as a printable HTML document

**Communications — Browser Dialer (Twilio Voice SDK)**
- WebRTC in-browser calling — no phone hardware required
- Live call quality metrics: MOS score, jitter (ms), packet loss (%)
- On-hold support with hold music via Twilio conference participant API
- DTMF keypad for IVR navigation
- **Voicemail drop**: pre-recorded voicemail plays to lead; agent hangs up and moves on
- **Warm transfer**: bridges a third party into an existing call; agent can leave cleanly
- Call recording with Twilio recording status callback
- **Automatic Whisper transcription**: triggered by recording webhook, saves to `crm_call_logs`
- **Post-call AI Summary** (Groq/OpenAI): key points, seller motivation score, recommended next step — auto-generated on hang-up from live transcript; "Save to Lead Notes" button writes the summary directly into the lead's activity log
- **Call motivation scoring**: AI summary produces a 1–10 motivation score (🔥 Hot ≥9, ✅ Motivated ≥7, ⚡ Warm ≥5, ❄️ Cold <5); score is persisted to `crmLeads.lastMotivationScore` and displayed as an emoji badge on every lead list card
- **Live Transcript** (real-time during call): Twilio Voice Intelligence streams the call transcript; dual-speaker bubble view inside the dialer — agent segments right-aligned (primary tint), seller segments left-aligned (secondary border) with auto-scroll
- **Post-call AI Call Coaching** (GPT-4o-mini): score 1–10, strengths, improvements, suggested follow-up task, and offer price recommendation — triggered 90s after call ends (recording must process)
- **Live AI Coaching** (real-time during call): debounced AI suggestion appears in the dialer panel every time the seller speaks, giving the agent a live rebuttal or talking point; dismiss button clears it
- Call disposition picker: Answered / No Answer / Left Voicemail / Not Interested / Wrong Number / Callback Requested

**Inbound Call Routing**
- Inbound calls ring all browser clients simultaneously + a configurable forward phone number
- On no-answer: routes to AI voice agent (OpenAI Realtime `gpt-4o-realtime-preview`) or voicemail depending on key availability
- See [ARCHITECTURE.md — Inbound Call Routing](./ARCHITECTURE.md#inbound-call-routing) for the full resolution chain

**Power Dialer** (`/dialer/power`)
- Session-based dialing queue backed by `crm_background_jobs`
- **True parallel AMD (Answering Machine Detection)**: all lines dialed simultaneously via `Promise.all`; Twilio AMD (`machineDetection: "Enable"`, 30s timeout) routes humans to agent conference and hangs up on machines; answered-call stats tracked in `activeCalls` map
- **`/power-dial/amd-handler` webhook**: machine → immediate hangup + stats update; human → cancel sibling calls + bridge agent via `<Dial><Conference>`
- DB row-locking via Drizzle `.for("update")` prevents race conditions when multiple AMD responses arrive simultaneously
- Disposition logging + session advance on each call
- Session persists across deploys (DB-backed state)
- **List upload**: CSV/XLSX import via Papa Parse (browser-side parsing, no server roundtrip); E.164 normalization applied to all imported numbers

**Workflow**
- Status pipeline: `new_lead → contacted → negotiating → under_contract → closed_won → closed_lost → on_hold`
- Task assignment and due dates directly from the lead detail
- Note history with `@username` mention support and follower notifications
- Offer letter print (client-side HTML rendering, no server required)

#### Email Sequences

Background job (hourly `setInterval`) sends automated emails based on `day_offset` since lead creation. Template variables: `{{name}}`, `{{address}}`. Deduplication via `crm_sequence_logs` table prevents double-sends. Sequences are campaign-scoped and role-gated.

#### Public Lead Submission

Tokenized submission links allow motivated sellers to fill out a form directly. Submissions are validated, created in the CRM, and assigned to the campaign automatically. No account required for the seller.

---

### TolipAI Tools

PIN-gated internal tools portal for acquisition and research work. Separate from the CRM — accessible to staff without a CRM login.

#### Tools Pages

**Skip Trace (Bulk)**
- Upload CSV or XLSX file (parsed client-side via SheetJS/Papa Parse)
- Automatic column detection: street, city, state, ZIP, owner name — or detects combined address columns (e.g., `120 W 3RD ST, TULSA, OK 74103`)
- Batches of 10 records; passes owner name when available to save credits (1 vs 2 credits/lookup)
- Up to 8 PropertyAPI.co keys in round-robin rotation with automatic depletion detection
- Background job with real-time progress polling
- CSV export with `_status`, `_phones`, `_emails`, `_owner` columns appended

**Distressed Property Finder**
- ATTOM `property/detailmortgageowner` endpoint
- Search by ZIP code or city (auto-expands to all ZIPs in the city via Zippopotam.us)
- Filters: Absentee Owner, Free & Clear (no mortgage), Pre-Foreclosure, Foreclosure, Tax Delinquent, Vacant
- Server-side filtering for mortgage-based categories; label-tagging for others
- Returns: owner name, corporate indicator, mailing address, absentee status, mortgage amount/date/lender/type, LTV %, assessed value
- CSV export
- **Deep Skip Trace**: Enrich distressed results with owner phone and email in one additional job

**ARV Calculator**
- Full address input with smart auto-parse (paste `123 Main St, Phoenix, AZ 85001` and fields auto-fill)
- Step 1: PropertyAPI geocode + property details (beds/baths/sqft/year/AVM)
- Step 2: ATTOM subject sqft via `property/snapshot` (uses `universalsize` — heated living area — to match comp scale)
- Step 3: ATTOM `sale/snapshot` radius comp fetch
- Step 4: Property type filter — excludes MULTI, DUPLEX, TRIPLEX, QUADRUPLEX, COMMERCIAL, APARTMENT
- Step 5: Sqft ratio filter — excludes comps outside 0.57–1.75× subject sqft
- Step 6: Per-comp adjustments (sqft at market rate, baths, year-built, time appreciation at 3%/year)
- Step 7: ATTOM AVM secondary valuation — shows value, range, confidence %, and delta vs comp-based ARV
- Progressive lookback: tries 24 months → 48 months → 84 months until comps are found
- Market price-per-sqft: derived from median of actual comp data; falls back to AI estimate if insufficient

**Property Lookup**
- Single-property deep lookup: PropertyAPI data + ATTOM mortgage/owner + skip trace run in parallel
- Returns: AVM, assessed value, last sale, owner names, absentee status, mailing address, corporate flag, mortgage amount/lender/type/term/due date, equity estimate, LTV, phones, emails

**Lead Scraper** (Bulk Property Research)
- Upload a list of addresses
- Batch enrichment with PropertyAPI
- Progress tracking with per-record status

---

### TolipAI Website

Public-facing B2B marketing site for TolipAI LLC.

- Dark professional design with gold accent palette
- Sections: Hero, Services, Methodology, Case Studies, Team, About, Contact
- Framer Motion scroll-triggered animations
- Contact form connected to API
- Chatbot component
- Stripe checkout integration for service subscriptions
- Professional industry language (compliance-aware copy)

---

### API Server

Express 5 API server. All business logic lives here; the React apps are thin clients.

**Route Groups**

| Prefix | Description |
|---|---|
| `/api/crm/auth/` | Login, session, JWT issuance |
| `/api/crm/campaigns/` | Campaign CRUD (super admin) |
| `/api/crm/leads/` | Lead CRUD + all AI, valuation, comps, and comms routes |
| `/api/crm/tasks/` | Task CRUD |
| `/api/crm/users/` | User management; `GET /:id/password` (super admin only) |
| `/api/crm/links/` | Submission link management + public submit endpoint |
| `/api/crm/sequences/` | Email sequence + step CRUD |
| `/api/crm/buyers/` | Buyer database |
| `/api/crm/stats/` | Dashboard statistics |
| `/api/crm/billing/` | Stripe Customer Portal session (admin self-service) |
| `/api/crm/notifications/` | In-app notifications |
| `/api/crm/analytics/` | Campaign analytics |
| `/api/crm/contracts/` | Contract management |
| `/api/crm/events` | Server-sent events (real-time push — incoming calls, live transcripts, AI suggestions) |
| `/api/tools/` | Skip trace, distressed finder, ARV, property lookup |
| `/api/twilio/voice/token` | Twilio Access Token for browser dialer (Voice SDK) |
| `/api/twilio/voice/answer` | TwiML App Voice URL — call whisper + conference or `<Dial>` |
| `/api/twilio/voice/inbound` | Inbound call routing (campaign resolution → lead lookup → ring clients) |
| `/api/twilio/voice/recording` | Recording status callback — saves SID/URL, triggers Whisper transcription |
| `/api/twilio/voice/transcript` | Twilio Voice Intelligence real-time transcription webhook |
| `/api/twilio/voice/coach` | Post-call AI coaching (GPT-4o-mini via transcript) |
| `/api/twilio/voice/call-summary` | Post-call AI summary (key points, motivation score, next step) |
| `/api/twilio/voice/log` | Create/update call log entries |
| `/api/twilio/voice/hold` | Toggle hold on active conference participant |
| `/api/twilio/voice/warm-transfer` | Bridge a third party into an active conference |
| `/api/twilio/voice/voicemail-drop` | Drop a pre-recorded voicemail and disconnect |
| `/api/twilio/voice/power-dial/*` | Power dialer session management |
| `/api/twilio/voice/agent-stream` | WebSocket endpoint for AI voice agent (OpenAI Realtime) |
| `/api/twilio/` | SMS webhooks + inbound SMS routing |
| `/api/openphone/` | OpenPhone webhook + message retrieval |
| `/api/stripe/` | Checkout session creation, webhook, subscriptions list |
| `/api/contact/` | Public contact form (SMTP delivery) |
| `/api/subscribe/` | Email subscription management |
| `/api/healthz` | Liveness probe (no deps) |
| `/api/health` | Readiness probe (DB ping) |

---

## AI Integrations

### Primary Inference — Groq (Llama 3.3 70B Versatile)

All synchronous AI features use the Groq API for sub-second inference:

### AI Deal Scorer (`POST /api/crm/leads/:id/ai-deal-score`)

Inputs the full deal record: ARV, asking price, estimated repair cost, MAO, beds/baths/sqft/condition, seller motivation, occupancy, and how soon the seller needs to close.

Returns:
- `score` (1–10)
- `summary` — one paragraph narrative
- `strengths` — array of positive signals
- `risks` — array of risk factors
- `recommendation` — actionable next step

### AI Repair Estimator (`POST /api/crm/leads/:id/ai-repair-estimate`)

Takes a free-text property description from the agent's notes or a walkthrough description. Parses it into line-item repair categories (roof, HVAC, kitchen, baths, flooring, paint, electrical, plumbing, foundation) and returns itemized costs with a total. One-click applies the total to the deal's `erc` field.

### AI Seller Script (`POST /api/crm/leads/:id/ai-seller-script`)

Generates a personalized outbound call script using the seller's name, address, reason for selling, timeline, asking price, and property condition. Output is structured with:
- Opener
- Rapport building
- Discover pain (open-ended questions)
- Present solution
- Handle objections
- Close / next step

### AI Offer Letter (`POST /api/crm/leads/:id/ai-offer-letter`)

Generates a professional purchase offer letter in plain English with:
- Subject property details
- Offer price (MAO or custom)
- Closing timeline
- Contingencies
- Terms and conditions

Rendered as a printable HTML document the agent can hand to the seller or send by email.

### Post-Call AI Summary (`POST /api/twilio/voice/call-summary`)

Triggered automatically on call hang-up from the live browser transcript (no wait for recording). Also accepts a `callSid` to pull the Whisper-transcribed version from the DB.

**Output:**
- `keyPoints` — array of key talking points from the call
- `motivationScore` (1–10) — seller urgency: 9–10 = Hot, 7–8 = Warm, 5–6 = Moderate, 1–4 = Cold
- `motivationLabel` — `Hot | Warm | Moderate | Cold`
- `sellerSituation` — one sentence on the seller's main pain point
- `nextStep` — specific recommended next action

After reviewing, the agent clicks **"Save to Lead Notes"** to write the summary directly into the lead's activity log as a structured note.

### AI Call Coach (`POST /api/twilio/voice/coach`)

After a recorded call is transcribed (via Whisper, automatically triggered by the Twilio recording webhook ~30–120s after call ends), agents can request AI coaching feedback on the call.

**Input:** `callSid` — the endpoint fetches the transcript from `crm_call_logs` automatically.

**Output:**
- `score` (integer 1–10)
- `strengths` — one sentence on what went well
- `improvements` — the single most important thing to improve
- `followUpTask` — specific next step (e.g. "Send offer letter for $145,000 by Friday")
- `suggestedOffer` — suggested offer price in dollars (or `null` if no pricing context)
- `offerRationale` — one sentence explaining the suggested price

Results are persisted to `crm_call_logs.ai_coaching_summary` (JSON) and displayed in the BrowserDialer post-call panel.

**Requirement:** `OPENAI_API_KEY` or `GROQ_API_KEY` must be set. Returns HTTP 503 if neither is configured.

### Live AI Coaching (Real-Time During Calls)

Powered by **Twilio Voice Intelligence** (real-time transcription webhook) + Groq inference.

**How it works:**
1. Twilio Voice Intelligence streams call audio and POSTs transcript segments to `POST /api/twilio/voice/transcript`
2. Each inbound (seller) segment is stored in an in-memory transcript buffer per `callSid`
3. 5 seconds after the last inbound segment, Groq generates a short rebuttal/talking point (under 40 words)
4. The suggestion is pushed to the agent's browser via SSE (`call_suggestion` event)
5. The BrowserDialer displays a purple "Live AI Coaching" panel with the suggestion and a dismiss button

**Twilio Voice Intelligence webhook format** (`POST /api/twilio/voice/transcript`):

| Field | Type | Description |
|---|---|---|
| `CallSid` | string | The call SID this transcript segment belongs to |
| `AccountSid` | string | Twilio account SID |
| `TranscriptionEvent` | string | `transcription-started`, `transcription-content`, or `transcription-stopped` |
| `TranscriptionData` | string (JSON) | JSON string: `{"transcript": "...", "confidence": 0.95}` |
| `Track` | string | `inbound_track` (seller) or `outbound_track` (agent) |

To enable: configure the Twilio Voice Intelligence transcription service and point its webhook URL to `https://your-domain.com/api/twilio/voice/transcript`.

### AI Voice Agent (Inbound — OpenAI Realtime)

When an inbound call is not answered, the system automatically routes to the AI voice agent at `wss://<host>/api/twilio/voice/agent-stream`. Uses OpenAI `gpt-4o-realtime-preview` over Twilio Media Streams (G.711 μ-law audio). Gracefully falls back to voicemail if `OPENAI_API_KEY` is not set.

### Market Price-Per-Sqft Estimation (ARV Calculator fallback)

When the ATTOM comp data doesn't include enough sqft readings to derive a median, the ARV calculator requests an AI estimate of the local price-per-sqft. The model is provided the city, state, and ZIP and returns a market-calibrated value used in comp adjustments.

---

## Third-Party APIs & Integrations

### Twilio

Full telephony stack — browser dialer, inbound routing, recording, transcription, power dialer:

| Capability | Mechanism |
|---|---|
| Browser calling (WebRTC) | Twilio Voice SDK + TwiML App (`/api/twilio/voice/answer`) |
| Inbound routing | `POST /api/twilio/voice/inbound` — campaign lookup → lead lookup → `<Dial><Client>` |
| Recording | `record-from-start` attribute → recording status callback (`/api/twilio/voice/recording`) |
| Real-time transcription | Twilio Voice Intelligence → `POST /api/twilio/voice/transcript` |
| Hold music | Conference Participant API (`hold=true`) |
| Warm transfer | `POST /api/twilio/voice/warm-transfer` → REST API call adds participant |
| Voicemail drop | TwiML `<Play>` on active call leg |
| Power dialer | REST API multi-call via `<Dial><Number>` with multiple `To` numbers |
| AI voice agent (inbound) | Twilio Media Stream → WebSocket → OpenAI Realtime |

### ATTOM Data Solutions

Used across both the CRM and Tools:

| Endpoint | Usage |
|---|---|
| `property/snapshot` | Geocoding, subject property sqft (universalsize) |
| `sale/snapshot` | Recently sold comparable sales by lat/lon radius |
| `attomavm/detail` | Automated valuation model — value, range, confidence score |
| `property/detailmortgageowner` | Owner name, absentee status, mortgage data for distressed search |

Key rotation: supports `ATTOM_API_KEY` and `ATTOM_API_KEY_2` with automatic failover. 401/403 responses mark the key as depleted and rotate to the next.

### PropertyAPI.co

Used for skip trace, property enrichment, and AVM:

| Feature | Usage |
|---|---|
| `parcels/search-by-address` | Property details: beds/baths/sqft/year/AVM/last-sale/owner/coordinates |
| `skip-trace` (POST, batch) | Owner phones and emails; 1 credit with name, 2 without |

Up to 8 API keys in round-robin rotation (`PROPERTY_API_KEY` plus `PROPERTY_API_KEY_1` through `PROPERTY_API_KEY_7`). Depletion detection from both HTTP 402 status and response body inspection.

### Rentcast

On-demand rental and sale AVM for CRM leads. Called from the Lead Detail panel and returns a valuation with range.

### OpenPhone

Alternative telephony provider. Webhook ingestion + per-lead message display with a dedicated panel in Lead Detail.

### Stripe

Subscription checkout for TolipAI's service tiers. Full lifecycle:

- **Checkout** — Three-tier pricing (`Full Package $1,500/mo`, `Growth Infrastructure $1,000/mo`, `Half Package $750/mo`). TOS consent collection baked in.
- **Webhook** — `checkout.session.completed` auto-provisions a new CRM campaign, hashes a temporary password, saves the Stripe `customer.id` on the campaign, and sends a welcome email with credentials.
- **Customer Portal** — `POST /api/crm/billing/portal` (admin-only JWT) creates a Stripe Billing Portal session. Campaign admins click "Open Billing Portal" inside the CRM to manage their subscription, update payment method, view invoices, and cancel — all without contacting support.

### US Census Bureau API

Free public API used to resolve county names to ATTOM-compatible FIPS-based geoid strings (e.g., `CO24031` for Montgomery County, MD). Used in the distressed finder's county/state search modes. Results are in-memory cached per process lifetime.

### Zippopotam.us

Free ZIP code lookup by city and state. Used in the distressed finder to expand a "City, ST" input into all ZIP codes for that city before querying ATTOM.

---

## Database Schema

PostgreSQL via Drizzle ORM. All CRM tables are campaign-scoped.

| Table | Description |
|---|---|
| `crm_campaigns` | Client organizations — id, name, slug, active, `stripe_customer_id`, `twilio_forward_phone`, `max_users` |
| `crm_users` | Team members — role, email, bcrypt `password_hash`, `password_plain` (super admin recovery), campaign FK |
| `crm_leads` | Core deal record — all property, seller, financial, and status fields |
| `crm_notes` | Lead notes with `@mention` support |
| `crm_tasks` | Tasks linked to leads and users with due dates |
| `crm_submission_links` | Tokenized public intake URLs |
| `crm_comps` | Comparable sales per lead with adjustment fields |
| `crm_email_sequences` | Sequence definition with campaign scope |
| `crm_sequence_steps` | Per-step day offset + email subject/body template |
| `crm_sequence_logs` | Sent-email deduplication log |
| `crm_call_logs` | Twilio call records — `call_sid`, `recording_sid`, `recording_url`, `transcript`, `ai_coaching_summary`, `disposition`, MOS/jitter metrics |
| `crm_openphone_messages` | Inbound/outbound messages from OpenPhone |
| `crm_buyers` | Buyer database for deal assignment and co-wholesaling |
| `crm_lead_followers` | Follow subscriptions for lead activity notifications |
| `crm_notifications` | In-app notification queue per user |
| `crm_background_jobs` | Power dialer sessions and other async jobs |
| `crm_faxes` | Fax records (inbound/outbound) |
| `crm_contracts` | Contract documents per lead |
| `crm_waitlist` | Public waitlist signups |
| `contacts` | Website contact form submissions |
| `subscribers` | Email list subscribers |

### Key Column Migrations (`seed.ts` — `ensureColumns`)

New columns are added at startup via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — no manual migration step needed:

| Column | Description |
|---|---|
| `crm_call_logs.disposition` | Call outcome label (Answered, No Answer, etc.) |
| `crm_call_logs.ai_coaching_summary` | JSON from GPT-4o-mini post-call coaching |
| `crm_campaigns.stripe_customer_id` | Stripe customer for billing portal |
| `crm_campaigns.twilio_forward_phone` | E.164 phone to ring simultaneously with browser clients |
| `crm_users.password_plain` | Stored cleartext for super admin recovery (`GET /api/crm/users/:id/password`) |

---

## Key Engineering Decisions

### Why Groq instead of OpenAI (for sync AI features)

Groq's LPU hardware delivers token generation at 200–400 tokens/second versus OpenAI's 40–80 tokens/second on GPT-4. For interactive features like deal scoring and script generation that run inside a CRM workflow, latency matters. Llama 3.3 70B on Groq provides GPT-4-class reasoning at near-real-time speeds.

OpenAI is used for Whisper (audio transcription — no Groq equivalent), GPT-4o Realtime (AI voice agent — requires OpenAI's proprietary real-time protocol), and GPT-4o-mini (post-call coaching — better instruction following for structured JSON scoring).

### ARV comp quality filters

ATTOM's `sale/snapshot` returns all property sales within the radius regardless of type. A quadruplex has 4× the living area of a single-family home — if included as a comp, it inflates the ARV by 30–60%. The property type filter and sqft ratio filter (0.57–1.75×) together ensure that only genuinely comparable properties influence the ARV calculation.

### ATTOM `universalsize` vs `livingsize`

ATTOM exposes two sqft fields: `universalsize` (heated living area, consistent across all property types) and `livingsize` (sometimes missing or unreliable for older records). The platform explicitly uses `universalsize` for both the subject property lookup and comp selection, ensuring the sqft adjustments are apples-to-apples.

### Conference-based calling (vs. classic `<Dial><Number>`)

The browser dialer uses Twilio conferences (`<Conference>`) rather than a simple `<Dial><Number>`. This enables proper hold music via the Participant API (`hold=true`), warm transfers (add a participant to an existing conference), and reliable recording attribution. Falls back to classic `<Dial>` when API key credentials are unavailable.

### PropertyAPI key rotation

Single API keys for skip trace services deplete quickly on bulk jobs. The platform supports up to 8 keys with round-robin rotation and automatic depletion detection — both from HTTP 402 responses and from JSON error bodies that contain "Insufficient credits". This allows a single bulk job to seamlessly continue across multiple keys without manual intervention.

### Multi-tenancy via JWT campaign isolation

Rather than separate databases or schemas per client, campaign isolation is enforced at the query level: every route reads `campaignId` from the verified JWT and appends it as a WHERE clause. Super admins have a null `campaignId` and see all data. This makes the system operationally simple (one schema, one connection pool) while maintaining strict data separation.

### Email sequence background job

Rather than a separate worker process or queue system, the sequence sender runs as an in-process `setInterval` on the API server. This works because the job is idempotent (checked against `crm_sequence_logs`) and low-frequency (hourly). It avoids the operational overhead of Redis/BullMQ for a use case that doesn't require sub-minute precision.

### Identity sequence self-healing (NeonDB)

NeonDB's serverless PostgreSQL can let serial/identity sequences drift to 0 or NULL during inactivity, causing "null value in column id" INSERT failures. The server repairs sequences on every startup via `ALTER TABLE ... RESTART WITH MAX(id)+1`, and route handlers use a `safeInsertCallLog()` wrapper that retries with an explicit `MAX(id)+1` on this specific error class.

---

## Environment Variables

### Core (required)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`) |
| `JWT_SECRET` | JWT signing secret — minimum 32 characters |
| `CRM_ADMIN_EMAIL` | Primary super admin email (seeded/synced on startup) |
| `CRM_ADMIN_PASSWORD` | Primary super admin password |
| `CRM_ADMIN_EMAIL2` | Secondary super admin email (optional) |
| `CRM_ADMIN_PASSWORD2` | Secondary super admin password (optional) |
| `TOOLS_PIN` | Numeric PIN to access the tools portal |

### AI / LLM

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes (most AI features) | Groq inference key — deal scoring, scripts, comps fallback, live coaching |
| `OPENAI_API_KEY` | Yes (voice features) | OpenAI key — Whisper transcription, GPT-4o Realtime AI agent, GPT-4o-mini coaching |
| `AI_MODEL` | No | Override default Groq model (default: `llama-3.3-70b-versatile`) |

### Twilio (Voice & SMS)

| Variable | Required | Description |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Yes (global/super admin) | Global Twilio Account SID (`ACxxx`) |
| `TWILIO_AUTH_TOKEN` | Yes (global/super admin) | Global Twilio Auth Token |
| `TWILIO_API_KEY_SID` | Yes (browser dialer) | Global Twilio API Key SID (`SKxxx`) for Voice SDK token generation |
| `TWILIO_API_KEY_SECRET` | Yes (browser dialer) | Global Twilio API Key Secret |
| `TWILIO_VOICE_APP_SID` | Yes (browser dialer) | Global Twilio TwiML App SID (`APxxx`) — routes outbound calls |
| `TWILIO_VOICE_CALLER_ID` | Yes (browser dialer) | Global outbound caller ID (E.164, e.g. `+15551234567`) |
| `API_BASE_URL` | Yes (webhooks) | Public base URL of the API server (e.g. `https://your-app.railway.app/api`) — used in all Twilio webhook URLs |

> Per-campaign Twilio credentials are stored encrypted in `crm_campaigns` and override the global env vars for all campaign-scoped calls. Global env vars serve as fallback for super admins with no campaign assigned.

### Data APIs

| Variable | Required | Description |
|---|---|---|
| `ATTOM_API_KEY` | Yes (comps/AVM) | Primary ATTOM Data API key |
| `ATTOM_API_KEY_2` | No | Secondary ATTOM key for automatic rotation on 401/403 |
| `PROPERTY_API_KEY` | Yes (property/skip trace) | PropertyAPI.co key (legacy single-key slot) |
| `PROPERTY_API_KEY_1`–`_7` | No | Additional PropertyAPI keys for round-robin rotation |
| `RENTCAST_API_KEY` | No | Rentcast AVM key |

### Communications

| Variable | Required | Description |
|---|---|---|
| `OPENPHONE_API_KEY` | No | OpenPhone API key for message threading |
| `SMTP_HOST` | No | SMTP server for email sequences and contact form |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | No | From address for outbound email |

### Payments & Infrastructure

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | No | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |
| `ENCRYPTION_KEY` | Yes (campaign secrets) | AES-256 key for encrypting Twilio credentials stored in DB |
| `SENTRY_DSN` | No | Sentry error tracking DSN |

---

## Production Notes

### Email Sequence Sender

The automated email sequence runs as an **in-process `setInterval`** on the API server
(fires every hour). This is intentional for simplicity — the job is idempotent (guarded by
`crm_sequence_logs`) and low-frequency, so it survives restarts safely.

**For production environments with strict uptime requirements**, replace the `setInterval`
with an external scheduler:

| Option | Notes |
|---|---|
| Railway cron job | Native — add a second Railway service with a `0 * * * *` schedule |
| GitHub Actions scheduled workflow | Free for public repos; reliable if repo is on GitHub |
| External cron container | Full control; runs independently of the API server |

The sequence sender code lives in `artifacts/api-server/src/services/emailService.ts`.

### JWT Secret Rotation

JWTs are signed with `JWT_SECRET`. Rotating this secret invalidates **all active sessions
immediately** — users will be logged out. Coordinate rotations during off-peak hours and
notify your team in advance.

### PropertyAPI Key Depletion State

Key depletion flags (which keys are out of credits) are held **in memory per process**.
A server restart resets these flags. For high-volume bulk operations, consider persisting
depletion state in the database or Redis so restarts don't retry exhausted keys.

### Database Migrations

This project uses **Drizzle Kit `push`** (schema push) rather than a migration file system.
New columns added after initial schema deployment are applied automatically at startup via
`ensureColumns()` in `seed.ts` (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

Before going to production with real customer data, consider switching to `drizzle-kit generate` + `migrate` so schema changes are tracked and reversible.

### Twilio Voice Intelligence — Enabling Live Transcription

To enable live AI coaching during calls:
1. Enable Voice Intelligence on your Twilio account
2. Create a Transcription Service in the Twilio console
3. Set the transcription webhook URL to `https://your-domain.com/api/twilio/voice/transcript`
4. Associate the service with your TwiML App or use `<Start><Transcription>` in your TwiML

The webhook handler at `/api/twilio/voice/transcript` is already implemented and ready.

---

## Project Structure Details

```
artifacts/api-server/src/
├── routes/
│   ├── crm/
│   │   ├── leads.ts          # Core deal routes + all AI endpoints
│   │   ├── comps.ts          # Comparable sales CRUD + adjustment math
│   │   ├── sequences.ts      # Email sequence management + background job
│   │   ├── auth.ts           # JWT login/session
│   │   ├── users.ts          # User CRUD + super admin password recovery
│   │   ├── campaigns.ts      # Campaign CRUD (super admin)
│   │   ├── tasks.ts          # Task management
│   │   ├── stats.ts          # Dashboard statistics
│   │   ├── buyers.ts         # Buyer database
│   │   └── middleware.ts     # crmAuth · crmAdminOnly · crmSuperAdminOnly
│   ├── twilio-voice.ts       # Browser dialer · recording · coaching · power dialer
│   ├── twilio-voice-agent.ts # AI inbound voice agent (OpenAI Realtime WebSocket)
│   ├── twilio-power-dialer.ts# Power dialer session management
│   ├── twilio.ts             # SMS webhooks + routing
│   ├── openphone.ts          # OpenPhone webhook + message retrieval
│   ├── stripe.ts             # Stripe checkout + webhook + billing portal
│   ├── sse.ts                # Server-sent events hub (real-time push)
│   ├── tools.ts              # Tools portal: skip trace, distressed, ARV, lookup
│   └── health.ts             # /healthz + /health (DB ping)
├── services/
│   ├── twilioCredentials.ts  # resolveVoiceConfig · resolveSmsCreds · per-campaign AES decryption
│   ├── attomApi.ts           # ATTOM client with key rotation + fetchAttomAvm
│   ├── propertyApi.ts        # PropertyAPI client + skip trace
│   ├── aiConfig.ts           # Unified AI client (OpenAI + Groq fallback)
│   ├── emailService.ts       # Nodemailer SMTP + sequence sender
│   └── automation.ts         # Task automation cron + onboarding emails
├── lib/
│   ├── logger.ts             # Pino structured logging
│   ├── validate.ts           # Zod request body validation helpers
│   ├── textUtils.ts          # stripJsonMarkdown · csvCell
│   └── webhookBase.ts        # getWebhookBase — builds Twilio callback URLs
└── seed.ts                   # ensureColumns · ensureIndexes · ensureTables · seedAdmin
```

---

## Scraper Engine — AWS Fargate Spot Architecture

The TolipAI Scraper Engine (`artifacts/TolipAI-scraper-engine/`) runs as a standalone
Python service (FastAPI + Playwright) deployed on **AWS Fargate Spot** — giving
~70% cost reduction versus on-demand Fargate while maintaining reliability through
graceful spot interruption handling, Redis job persistence, and automatic retry.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         AWS VPC                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           ECS Cluster (Fargate Spot)                 │   │
│  │                                                      │   │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐            │   │
│  │   │ Worker  │  │ Worker  │  │ Worker  │  Auto-scale │   │
│  │   │ 2vCPU   │  │ 2vCPU   │  │ 2vCPU   │  2–20 tasks │   │
│  │   │ 4GB ARM │  │ 4GB ARM │  │ 4GB ARM │             │   │
│  │   └────┬────┘  └────┬────┘  └────┬────┘             │   │
│  │        └─────────────┴─────────────┘                 │   │
│  │                      │                               │   │
│  │           ┌──────────┴──────────┐                   │   │
│  │           │  ElastiCache Redis  │                   │   │
│  │           │  (Jobs + Sessions   │                   │   │
│  │           │   + Retry Streams)  │                   │   │
│  │           └─────────────────────┘                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │ RDS Postgre │  │ S3 (cache + │  │ Secrets Manager │   │
│  │ (persistent)│  │  exports)   │  │ (all creds)     │   │
│  └─────────────┘  └─────────────┘  └─────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Internal ALB  →  /health every 30s                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Infrastructure Files

```
infrastructure/
├── ecs-task-definition.json  — ECS task def: ARM64, 2vCPU/4GB, secrets from Secrets Manager
├── ecs-service.json          — Fargate Spot capacity strategy (80% Spot, 20% on-demand base)
├── deploy.sh                 — Build ARM64 image → push ECR → register task def → update service
├── ecr-push.sh               — Image-only build+push (for CI pipelines)
├── cloudwatch-config.json    — Metric filters, alarms, and Logs Insights saved queries
└── iam-policies.json         — Task role (S3 + CloudWatch) and execution role (ECR + Secrets)
```

### Deploying to AWS

**Prerequisites:** AWS CLI v2, Docker Buildx with QEMU (for ARM64 cross-compile), `jq`

```bash
# 1. Set your AWS config
export AWS_ACCOUNT_ID=123456789012
export AWS_REGION=us-east-1

# 2. Store secrets in Secrets Manager (one-time)
aws secretsmanager create-secret \
  --name tolipai/scraper/database-url \
  --secret-string "postgresql://user:pass@rds-host:5432/tolipai"

# 3. Create the ECS cluster (one-time)
aws ecs create-cluster --cluster-name TolipAI-scraper-cluster \
  --capacity-providers FARGATE_SPOT FARGATE \
  --default-capacity-provider-strategy \
    capacityProvider=FARGATE_SPOT,weight=4 \
    capacityProvider=FARGATE,weight=1

# 4. Deploy (builds ARM64 image, pushes ECR, updates ECS service)
./infrastructure/deploy.sh

# 5. Tail logs
aws logs tail /ecs/TolipAI-scraper --follow --region $AWS_REGION
```
