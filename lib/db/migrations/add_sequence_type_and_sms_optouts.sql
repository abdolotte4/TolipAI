-- Migration: add type column to crm_sequence_steps + crm_sequence_logs, and create crm_sms_opt_outs
-- Run once: psql $DATABASE_URL -f this_file.sql

BEGIN;

-- Add type column to crm_sequence_steps (default "email" for existing rows)
ALTER TABLE crm_sequence_steps
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'email';

-- Change subject from NOT NULL (no default) to NOT NULL DEFAULT ''
-- (existing rows already have values, so just set the default)
ALTER TABLE crm_sequence_steps
  ALTER COLUMN subject SET DEFAULT '';

-- Add type column to crm_sequence_logs (default "email" for existing rows)
ALTER TABLE crm_sequence_logs
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'email';

-- Create crm_sms_opt_outs table
CREATE TABLE IF NOT EXISTS crm_sms_opt_outs (
  id            SERIAL PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,
  campaign_id   INTEGER REFERENCES crm_campaigns(id) ON DELETE SET NULL,
  opted_out_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_sms_opt_outs_campaign_id_idx ON crm_sms_opt_outs(campaign_id);
CREATE INDEX IF NOT EXISTS crm_sms_opt_outs_phone_idx ON crm_sms_opt_outs(phone);

COMMIT;
