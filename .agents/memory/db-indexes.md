---
name: DB duplicate indexes cleaned
description: 11 redundant single-column indexes were dropped; retained idx_* named indexes as canonical.
---

# DB Index Cleanup

Dropped 11 duplicate single-column non-unique indexes. For each affected column, one index was retained (the `idx_*` named one).

## Dropped indexes
- `idx_cash_buyer_lead` (kept `cbm_lead_id_idx`)
- `idx_crm_comps_lead_id` (kept `idx_crm_comps_lead`)
- `idx_crm_lead_followers_lead_id` (kept `idx_crm_lead_followers_lead`)
- `idx_crm_leads_assigned_to` (kept `idx_crm_leads_assigned`)
- `idx_crm_leads_campaign_id` (kept `idx_crm_leads_campaign`)
- `cl_campaign_id_idx` (kept `idx_crm_leads_campaign`)
- `crm_leads_phone_idx` (kept `idx_crm_leads_phone`)
- `cl_status_idx` (kept `idx_crm_leads_status`)
- `idx_crm_notes_lead_id` (kept `idx_crm_notes_lead`)
- `idx_crm_notifications_user_id` (kept `idx_crm_notifications_user`)
- `idx_crm_tasks_lead_id` (kept `idx_crm_tasks_lead`)

**Why:** Duplicate indexes waste write performance and storage with no query benefit. PostgreSQL uses only one index per scan.

**How to apply:** If Drizzle migrations recreate any of these dropped index names, check the schema file and remove the duplicate definition rather than letting it accumulate again.
