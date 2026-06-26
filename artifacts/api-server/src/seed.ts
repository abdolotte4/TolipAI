import { db, pool } from "@workspace/db";
import { crmUsers } from "@workspace/db/schema";
import { and, eq, notInArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { logger } from "./lib/logger";

async function ensureIndexes() {
  const indexes: [string, string][] = [
    ["idx_crm_notes_lead_id",           "CREATE INDEX IF NOT EXISTS idx_crm_notes_lead_id ON crm_notes(lead_id)"],
    ["idx_crm_tasks_lead_id",           "CREATE INDEX IF NOT EXISTS idx_crm_tasks_lead_id ON crm_tasks(lead_id)"],
    ["idx_crm_comps_lead_id",           "CREATE INDEX IF NOT EXISTS idx_crm_comps_lead_id ON crm_comps(lead_id)"],
    ["idx_crm_lead_followers_lead_id",  "CREATE INDEX IF NOT EXISTS idx_crm_lead_followers_lead_id ON crm_lead_followers(lead_id)"],
    ["idx_crm_notifications_user_id",   "CREATE INDEX IF NOT EXISTS idx_crm_notifications_user_id ON crm_notifications(user_id)"],
    ["idx_crm_leads_campaign_id",       "CREATE INDEX IF NOT EXISTS idx_crm_leads_campaign_id ON crm_leads(campaign_id)"],
    ["idx_crm_tasks_campaign_id",       "CREATE INDEX IF NOT EXISTS idx_crm_tasks_campaign_id ON crm_tasks(campaign_id)"],
    ["idx_crm_leads_status",            "CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads(status)"],
    ["idx_crm_leads_assigned_to",       "CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned_to ON crm_leads(assigned_to)"],
    ["idx_crm_leads_archived",          "CREATE INDEX IF NOT EXISTS idx_crm_leads_archived ON crm_leads(archived)"],
    ["idx_crm_leads_created_at",        "CREATE INDEX IF NOT EXISTS idx_crm_leads_created_at ON crm_leads(created_at)"],
    ["idx_crm_leads_campaign_archived_created", "CREATE INDEX IF NOT EXISTS idx_crm_leads_campaign_archived_created ON crm_leads(campaign_id, archived, created_at DESC)"],
    // ── Session 10 additions ──────────────────────────────────────────────────
    // CRITICAL: phone lookup — eliminates full-table scan in SMS webhook (was .limit(2000) + JS find)
    ["idx_crm_leads_phone",             "CREATE INDEX IF NOT EXISTS idx_crm_leads_phone ON crm_leads(phone)"],
    // Composite: ordered notes per lead (most common notes query pattern)
    ["idx_crm_notes_lead_date",         "CREATE INDEX IF NOT EXISTS idx_crm_notes_lead_date ON crm_notes(lead_id, created_at DESC)"],
    // Composite: unread notifications per user ordered by date (replaces 3 separate indexes being combined at query time)
    ["idx_crm_notifs_user_unread_date", "CREATE INDEX IF NOT EXISTS idx_crm_notifs_user_unread_date ON crm_notifications(user_id, read, created_at DESC)"],
    // Composite: sequence dedup check — fires on every email/SMS send step
    ["idx_crm_seq_logs_dedup",          "CREATE INDEX IF NOT EXISTS idx_crm_seq_logs_dedup ON crm_sequence_logs(lead_id, sequence_id, step_id) WHERE step_id IS NOT NULL"],
    // Full-text search: lead address + city + seller name (enables fast GIN search vs slow ILIKE)
    ["idx_crm_leads_fts",               "CREATE INDEX IF NOT EXISTS idx_crm_leads_fts ON crm_leads USING gin(to_tsvector('english', coalesce(address,'') || ' ' || coalesce(city,'') || ' ' || coalesce(seller_name,'')))"],
    // Email and zip indexes — search and lookup performance (PERF)
    ["idx_crm_leads_email",             "CREATE INDEX IF NOT EXISTS idx_crm_leads_email ON crm_leads(email)"],
    ["idx_crm_leads_zip",               "CREATE INDEX IF NOT EXISTS idx_crm_leads_zip ON crm_leads(zip)"],
    // scraper_jobs campaign lookup
    ["idx_scraper_jobs_campaign_id",    "CREATE INDEX IF NOT EXISTS idx_scraper_jobs_campaign_id ON scraper_jobs(campaign_id)"],
  ];
  for (const [name, ddl] of indexes) {
    try {
      await db.execute(sql.raw(ddl));
    } catch (err: any) {
      logger.warn({ name, err: err?.message }, "Index creation skipped.");
    }
  }
  logger.info("DB indexes verified.");
}

async function seedAdmin(email: string, password: string, name: string) {
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await db
    .select({ id: crmUsers.id })
    .from(crmUsers)
    .where(eq(crmUsers.email, email))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(crmUsers)
      .set({ passwordHash, role: "super_admin", status: "active", campaignId: null })
      .where(eq(crmUsers.email, email));
    logger.info({ email }, "CRM super admin password synced from secrets.");
  } else {
    // Use explicit id = MAX(id)+1 to bypass broken/missing serial sequences on Neon
    await db.execute(sql`
      INSERT INTO crm_users (id, name, email, password_hash, role, status, campaign_id, created_at)
      SELECT COALESCE(MAX(id), 0) + 1, ${name}, ${email}, ${passwordHash}, 'super_admin', 'active', NULL, NOW()
      FROM crm_users
    `);
    logger.info({ email }, "CRM super admin created successfully.");
  }
}

async function ensureColumns() {
  const columns: [string, string][] = [
    ["crm_call_logs.disposition",            "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS disposition text"],
    ["crm_call_logs.ai_coaching_summary",    "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS ai_coaching_summary text"],
    ["crm_call_logs.conference_sid",         "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS conference_sid text"],
    ["crm_call_logs.qualification_score",    "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS qualification_score integer"],
    ["crm_call_logs.qualification_notes",    "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS qualification_notes text"],
    ["crm_call_logs.mos_score",              "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS mos_score numeric"],
    ["crm_call_logs.jitter_ms",              "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS jitter_ms numeric"],
    ["crm_call_logs.packet_loss_pct",        "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS packet_loss_pct numeric"],
    ["crm_call_logs.user_id",               "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS user_id integer REFERENCES crm_users(id)"],
    ["crm_campaigns.stripe_customer_id",     "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS stripe_customer_id text"],
    ["crm_campaigns.twilio_forward_phone",   "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS twilio_forward_phone text"],
    ["crm_campaigns.twilio_api_key_sid",     "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS twilio_api_key_sid text"],
    ["crm_campaigns.twilio_api_key_secret",  "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS twilio_api_key_secret text"],
    ["crm_campaigns.twilio_voice_app_sid",   "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS twilio_voice_app_sid text"],
    ["crm_campaigns.dialer_enabled",        "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS dialer_enabled boolean DEFAULT false"],
    ["crm_campaigns.open_phone_number_id",   "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS open_phone_number_id text"],
    ["crm_campaigns.open_phone_number",      "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS open_phone_number text"],
    ["crm_campaigns.ai_sms_enabled",        "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS ai_sms_enabled boolean DEFAULT false"],
    ["crm_campaigns.ai_sms_personality",    "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS ai_sms_personality text DEFAULT 'professional_investor'"],
    ["crm_campaigns.ai_sms_max_replies_per_day", "ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS ai_sms_max_replies_per_day integer DEFAULT 5"],
    ["crm_users.password_plain",             "ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS password_plain text"],
    ["crm_leads.last_motivation_score",      "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS last_motivation_score integer"],
    ["crm_leads.last_motivation_label",      "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS last_motivation_label text"],
    ["crm_leads.archived",                   "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false"],
    ["crm_leads.archived_at",                "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived_at timestamp"],
    ["crm_leads.owner_name",                 "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS owner_name text"],
    ["crm_leads.year_built",                 "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS year_built integer"],
    ["crm_leads.last_sale_date",             "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS last_sale_date text"],
    ["crm_leads.last_sale_price",            "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS last_sale_price numeric"],
    ["crm_leads.rentcast_avm_value",         "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS rentcast_avm_value numeric"],
    ["crm_leads.rentcast_avm_low",           "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS rentcast_avm_low numeric"],
    ["crm_leads.rentcast_avm_high",          "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS rentcast_avm_high numeric"],
    ["crm_leads.rentcast_avm_fetched_at",    "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS rentcast_avm_fetched_at timestamp"],
    ["crm_leads.attom_avm_value",            "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS attom_avm_value numeric"],
    ["crm_leads.attom_avm_low",              "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS attom_avm_low numeric"],
    ["crm_leads.attom_avm_high",             "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS attom_avm_high numeric"],
    ["crm_leads.attom_avm_confidence",       "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS attom_avm_confidence integer"],
    ["crm_leads.attom_avm_fetched_at",       "ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS attom_avm_fetched_at timestamp"],
    // Drop stale NOT NULL constraints that block manual lead creation (skip_traced fields are optional)
    ["crm_leads.skip_traced_name.nullable",   "ALTER TABLE crm_leads ALTER COLUMN skip_traced_name DROP NOT NULL"],
    ["crm_leads.skip_traced_phones.nullable", "ALTER TABLE crm_leads ALTER COLUMN skip_traced_phones DROP NOT NULL"],
    ["crm_leads.skip_traced_emails.nullable", "ALTER TABLE crm_leads ALTER COLUMN skip_traced_emails DROP NOT NULL"],
  ];
  for (const [name, ddl] of columns) {
    try {
      await db.execute(sql.raw(ddl));
    } catch (err: any) {
      logger.warn({ name, err: err?.message }, "Column migration skipped.");
    }
  }
  logger.info("DB column migrations verified.");
}

async function ensureTables() {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS crm_faxes (
        id           SERIAL PRIMARY KEY,
        campaign_id  INTEGER REFERENCES crm_campaigns(id),
        lead_id      INTEGER REFERENCES crm_leads(id),
        direction    TEXT NOT NULL DEFAULT 'inbound',
        status       TEXT NOT NULL DEFAULT 'queued',
        from_number  TEXT NOT NULL DEFAULT '',
        to_number    TEXT NOT NULL DEFAULT '',
        num_pages    INTEGER,
        pdf_url      TEXT,
        media_url    TEXT,
        fax_sid      TEXT UNIQUE,
        error_code   TEXT,
        error_message TEXT,
        created_at   TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at   TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS crm_faxes_campaign_id_idx ON crm_faxes(campaign_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS crm_faxes_lead_id_idx ON crm_faxes(lead_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS crm_faxes_created_at_idx ON crm_faxes(created_at DESC)`));
    logger.info("DB tables verified.");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Table migration warning (non-fatal).");
  }
}

async function repairSequences() {
  const tables = [
    "crm_users",
    "crm_campaigns",
    "crm_leads",
    "crm_notes",
    "crm_lead_followers",
    "crm_notifications",
    "crm_openphone_messages",
    "crm_tasks",
    "crm_email_sequences",
    "crm_sequence_steps",
    "crm_sequence_logs",
    "crm_call_logs",
    "crm_sms_opt_outs",
    "crm_sms_conversations",
    "crm_comps",
    "crm_buyers",
    "crm_submission_links",
    "cash_buyer_matches",
    "distressed_listings",
    "property_comps",
    "property_history",
    "crm_faxes",
    "crm_appointments",
    "crm_waitlist",
    "crm_phone_read_receipts",
    "contacts",
    "subscribers"
  ];
  for (const table of tables) {
    try {
      const seqRes = await pool.query(
        `SELECT pg_get_serial_sequence($1, 'id') AS seq`, [table]
      );
      const seq: string | null = seqRes.rows[0]?.seq ?? null;
      if (seq) {
        await pool.query(
          `SELECT setval($1, GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0), 1), true)`,
          [seq]
        );
      }
    } catch (_) {}
  }
}

export async function seedDatabase() {
  const adminEmail = process.env.CRM_ADMIN_EMAIL;
  const adminPassword = process.env.CRM_ADMIN_PASSWORD;
  const adminEmail2 = process.env.CRM_ADMIN_EMAIL2;
  const adminPassword2 = process.env.CRM_ADMIN_PASSWORD2;

  if (!adminEmail || !adminPassword) {
    logger.warn(
      "CRM_ADMIN_EMAIL or CRM_ADMIN_PASSWORD not set — skipping CRM super admin seed. " +
        "The CRM will have no admin account until these are set.",
    );
    return;
  }

  // Repair serial sequences before any INSERT (sequences can drift to 0/null on Neon)
  await repairSequences();
  // Ensure all performance indexes exist (idempotent — safe to run every startup)
  await ensureIndexes();
  // Ensure new tables exist (idempotent CREATE TABLE IF NOT EXISTS)
  await ensureTables();
  // Ensure schema columns exist (idempotent ALTER TABLE IF NOT EXISTS)
  await ensureColumns();

  try {
    await seedAdmin(adminEmail, adminPassword, "TolipAI Admin");
  } catch (err) {
    logger.error({ err }, "Failed to seed primary CRM super admin.");
  }

  if (adminEmail2 && adminPassword2) {
    try {
      await seedAdmin(adminEmail2, adminPassword2, "Super Admin 2");
    } catch (err) {
      logger.error({ err }, "Failed to seed secondary CRM super admin.");
    }
  }

  // Remove any super_admin accounts not in the allowed list.
  // This cleans up stale accounts left behind from old secrets.
  const allowed = [adminEmail, ...(adminEmail2 ? [adminEmail2] : [])];
  try {
    const deleted = await db
      .delete(crmUsers)
      .where(and(eq(crmUsers.role, "super_admin"), notInArray(crmUsers.email, allowed)))
      .returning({ email: crmUsers.email });
    if (deleted.length > 0) {
      logger.info({ removed: deleted.map(r => r.email) }, "Removed stale super_admin accounts.");
    }
  } catch (err) {
    logger.error({ err }, "Failed to clean up stale super_admin accounts.");
  }
}
