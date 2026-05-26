-- Migration: add conference_sid to crm_call_logs for recording callback resolution
-- This column stores the Twilio ConferenceSid so the recording status callback
-- can find the call log even after a server restart (in-memory map cleared).
-- Applied: 2026-05-26

ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS conference_sid text;
CREATE INDEX IF NOT EXISTS crm_call_logs_conference_sid_idx ON crm_call_logs (conference_sid);
