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

-- crm_leads: composite index for default list query (campaign + archived + created)
CREATE INDEX IF NOT EXISTS crm_leads_campaign_archived_created_idx
  ON crm_leads (campaign_id, archived, created_at DESC);

-- crm_leads: status filter
CREATE INDEX IF NOT EXISTS crm_leads_status_idx
  ON crm_leads (status);

-- crm_leads: VA dashboard filter
CREATE INDEX IF NOT EXISTS crm_leads_assigned_to_idx
  ON crm_leads (assigned_to);

-- crm_comps: leadId lookup
CREATE INDEX IF NOT EXISTS crm_comps_lead_id_idx
  ON crm_comps (lead_id);

-- crm_notes: leadId + created_at for pagination
CREATE INDEX IF NOT EXISTS crm_notes_lead_id_created_idx
  ON crm_notes (lead_id, created_at DESC);

-- crm_tasks: leadId + dueDate
CREATE INDEX IF NOT EXISTS crm_tasks_lead_id_due_idx
  ON crm_tasks (lead_id, due_date);

-- crm_lead_followers: leadId lookup
CREATE INDEX IF NOT EXISTS crm_lead_followers_lead_id_idx
  ON crm_lead_followers (lead_id);

-- crm_lead_followers: uniqueness check
CREATE INDEX IF NOT EXISTS crm_lead_followers_lead_user_idx
  ON crm_lead_followers (lead_id, user_id);

-- crm_notifications: unread count per user
CREATE INDEX IF NOT EXISTS crm_notifications_user_read_idx
  ON crm_notifications (user_id, read);

-- ─── 13.2 Convert TEXT JSON columns to JSONB ──────────────────────────────────
-- Run ONLY if skipTracedPhones / skipTracedEmails are TEXT columns.
-- Check first: SELECT data_type FROM information_schema.columns
--              WHERE table_name = 'crm_leads' AND column_name = 'skip_traced_phones';
-- If data_type = 'text', run the two ALTER TABLE statements below.
-- If data_type = 'jsonb', skip — already done.
--
-- ALTER TABLE crm_leads
--   ALTER COLUMN skip_traced_phones TYPE JSONB
--   USING CASE WHEN skip_traced_phones IS NULL OR skip_traced_phones = ''
--              THEN NULL
--              ELSE skip_traced_phones::JSONB END;
--
-- ALTER TABLE crm_leads
--   ALTER COLUMN skip_traced_emails TYPE JSONB
--   USING CASE WHEN skip_traced_emails IS NULL OR skip_traced_emails = ''
--              THEN NULL
--              ELSE skip_traced_emails::JSONB END;
