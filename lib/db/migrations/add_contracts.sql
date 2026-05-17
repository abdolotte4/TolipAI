-- E-Sign Contracts table (TolipAI CRM)
CREATE TABLE IF NOT EXISTS crm_contracts (
  id               SERIAL PRIMARY KEY,
  lead_id          INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  campaign_id      INTEGER REFERENCES crm_campaigns(id),
  created_by_id    INTEGER REFERENCES crm_users(id),
  seller_name      TEXT NOT NULL,
  seller_email     TEXT,
  seller_phone     TEXT,
  buyer_name       TEXT NOT NULL,
  contract_type    TEXT NOT NULL DEFAULT 'purchase_agreement',
  property_address TEXT NOT NULL,
  purchase_price   NUMERIC(12,2),
  earnest_money    NUMERIC(12,2) DEFAULT 500,
  closing_days     INTEGER DEFAULT 30,
  include_assignment BOOLEAN NOT NULL DEFAULT TRUE,
  additional_terms TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',
  signing_token    TEXT UNIQUE,
  token_expires_at TIMESTAMP,
  provider         TEXT NOT NULL DEFAULT 'native',
  provider_doc_id  TEXT,
  signed_at        TIMESTAMP,
  signer_ip        TEXT,
  signer_name_typed TEXT,
  viewed_at        TIMESTAMP,
  email_sent_at    TIMESTAMP,
  document_html    TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_contracts_lead_id_idx       ON crm_contracts(lead_id);
CREATE INDEX IF NOT EXISTS crm_contracts_campaign_id_idx   ON crm_contracts(campaign_id);
CREATE INDEX IF NOT EXISTS crm_contracts_status_idx        ON crm_contracts(status);
CREATE INDEX IF NOT EXISTS crm_contracts_signing_token_idx ON crm_contracts(signing_token);
