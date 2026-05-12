-- ─── Performance indexes — run once on prod DB ───────────────────────────────
-- These supplement the indexes already baked into the Drizzle schema.
-- Safe to run multiple times (all use CREATE INDEX IF NOT EXISTS).

-- Enable pg_trgm for fast ILIKE full-text search on address / phone / email
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- crm_leads: ILIKE search columns (requires pg_trgm above)
CREATE INDEX IF NOT EXISTS crm_leads_address_trgm_idx
  ON crm_leads USING gin (address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS crm_leads_phone_trgm_idx
  ON crm_leads USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS crm_leads_email_trgm_idx
  ON crm_leads USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS crm_leads_seller_name_trgm_idx
  ON crm_leads USING gin (seller_name gin_trgm_ops);

-- crm_leads: updated_at (for "stale lead" queries and sorting)
CREATE INDEX IF NOT EXISTS crm_leads_updated_at_idx
  ON crm_leads (updated_at DESC);

-- crm_sequence_logs: prevent duplicate sends for the same lead+step pair
CREATE UNIQUE INDEX IF NOT EXISTS crm_sequence_logs_lead_step_uniq
  ON crm_sequence_logs (lead_id, step_id);

-- crm_buyers: contact lookup
CREATE INDEX IF NOT EXISTS crm_buyers_phone_idx
  ON crm_buyers (phone);

CREATE INDEX IF NOT EXISTS crm_buyers_email_idx
  ON crm_buyers (email);

-- crm_comps: created_at for recency ordering
CREATE INDEX IF NOT EXISTS crm_comps_created_at_idx
  ON crm_comps (created_at DESC);
