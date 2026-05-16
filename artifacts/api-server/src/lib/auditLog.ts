/**
 * Audit Log helper (P2-04)
 *
 * Writes immutable, append-only rows to crm_audit_log.
 * All failures are logged-and-swallowed so they never break the main request.
 *
 * Usage:
 *   await writeAuditLog({
 *     tableName: "crm_leads",
 *     rowId: lead.id,
 *     actorId: crmUser.userId,
 *     actorName: actorUser.name,
 *     action: "status_change",
 *     field: "status",
 *     oldValue: "new",
 *     newValue: "contacted",
 *     metadata: { leadAddress: lead.address, campaignId: lead.campaignId },
 *   });
 */

import { db } from "@workspace/db";
import { crmAuditLog } from "@workspace/db/schema";
import { logger } from "./logger";

export interface AuditEntry {
  tableName: string;
  rowId: number;
  actorId?: number | null;
  actorName?: string | null;
  action: "create" | "update" | "delete" | "status_change";
  field?: string | null;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeAuditLog(entries: AuditEntry | AuditEntry[]): Promise<void> {
  const rows = Array.isArray(entries) ? entries : [entries];
  if (rows.length === 0) return;
  try {
    await db.insert(crmAuditLog).values(
      rows.map((e) => ({
        tableName: e.tableName,
        rowId: e.rowId,
        actorId: e.actorId ?? null,
        actorName: e.actorName ?? null,
        action: e.action,
        field: e.field ?? null,
        oldValue: e.oldValue != null ? String(e.oldValue) : null,
        newValue: e.newValue != null ? String(e.newValue) : null,
        metadata: (e.metadata ?? null) as any,
      }))
    );
  } catch (err) {
    logger.error(err, "[audit] Failed to write audit log — non-fatal");
  }
}
