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
