-- P2-03: crm_background_jobs — DB-backed background job store
-- P2-04: crm_audit_log — Immutable audit trail

-- ─── Background Jobs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_background_jobs (
  id              TEXT        PRIMARY KEY,
  type            TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'queued',
  campaign_id     INTEGER,
  actor_id        INTEGER,
  payload         JSONB,
  result          JSONB,
  progress        INTEGER     NOT NULL DEFAULT 0,
  error           TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_background_jobs_status_idx     ON crm_background_jobs (status);
CREATE INDEX IF NOT EXISTS crm_background_jobs_campaign_idx   ON crm_background_jobs (campaign_id);
CREATE INDEX IF NOT EXISTS crm_background_jobs_type_idx       ON crm_background_jobs (type);
CREATE INDEX IF NOT EXISTS crm_background_jobs_expires_at_idx ON crm_background_jobs (expires_at);

-- ─── Audit Log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_audit_log (
  id          SERIAL      PRIMARY KEY,
  table_name  TEXT        NOT NULL,
  row_id      INTEGER     NOT NULL,
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT        NOT NULL,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  metadata    JSONB,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_audit_log_row_idx        ON crm_audit_log (table_name, row_id);
CREATE INDEX IF NOT EXISTS crm_audit_log_actor_idx      ON crm_audit_log (actor_id);
CREATE INDEX IF NOT EXISTS crm_audit_log_changed_at_idx ON crm_audit_log (changed_at);

SELECT 'crm_background_jobs created' AS result
  WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_background_jobs');
SELECT 'crm_audit_log created' AS result
  WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_audit_log');
