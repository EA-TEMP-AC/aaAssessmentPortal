import mongoose from "mongoose";
import { maskPersonalData, redactSecrets, stripNationalIds } from "../lib/redact.js";
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
    before: maskPersonalData(redactSecrets(entry.before ?? undefined)),
    after: maskPersonalData(redactSecrets(entry.after ?? undefined)),
    meta: maskPersonalData(redactSecrets(entry.meta ?? undefined)),
    ip: entry.ip ?? undefined,
  });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Date) return false;
  if (Buffer.isBuffer(value)) return false;
  if (typeof value._bsontype === "string") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactQuestionContent(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toObject === "function") {
    value = value.toObject();
  } else if (typeof value.toJSON === "function") {
    value = value.toJSON();
  }
  if (Array.isArray(value)) return value.map(redactQuestionContent);
  if (!isPlainObject(value)) return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "stem" || k === "comment") {
      // Q-04: a review comment can quote the question it is about.
      out[k] = "[redacted]";
    } else if (k === "correctAnswer") {
      out[k] = "[redacted]";
    } else if (k === "options" && Array.isArray(v)) {
      out[k] = v.map((opt) => ({
        key: opt?.key,
        text: "[redacted]",
      }));
    } else if (["fileBase64", "fileData", "file"].includes(k)) {
      out[k] = "[redacted_binary]";
    } else if (isPlainObject(v) || Array.isArray(v)) {
      out[k] = redactQuestionContent(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function auditEntryFromRequest(req) {
  const hinted = req.audit ?? {};
  const isQuestion =
    hinted.entity === "question" ||
    (typeof req.originalUrl === "string" && req.originalUrl.includes("question-bank"));

  let requestBody =
    req.body && typeof req.body === "object"
      ? maskPersonalData(stripNationalIds(redactSecrets(req.body)))
      : undefined;

  if (isQuestion && requestBody) {
    requestBody = redactQuestionContent(requestBody);
  }

  const before = isQuestion
    ? redactQuestionContent(hinted.before)
    : maskPersonalData(hinted.before);
  const after = isQuestion ? redactQuestionContent(hinted.after) : maskPersonalData(hinted.after);

  const rawMeta = {
    ...(hinted.meta ? (isQuestion ? redactQuestionContent(hinted.meta) : hinted.meta) : {}),
    ...(requestBody ? { requestBody } : {}),
  };

  return {
    actorId: hinted.actorId ?? req.user?._id,
    actorRole: hinted.actorRole ?? req.user?.role,
    action: hinted.action ?? `${req.method} ${req.originalUrl}`,
    entity: hinted.entity ?? "http",
    entityId: hinted.entityId,
    abId: hinted.abId,
    batchId: hinted.batchId,
    before,
    after,
    meta: maskPersonalData(rawMeta),
    ip: clientIp(req),
  };
}

/**
 * Writes one append-only auditLogs row for successful mutations.
 * Failed auth sets req.audit.logOnFailure. Secrets are redacted.
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
