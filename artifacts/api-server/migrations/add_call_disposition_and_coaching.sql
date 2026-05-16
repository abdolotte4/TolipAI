-- Migration: add disposition and AI coaching summary to crm_call_logs
-- Applied: 2026-05-16

ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS disposition text;
ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS ai_coaching_summary text;
