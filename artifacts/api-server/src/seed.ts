import { db } from "@workspace/db";
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
    await db.insert(crmUsers).values({
      name,
      email,
      passwordHash,
      role: "super_admin",
      campaignId: null,
      status: "active",
    });
    logger.info({ email }, "CRM super admin created successfully.");
  }
}

async function ensureColumns() {
  const columns: [string, string][] = [
    ["crm_call_logs.disposition",          "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS disposition text"],
    ["crm_call_logs.ai_coaching_summary",  "ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS ai_coaching_summary text"],
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

  // Ensure all performance indexes exist (idempotent — safe to run every startup)
  await ensureIndexes();
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
