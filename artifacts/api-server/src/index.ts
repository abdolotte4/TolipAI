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

seedDatabase().then(() => {
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

    // Idempotent startup migration: ensure crm_waitlist table exists
    pool.query(`
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
    `).catch((err: unknown) => logger.error({ err }, "[startup] crm_waitlist migration failed"));

    // ── DB indexes ────────────────────────────────────────────────────────────
    // Run each index creation separately (CONCURRENTLY cannot run in a transaction)
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
    (async () => {
      for (const idx of ensureIndexes) {
        try {
          await pool.query(idx.sql);
        } catch (err: any) {
          // "already exists" or concurrent-build races are non-fatal
          if (!err?.message?.includes("already exists")) {
            logger.warn({ index: idx.name, err: err?.message }, "[startup] index creation warning");
          }
        }
      }
      logger.info("DB indexes verified.");
    })();

    runEmailSequenceJob();
    setInterval(runEmailSequenceJob, 60 * 60 * 1000);

    runTaskAutomationCron();
    setInterval(runTaskAutomationCron, 60 * 60 * 1000);

    runOnboardingEmailCron();
    setInterval(runOnboardingEmailCron, 30 * 60 * 1000);

    // ── AI Voice Agent WebSocket server ───────────────────────────────────────
    // Twilio Media Streams connects here to stream audio for the AI agent.
    // Path: /api/twilio/voice/agent-stream
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
