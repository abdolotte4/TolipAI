-- NeonDB migration: add scraper_jobs, cash_buyer_matches, distressed_listings
-- and any new columns/indexes. All statements use IF NOT EXISTS for idempotency.

-- ── scraper_jobs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scraper_jobs (
  id          TEXT        PRIMARY KEY,
  job_type    TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'queued',
  params      JSONB       NOT NULL DEFAULT '{}',
  progress    INTEGER     NOT NULL DEFAULT 0,
  result_count INTEGER    DEFAULT 0,
  error       TEXT,
  lead_id     INTEGER     REFERENCES crm_leads(id) ON DELETE SET NULL,
  campaign_id INTEGER     REFERENCES crm_campaigns(id) ON DELETE SET NULL,
  created_by  INTEGER     REFERENCES crm_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP   DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS scraper_jobs_lead_id_idx     ON scraper_jobs(lead_id);
CREATE INDEX IF NOT EXISTS scraper_jobs_status_idx      ON scraper_jobs(status);
CREATE INDEX IF NOT EXISTS scraper_jobs_type_idx        ON scraper_jobs(job_type);
CREATE INDEX IF NOT EXISTS scraper_jobs_created_at_idx  ON scraper_jobs(created_at);

-- ── cash_buyer_matches ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_buyer_matches (
  id                      SERIAL      PRIMARY KEY,
  lead_id                 INTEGER     NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  job_id                  TEXT        REFERENCES scraper_jobs(id) ON DELETE SET NULL,
  buyer_name              TEXT        NOT NULL,
  llc_name                TEXT,
  buyer_type              TEXT        NOT NULL DEFAULT 'unknown',
  match_score             INTEGER     NOT NULL DEFAULT 0,
  match_reasons           JSONB       NOT NULL DEFAULT '[]',
  portfolio_size          INTEGER,
  portfolio_value         NUMERIC(14,2),
  portfolio_appreciation  NUMERIC(6,2),
  avg_purchase_price      NUMERIC(12,2),
  last_purchase_date      TEXT,
  city                    TEXT,
  state                   TEXT,
  zip                     TEXT,
  mailing_address         TEXT,
  phones                  JSONB       NOT NULL DEFAULT '[]',
  emails                  JSONB       NOT NULL DEFAULT '[]',
  principals              JSONB       NOT NULL DEFAULT '[]',
  classification_reason   TEXT,
  source                  TEXT        NOT NULL DEFAULT 'scraper-engine',
  raw_data                JSONB,
  created_at              TIMESTAMP   DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS cash_buyer_matches_lead_id_idx ON cash_buyer_matches(lead_id);
CREATE INDEX IF NOT EXISTS cash_buyer_matches_job_id_idx  ON cash_buyer_matches(job_id);
CREATE INDEX IF NOT EXISTS cash_buyer_matches_score_idx   ON cash_buyer_matches(match_score);
CREATE INDEX IF NOT EXISTS cash_buyer_matches_type_idx    ON cash_buyer_matches(buyer_type);

-- ── distressed_listings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS distressed_listings (
  id              SERIAL      PRIMARY KEY,
  job_id          TEXT        REFERENCES scraper_jobs(id) ON DELETE CASCADE,
  campaign_id     INTEGER     REFERENCES crm_campaigns(id) ON DELETE SET NULL,
  distress_type   TEXT        NOT NULL DEFAULT 'unknown',
  address         TEXT        NOT NULL DEFAULT '',
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  county          TEXT,
  parcel_id       TEXT,
  owner_name      TEXT,
  sale_date       TEXT,
  opening_bid     NUMERIC(12,2),
  estimated_value NUMERIC(12,2),
  mortgage_balance NUMERIC(12,2),
  source          TEXT        NOT NULL DEFAULT 'scraper-engine',
  source_url      TEXT,
  latitude        NUMERIC(10,6),
  longitude       NUMERIC(10,6),
  raw_data        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMP   DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS distressed_listings_job_id_idx    ON distressed_listings(job_id);
CREATE INDEX IF NOT EXISTS distressed_listings_zip_idx       ON distressed_listings(zip);
CREATE INDEX IF NOT EXISTS distressed_listings_county_idx    ON distressed_listings(county);
CREATE INDEX IF NOT EXISTS distressed_listings_type_idx      ON distressed_listings(distress_type);
CREATE INDEX IF NOT EXISTS distressed_listings_sale_date_idx ON distressed_listings(sale_date);

-- ── new columns on crm_leads (add if missing) ─────────────────────────────────
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS condition       INTEGER;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS reason_for_selling TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS how_soon       TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS asking_price_text TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS current_value  NUMERIC(12,2);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS beds           INTEGER;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS baths          TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sqft           INTEGER;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS year_built     INTEGER;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS owner_name     TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS last_sale_date TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS last_sale_price NUMERIC(12,2);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS arv            NUMERIC(12,2);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS asking_price   NUMERIC(12,2);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS estimated_repair_cost NUMERIC(12,2);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS mao            NUMERIC(12,2);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lead_source    TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS property_type  TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS occupancy      TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS is_rental      BOOLEAN DEFAULT false;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS how_heard      TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived       BOOLEAN DEFAULT false;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS offer_sent_at  TIMESTAMP;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS offer_amount   NUMERIC(12,2);

-- ── new columns on crm_submission_links ───────────────────────────────────────
ALTER TABLE crm_submission_links ADD COLUMN IF NOT EXISTS lead_source TEXT;

-- ── crm_email_sequences — ensure columns exist ───────────────────────────────
ALTER TABLE crm_email_sequences ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE crm_email_sequences ADD COLUMN IF NOT EXISTS is_active   BOOLEAN DEFAULT true;
ALTER TABLE crm_email_sequences ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP DEFAULT NOW();

-- ── property_comps ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_comps (
  id                  SERIAL      PRIMARY KEY,
  lead_id             INTEGER     REFERENCES crm_leads(id) ON DELETE CASCADE,
  job_id              TEXT,
  source              TEXT        NOT NULL DEFAULT 'propwire',
  address             TEXT        NOT NULL,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  beds                INTEGER,
  baths               NUMERIC(4,1),
  sqft                INTEGER,
  lot_sqft            INTEGER,
  year_built          INTEGER,
  sale_price          NUMERIC(12,2),
  price_per_sqft      NUMERIC(10,2),
  sold_date           TEXT,
  status              TEXT,
  distance_from_subject NUMERIC(6,2),
  latitude            NUMERIC(10,7),
  longitude           NUMERIC(10,7),
  source_url          TEXT,
  raw_data            JSONB,
  created_at          TIMESTAMP   DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS property_comps_lead_id_idx ON property_comps(lead_id);
CREATE INDEX IF NOT EXISTS property_comps_source_idx  ON property_comps(source);

-- ── property_history ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_history (
  id              SERIAL      PRIMARY KEY,
  lead_id         INTEGER     REFERENCES crm_leads(id) ON DELETE CASCADE,
  source          TEXT        NOT NULL DEFAULT 'propwire',
  event_type      TEXT        NOT NULL DEFAULT 'sale',
  event_date      TEXT,
  sale_price      NUMERIC(12,2),
  mortgage_amount NUMERIC(12,2),
  lender_name     TEXT,
  buyer_name      TEXT,
  seller_name     TEXT,
  document_type   TEXT,
  raw_data        JSONB,
  created_at      TIMESTAMP   DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS property_history_lead_id_idx    ON property_history(lead_id);
CREATE INDEX IF NOT EXISTS property_history_event_type_idx ON property_history(event_type);

-- ── property_tax ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_tax (
  id                  SERIAL      PRIMARY KEY,
  lead_id             INTEGER     REFERENCES crm_leads(id) ON DELETE CASCADE,
  source              TEXT        NOT NULL DEFAULT 'propwire',
  assessed_value      NUMERIC(12,2),
  market_value        NUMERIC(12,2),
  land_value          NUMERIC(12,2),
  improvement_value   NUMERIC(12,2),
  annual_tax          NUMERIC(10,2),
  tax_year            TEXT,
  parcel_id           TEXT,
  legal_description   TEXT,
  tax_history         JSONB,
  fetched_at          TIMESTAMP   DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS property_tax_lead_id_idx ON property_tax(lead_id);

-- ── skip_trace_results ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skip_trace_results (
  id              SERIAL      PRIMARY KEY,
  lead_id         INTEGER     REFERENCES crm_leads(id) ON DELETE CASCADE,
  subject_name    TEXT        NOT NULL,
  llc_name        TEXT,
  phones          JSONB       DEFAULT '[]',
  emails          JSONB       DEFAULT '[]',
  principals      JSONB       DEFAULT '[]',
  addresses       JSONB       DEFAULT '[]',
  sources         JSONB       DEFAULT '[]',
  raw_data        JSONB,
  fetched_at      TIMESTAMP   DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS skip_trace_results_lead_id_idx ON skip_trace_results(lead_id);
CREATE INDEX IF NOT EXISTS skip_trace_results_name_idx    ON skip_trace_results(subject_name);

-- ── Fix cash_buyer_matches lead_id nullable (allows lead-free scrapes) ────────
ALTER TABLE cash_buyer_matches ALTER COLUMN lead_id DROP NOT NULL;
