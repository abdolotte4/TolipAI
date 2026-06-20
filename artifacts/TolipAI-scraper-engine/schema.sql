-- TolipAI Scraper Engine — Neon DB schema
-- Run against your Neon project with:
--   psql $DATABASE_URL -f schema.sql
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT.

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy address search

-- ─── scraper_jobs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scraper_jobs (
    id            TEXT        PRIMARY KEY,
    job_type      TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'queued',
    progress      INTEGER     NOT NULL DEFAULT 0,
    result_count  INTEGER,
    result        JSONB,
    error         TEXT,
    params        JSONB       NOT NULL DEFAULT '{}',
    lead_id       INTEGER,
    campaign_id   INTEGER,
    created_by    INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS scraper_jobs_status_idx      ON scraper_jobs (status);
CREATE INDEX IF NOT EXISTS scraper_jobs_lead_id_idx     ON scraper_jobs (lead_id);
CREATE INDEX IF NOT EXISTS scraper_jobs_campaign_id_idx ON scraper_jobs (campaign_id);
CREATE INDEX IF NOT EXISTS scraper_jobs_created_at_idx  ON scraper_jobs (created_at DESC);

-- ─── cash_buyer_matches ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_buyer_matches (
    id                      BIGSERIAL   PRIMARY KEY,
    lead_id                 INTEGER,
    job_id                  TEXT        NOT NULL,
    buyer_name              TEXT        NOT NULL,
    llc_name                TEXT,
    buyer_type              TEXT        NOT NULL DEFAULT 'unknown',
    match_score             INTEGER     NOT NULL DEFAULT 0,
    match_reasons           JSONB       NOT NULL DEFAULT '[]',
    portfolio_size          INTEGER,
    portfolio_value         NUMERIC(18, 2),
    portfolio_appreciation  NUMERIC(18, 2),
    avg_purchase_price      NUMERIC(18, 2),
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
    raw_data                JSONB       NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cbm_lead_id_idx     ON cash_buyer_matches (lead_id);
CREATE INDEX IF NOT EXISTS cbm_job_id_idx      ON cash_buyer_matches (job_id);
CREATE INDEX IF NOT EXISTS cbm_match_score_idx ON cash_buyer_matches (match_score DESC);
CREATE INDEX IF NOT EXISTS cbm_buyer_type_idx  ON cash_buyer_matches (buyer_type);
CREATE INDEX IF NOT EXISTS cbm_state_idx       ON cash_buyer_matches (state);
CREATE INDEX IF NOT EXISTS cbm_created_at_idx  ON cash_buyer_matches (created_at DESC);

-- ─── distressed_listings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS distressed_listings (
    id                BIGSERIAL   PRIMARY KEY,
    job_id            TEXT        NOT NULL,
    campaign_id       INTEGER,
    distress_type     TEXT        NOT NULL DEFAULT 'unknown',
    address           TEXT        NOT NULL,
    city              TEXT,
    state             TEXT,
    zip               TEXT,
    county            TEXT,
    parcel_id         TEXT,
    owner_name        TEXT,
    sale_date         TEXT,
    opening_bid       NUMERIC(18, 2),
    estimated_value   NUMERIC(18, 2),
    mortgage_balance  NUMERIC(18, 2),
    case_number       TEXT,
    lien_amount       NUMERIC(18, 2),
    property_type     TEXT,
    scraped_at        TIMESTAMPTZ,
    source            TEXT        NOT NULL DEFAULT 'scraper-engine',
    source_url        TEXT,
    latitude          NUMERIC(10, 7),
    longitude         NUMERIC(10, 7),
    raw_data          JSONB       NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dl_job_id_idx       ON distressed_listings (job_id);
CREATE INDEX IF NOT EXISTS dl_campaign_id_idx  ON distressed_listings (campaign_id);
CREATE INDEX IF NOT EXISTS dl_distress_type_idx ON distressed_listings (distress_type);
CREATE INDEX IF NOT EXISTS dl_state_idx        ON distressed_listings (state);
CREATE INDEX IF NOT EXISTS dl_zip_idx          ON distressed_listings (zip);
CREATE INDEX IF NOT EXISTS dl_sale_date_idx    ON distressed_listings (sale_date);
CREATE INDEX IF NOT EXISTS dl_created_at_idx   ON distressed_listings (created_at DESC);
-- Fuzzy address search
CREATE INDEX IF NOT EXISTS dl_address_trgm_idx ON distressed_listings USING gin (address gin_trgm_ops);

-- ─── property_comps ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_comps (
    id                      BIGSERIAL   PRIMARY KEY,
    lead_id                 INTEGER,
    job_id                  TEXT,
    source                  TEXT        NOT NULL,
    address                 TEXT        NOT NULL,
    city                    TEXT,
    state                   TEXT,
    zip                     TEXT,
    beds                    INTEGER,
    baths                   NUMERIC(5, 1),
    sqft                    INTEGER,
    lot_sqft                INTEGER,
    year_built              INTEGER,
    sale_price              NUMERIC(18, 2),
    price_per_sqft          NUMERIC(10, 2),
    sold_date               TEXT,
    status                  TEXT,
    distance_from_subject   NUMERIC(8, 4),
    latitude                NUMERIC(10, 7),
    longitude               NUMERIC(10, 7),
    source_url              TEXT,
    raw_data                JSONB       NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pc_lead_id_idx  ON property_comps (lead_id);
CREATE INDEX IF NOT EXISTS pc_job_id_idx   ON property_comps (job_id);
CREATE INDEX IF NOT EXISTS pc_zip_idx      ON property_comps (zip);
CREATE INDEX IF NOT EXISTS pc_source_idx   ON property_comps (source);

-- ─── property_history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_history (
    id               BIGSERIAL   PRIMARY KEY,
    lead_id          INTEGER     NOT NULL,
    source           TEXT        NOT NULL,
    event_type       TEXT        NOT NULL DEFAULT 'sale',  -- sale | mortgage
    event_date       TEXT,
    sale_price       NUMERIC(18, 2),
    mortgage_amount  NUMERIC(18, 2),
    lender_name      TEXT,
    buyer_name       TEXT,
    seller_name      TEXT,
    document_type    TEXT,
    raw_data         JSONB       NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ph_lead_id_idx    ON property_history (lead_id);
CREATE INDEX IF NOT EXISTS ph_event_type_idx ON property_history (event_type);
CREATE INDEX IF NOT EXISTS ph_event_date_idx ON property_history (event_date);

-- ─── property_tax ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_tax (
    id                  BIGSERIAL   PRIMARY KEY,
    lead_id             INTEGER     NOT NULL,
    source              TEXT        NOT NULL,
    assessed_value      NUMERIC(18, 2),
    market_value        NUMERIC(18, 2),
    land_value          NUMERIC(18, 2),
    improvement_value   NUMERIC(18, 2),
    annual_tax          NUMERIC(14, 2),
    tax_year            TEXT,
    parcel_id           TEXT,
    legal_description   TEXT,
    tax_history         JSONB       NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lead_id, source)
);

CREATE INDEX IF NOT EXISTS ptax_lead_id_idx ON property_tax (lead_id);
CREATE INDEX IF NOT EXISTS ptax_parcel_idx  ON property_tax (parcel_id);

-- ─── skip_trace_results ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skip_trace_results (
    id             BIGSERIAL   PRIMARY KEY,
    lead_id        INTEGER,
    subject_name   TEXT        NOT NULL,
    llc_name       TEXT,
    phones         JSONB       NOT NULL DEFAULT '[]',
    emails         JSONB       NOT NULL DEFAULT '[]',
    principals     JSONB       NOT NULL DEFAULT '[]',
    addresses      JSONB       NOT NULL DEFAULT '[]',
    sources        JSONB       NOT NULL DEFAULT '[]',
    raw_data       JSONB       NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS str_lead_id_idx ON skip_trace_results (lead_id);
CREATE INDEX IF NOT EXISTS str_name_idx    ON skip_trace_results (subject_name);

-- ─── crm_leads (mirror of lib/db schema — read-only from scraper engine) ──────
-- This table is OWNED by the main CRM Drizzle schema.
-- We recreate it here only if it doesn't exist so the scraper engine can
-- do GET /leads/{id} lookups without a foreign process dependency.
CREATE TABLE IF NOT EXISTS crm_leads (
    id            SERIAL      PRIMARY KEY,
    address       TEXT        NOT NULL,
    city          TEXT,
    state         TEXT,
    zip           TEXT,
    beds          INTEGER,
    baths         NUMERIC(5, 1),
    sqft          INTEGER,
    year_built    INTEGER,
    owner_name    TEXT,
    owner_llc     TEXT,
    status        TEXT        NOT NULL DEFAULT 'new',
    campaign_id   INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cl_status_idx      ON crm_leads (status);
CREATE INDEX IF NOT EXISTS cl_campaign_id_idx ON crm_leads (campaign_id);
CREATE INDEX IF NOT EXISTS cl_state_zip_idx   ON crm_leads (state, zip);
