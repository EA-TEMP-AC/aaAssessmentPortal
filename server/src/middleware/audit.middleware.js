import mongoose from "mongoose";
import { redactSecrets } from "../lib/redact.js";
import { toObjectIdOrNull } from "../lib/object-id.js";
import { AuditLog } from "../models/audit-log.model.js";
import { clientIp } from "../lib/client-ip.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function recordAudit(entry) {
  return AuditLog.create({
    actorId: toObjectIdOrNull(entry.actorId),
    actorRole: entry.actorRole ?? undefined,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId == null || entry.entityId === "" ? undefined : String(entry.entityId),
    abId: toObjectIdOrNull(entry.abId),
    batchId: toObjectIdOrNull(entry.batchId),
    before: redactSecrets(entry.before ?? undefined),
    after: redactSecrets(entry.after ?? undefined),
    meta: redactSecrets(entry.meta ?? undefined),
    ip: entry.ip ?? undefined,
  });
}

function auditEntryFromRequest(req) {
  const hinted = req.audit ?? {};
  const requestBody =
    req.body && typeof req.body === "object" ? redactSecrets(req.body) : undefined;

  return {
    actorId: hinted.actorId ?? req.user?._id,
    actorRole: hinted.actorRole ?? req.user?.role,
    action: hinted.action ?? `${req.method} ${req.originalUrl}`,
    entity: hinted.entity ?? "http",
    entityId: hinted.entityId,
    abId: hinted.abId,
    batchId: hinted.batchId,
    before: hinted.before,
    after: hinted.after,
    meta: {
      ...(hinted.meta ?? {}),
      ...(requestBody ? { requestBody } : {}),
    },
    ip: clientIp(req),
  };
}

/**
 * Writes one append-only auditLogs row for successful mutations.
 * Failed logins set req.audit.logOnFailure. Secrets are redacted.
 */
export function auditMiddleware(req, res, next) {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  const originalSend = res.send.bind(res);
  let logged = false;

  async function logOnce() {
    if (logged) return;
    logged = true;
    if (res.statusCode >= 400 && !req.audit?.logOnFailure) return;
    await recordAudit(auditEntryFromRequest(req));
  }

  res.send = function patchedSend(body) {
    return Promise.resolve()
      .then(() => logOnce())
      .then(() => originalSend(body))
      .catch((err) => {
        console.error("audit log write failed", err);
        if (res.headersSent) return undefined;
        res.statusCode = 500;
        return originalSend({
          error: { code: "INTERNAL", message: "Internal server error" },
        });
      });
  };

  next();
}

export async function findBatchIdsForAb(abId) {
  const objectId = toObjectIdOrNull(abId);
  if (!objectId) return [];
  const db = mongoose.connection.db;
  if (!db) return [];

  const listed = await db.listCollections({ name: "batches" }).toArray();
  if (listed.length === 0) return [];

  const docs = await db
    .collection("batches")
    .find({ $or: [{ abId: objectId }, { abId: objectId.toString() }] })
    .project({ _id: 1 })
    .toArray();
  return docs.map((doc) => doc._id);
}
