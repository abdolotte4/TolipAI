import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "./seed";
import { runEmailSequenceJob } from "./routes/crm/sequences";
import { runTaskAutomationCron, runOnboardingEmailCron } from "./services/automation";
import { pool } from "@workspace/db";
import { WebSocketServer } from "ws";
import { handleAgentStream } from "./routes/twilio-voice-agent";

const port = Number(process.env["PORT"] || 3000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// Validate critical environment variables before the server starts
const missingVars: string[] = [];
if (!process.env["JWT_SECRET"])    missingVars.push("JWT_SECRET");
if (!process.env["DATABASE_URL"])  missingVars.push("DATABASE_URL");
if (missingVars.length > 0) {
  logger.error({ missingVars }, "Missing required environment variables — server cannot start safely");
  process.exit(1);
}

let server: ReturnType<typeof app.listen>;

// ── DB startup tasks (run BEFORE accepting connections — BUG-BOOT-01) ────────
// Awaiting these ensures indexes and sequences are in place before the first
// request is served, eliminating the startup race condition.
async function runDbStartupTasks(): Promise<void> {
  // Idempotent migration: ensure crm_phone_read_receipts table exists (Phase 2.2)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_phone_read_receipts (
        id           SERIAL       PRIMARY KEY,
        campaign_id  INTEGER      NOT NULL,
        owned_number TEXT         NOT NULL,
        contact      TEXT         NOT NULL,
        last_read_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (campaign_id, owned_number, contact)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS crm_phone_read_receipts_campaign_idx
        ON crm_phone_read_receipts (campaign_id)
    `);
  } catch (err: unknown) {
    logger.error({ err }, "[startup] crm_phone_read_receipts migration failed");
  }

  // Idempotent migration: ensure crm_appointments table exists (BUG-043)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_appointments (
        id           SERIAL       PRIMARY KEY,
        lead_id      INTEGER      NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
        campaign_id  INTEGER      REFERENCES crm_campaigns(id),
        title        TEXT         NOT NULL,
        scheduled_at TIMESTAMPTZ  NOT NULL,
        duration_mins INTEGER     NOT NULL DEFAULT 30,
        location     TEXT,
        notes        TEXT,
        status       TEXT         NOT NULL DEFAULT 'scheduled',
        created_by   INTEGER      REFERENCES crm_users(id),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS crm_appointments_lead_id_idx ON crm_appointments (lead_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS crm_appointments_campaign_id_idx ON crm_appointments (campaign_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS crm_appointments_scheduled_at_idx ON crm_appointments (scheduled_at)`);
  } catch (err: unknown) {
    logger.error({ err }, "[startup] crm_appointments migration failed");
  }

  // Idempotent migration: ensure crm_submission_links table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_submission_links (
        id                SERIAL      PRIMARY KEY,
        campaign_id       INTEGER     REFERENCES crm_campaigns(id),
        token             TEXT        NOT NULL UNIQUE,
        label             TEXT,
        lead_source       TEXT,
        active            BOOLEAN     NOT NULL DEFAULT TRUE,
        created_by        INTEGER     REFERENCES crm_users(id),
        submissions_count INTEGER     NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS crm_submission_links_campaign_id_idx ON crm_submission_links (campaign_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS crm_submission_links_active_idx ON crm_submission_links (active)`);
    // Ensure column defaults exist (may be missing if table predates Drizzle push)
    await pool.query(`ALTER TABLE crm_submission_links ALTER COLUMN created_at SET DEFAULT NOW()`);
    await pool.query(`ALTER TABLE crm_submission_links ALTER COLUMN active SET DEFAULT TRUE`);
    await pool.query(`ALTER TABLE crm_submission_links ALTER COLUMN submissions_count SET DEFAULT 0`);
    // Backfill any rows with null created_at
    await pool.query(`UPDATE crm_submission_links SET created_at = NOW() WHERE created_at IS NULL`);
  } catch (err: unknown) {
    logger.error({ err }, "[startup] crm_submission_links migration failed");
  }

  // ── Sequence repair for SERIAL tables whose sequences may be missing ─────────
  // Some tables were created without a proper SERIAL sequence (e.g. via an
  // older migration path). Ensure each table's id column has a working sequence.
  const serialRepairs = [
    "crm_comps",
    "crm_submission_links",
    "crm_appointments",
  ];
  for (const table of serialRepairs) {
    try {
      const seqName = `${table}_id_seq`;
      // Create the sequence if it doesn't exist
      await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${seqName}`);
      // Attach it as the column default (idempotent — IF NOT EXISTS not supported
      // for SET DEFAULT, but the error is safe to swallow)
      await pool.query(
        `ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${seqName}')`
      );
      // Set sequence ownership so it drops with the table
      await pool.query(
        `ALTER SEQUENCE ${seqName} OWNED BY ${table}.id`
      );
      // Advance the sequence past any existing max id
      await pool.query(
        `SELECT setval('${seqName}', GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, 1), false)`
      );
    } catch (e: any) {
      logger.warn({ table, err: e?.message }, "[startup] serial sequence repair warning");
    }
  }

  // Idempotent migration: ensure crm_waitlist table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_waitlist (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email       TEXT        NOT NULL UNIQUE,
        name        TEXT,
        phone       TEXT,
        source      TEXT        NOT NULL DEFAULT 'landing_hero',
        status      TEXT        NOT NULL DEFAULT 'pending',
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err: unknown) {
    logger.error({ err }, "[startup] crm_waitlist migration failed");
  }

  // ── Idempotent column migrations — add missing columns that weren't in initial migrations ──
  const columnMigrations: Array<{ desc: string; sql: string }> = [
    // distressed_listings.imported_as_lead_id — in Drizzle schema but column never created
    {
      desc: "distressed_listings.imported_as_lead_id",
      sql: `ALTER TABLE distressed_listings ADD COLUMN IF NOT EXISTS imported_as_lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL`,
    },
    // crm_leads.owner_llc — in DB but missing from initial Drizzle push
    {
      desc: "crm_leads.owner_llc",
      sql: `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS owner_llc TEXT`,
    },
    // crm_leads.how_heard — in DB but not in schema until now
    {
      desc: "crm_leads.how_heard",
      sql: `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS how_heard TEXT`,
    },
    // crm_leads.offer_sent_at / offer_amount — in DB but not in schema
    {
      desc: "crm_leads.offer_sent_at",
      sql: `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS offer_sent_at TIMESTAMPTZ`,
    },
    {
      desc: "crm_leads.offer_amount",
      sql: `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS offer_amount NUMERIC(12,2)`,
    },
    // crm_users.password_plain — in DB but not in schema
    {
      desc: "crm_users.password_plain",
      sql: `ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS password_plain TEXT`,
    },
    // tools_distressed_jobs and tools_skip_trace_jobs — DB has nullable columns, convert notNull constraints
    // (non-destructive: just ensure the column exists with the right type)
    {
      desc: "tools_distressed_jobs.status default",
      sql: `ALTER TABLE tools_distressed_jobs ALTER COLUMN status SET DEFAULT 'queued'`,
    },
  ];
  for (const m of columnMigrations) {
    try {
      await pool.query(m.sql);
    } catch (err: any) {
      logger.warn({ desc: m.desc, err: err?.message }, "[startup] column migration warning");
    }
  }
  logger.info("DB column migrations verified.");

  // ── DB indexes (CONCURRENTLY — no table lock, safe to run before listen) ──
  const ensureIndexes: Array<{ name: string; sql: string }> = [
    {
      name: "crm_leads_phone_idx",
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_leads_phone_idx ON crm_leads (phone)`,
    },
    {
      name: "crm_notes_lead_date_idx",
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_notes_lead_date_idx ON crm_notes (lead_id, created_at DESC)`,
    },
    {
      name: "crm_notifications_user_unread_idx",
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_notifications_user_unread_idx ON crm_notifications (user_id, read, created_at DESC)`,
    },
    {
      name: "crm_sequence_logs_dedup_idx",
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_sequence_logs_dedup_idx ON crm_sequence_logs (lead_id, sequence_id, step_id)`,
    },
    {
      name: "crm_call_logs_call_sid_unique_idx",
      sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS crm_call_logs_call_sid_unique_idx ON crm_call_logs (call_sid) WHERE call_sid IS NOT NULL`,
    },
    {
      name: "crm_leads_fts_idx",
      sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_leads_fts_idx ON crm_leads USING gin(to_tsvector('english', coalesce(address,'') || ' ' || coalesce(city,'') || ' ' || coalesce(state,'') || ' ' || coalesce(seller_name,'')))`,
    },
  ];
  for (const idx of ensureIndexes) {
    try {
      await pool.query(idx.sql);
    } catch (err: any) {
      if (!err?.message?.includes("already exists")) {
        logger.warn({ index: idx.name, err: err?.message }, "[startup] index creation warning");
      }
    }
  }
  logger.info("DB indexes verified.");

  // ── Sequence / identity health-check ──────────────────────────────────────
  const seqTables = ["crm_call_logs", "crm_users", "crm_leads", "crm_comps", "crm_submission_links"];
  for (const table of seqTables) {
    try {
      const seqRes = await pool.query(
        `SELECT pg_get_serial_sequence($1, 'id') AS seq`, [table]
      );
      const seq: string | null = seqRes.rows[0]?.seq ?? null;
      if (!seq) {
        await pool.query(
          `DO $$ DECLARE v INT; BEGIN SELECT COALESCE(MAX(id),0)+1 INTO v FROM ${table}; EXECUTE 'ALTER TABLE ${table} ALTER COLUMN id RESTART WITH '||v; END $$`
        );
      } else {
        await pool.query(
          `SELECT setval($1, GREATEST(COALESCE((SELECT MAX(id) FROM ${table}),0), 1), true)`, [seq]
        );
      }
    } catch (e: any) {
      logger.warn({ table, err: e?.message }, "[startup] sequence reset warning");
    }
  }
  logger.info("DB sequences verified.");
}

seedDatabase().then(async () => {
  // Run all DB startup tasks (indexes + sequence repair) BEFORE the server
  // starts accepting requests — eliminates the BUG-BOOT-01 startup race.
  await runDbStartupTasks();

  server = app.listen(port, "0.0.0.0", (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening on 0.0.0.0");

    pool.query("SELECT 1").catch(() => {});
    setInterval(() => {
      for (let i = 0; i < 6; i++) pool.query("SELECT 1").catch(() => {});
    }, 8000);

    runEmailSequenceJob();
    setInterval(runEmailSequenceJob, 60 * 60 * 1000);

    runTaskAutomationCron();
    setInterval(runTaskAutomationCron, 60 * 60 * 1000);

    runOnboardingEmailCron();
    setInterval(runOnboardingEmailCron, 30 * 60 * 1000);

    // ── AI Voice Agent WebSocket server ───────────────────────────────────────
    const agentWss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      if (req.url?.includes("/twilio/voice/agent-stream")) {
        agentWss.handleUpgrade(req, socket, head, (ws) => {
          handleAgentStream(ws, req);
        });
      } else {
        socket.destroy();
      }
    });
    logger.info("[agent] AI Voice Agent WebSocket server ready");
  });
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal — draining connections");
  if (server) {
    server.close(() => {
      logger.info("HTTP server closed");
    });
  }
  try {
    await pool.end();
    logger.info("DB pool closed");
  } catch (err) {
    logger.error({ err }, "Error closing DB pool");
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
