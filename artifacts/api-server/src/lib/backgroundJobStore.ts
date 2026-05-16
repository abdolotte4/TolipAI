/**
 * DB-backed background job store (P2-03)
 *
 * Replaces in-memory Maps that were lost on every Railway deploy.
 * Uses crm_background_jobs for persistence.
 *
 * Usage:
 *   const id = await createBackgroundJob({ type: "power_dial", campaignId: 1, actorId: 42, payload: {...} });
 *   await updateBackgroundJob(id, { status: "running", progress: 50 });
 *   const job = await getBackgroundJob(id);
 */

import { db } from "@workspace/db";
import { crmBackgroundJobs } from "@workspace/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface CreateJobOptions {
  type: string;
  campaignId?: number | null;
  actorId?: number | null;
  payload?: Record<string, unknown>;
  expiresInMs?: number;
}

export async function createBackgroundJob(opts: CreateJobOptions): Promise<string> {
  const id = randomUUID();
  const expiresAt = opts.expiresInMs ? new Date(Date.now() + opts.expiresInMs) : null;
  await db.insert(crmBackgroundJobs).values({
    id,
    type: opts.type,
    campaignId: opts.campaignId ?? null,
    actorId: opts.actorId ?? null,
    payload: (opts.payload ?? null) as any,
    status: "queued",
    progress: 0,
    expiresAt,
  });
  return id;
}

export async function updateBackgroundJob(
  id: string,
  updates: {
    status?: JobStatus;
    progress?: number;
    result?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    error?: string;
  }
): Promise<void> {
  try {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) set.status = updates.status;
    if (updates.progress !== undefined) set.progress = updates.progress;
    if (updates.result !== undefined) set.result = updates.result as any;
    if (updates.payload !== undefined) set.payload = updates.payload as any;
    if (updates.error !== undefined) set.error = updates.error;
    await db.update(crmBackgroundJobs).set(set).where(eq(crmBackgroundJobs.id, id));
  } catch (err) {
    logger.error(err, "[bgJob] Failed to update job");
  }
}

export async function getBackgroundJob(id: string) {
  const [job] = await db
    .select()
    .from(crmBackgroundJobs)
    .where(eq(crmBackgroundJobs.id, id))
    .limit(1);
  return job ?? null;
}

export async function cancelBackgroundJob(id: string): Promise<void> {
  await db
    .update(crmBackgroundJobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(crmBackgroundJobs.id, id));
}

// Call periodically (or on startup) to purge expired jobs.
export async function pruneExpiredJobs(): Promise<void> {
  try {
    await db
      .update(crmBackgroundJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(crmBackgroundJobs.status, "running"),
          lt(crmBackgroundJobs.expiresAt, new Date())
        )
      );
  } catch (err) {
    logger.error(err, "[bgJob] Prune failed — non-fatal");
  }
}
