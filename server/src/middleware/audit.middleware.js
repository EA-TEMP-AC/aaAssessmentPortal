import mongoose from "mongoose";
import { maskPersonalData, redactSecrets, stripNationalIds } from "../lib/redact.js";
import { toObjectIdOrNull } from "../lib/object-id.js";
import { AuditLog } from "../models/audit-log.model.js";
import { clientIp } from "../lib/client-ip.js";
import { safeErrorCode } from "../lib/safe-error.js";

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

/** The only keys a question route may put in an audit row. Everything else is dropped. */
export const QUESTION_AUDIT_SAFE_KEYS = new Set([
  "_id",
  "id",
  "qualificationId",
  "nosId",
  "pcId",
  "type",
  "language",
  "difficulty",
  "bloomLevel",
  "marks",
  "status",
  "version",
  "rootQuestionId",
  "previousVersionId",
  "isLatest",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "abId",
  "sector",
  "active",
  "code",
  "intervalMonths",
  "reviewerId",
  "dueDate",
  "overdue",
  "closedBy",
  "closedAt",
  "counts",
  "total",
  "pending",
  "decided",
  "incomplete",
  "questionId",
  "resultQuestionId",
  "decision",
  "commentLength",
  "partial",
  "totalRows",
  "importedCount",
  "createdCount",
  "updatedCount",
  "errorCount",
]);

/** True for a Buffer, a typed array or a long base64-looking string: file bytes in any form. */
export function looksLikeFileData(value) {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return true;
  }
  return typeof value === "string" && value.length > 256 && /^[A-Za-z0-9+/=]+$/.test(value);
}

/**
 * Allow-list filter for question routes: keeps only QUESTION_AUDIT_SAFE_KEYS and drops file bytes.
 * When anything was dropped, `content: "[redacted]"` marks the level.
 */
export function redactQuestionContent(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toObject === "function") {
    value = value.toObject();
  } else if (typeof value.toJSON === "function") {
    value = value.toJSON();
  }
  if (Array.isArray(value)) {
    return value.filter((item) => !looksLikeFileData(item)).map(redactQuestionContent);
  }
  if (looksLikeFileData(value)) return "[redacted_binary]";
  if (!isPlainObject(value)) return value;

  const out = {};
  let dropped = false;
  for (const [k, v] of Object.entries(value)) {
    if (!QUESTION_AUDIT_SAFE_KEYS.has(k) || looksLikeFileData(v)) {
      dropped = true;
    } else if (isPlainObject(v) || Array.isArray(v)) {
      out[k] = redactQuestionContent(v);
    } else if (typeof v === "string" && v.length > 200) {
      dropped = true;
    } else {
      out[k] = v;
    }
  }
  if (dropped) out.content = "[redacted]";
  return out;
}

/** Any route: a Buffer or base64 file never reaches an audit row. */
function withoutFileData(value) {
  if (looksLikeFileData(value)) return "[redacted_binary]";
  if (Array.isArray(value)) return value.map(withoutFileData);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = withoutFileData(v);
  return out;
}

function auditEntryFromRequest(req) {
  const hinted = req.audit ?? {};
  const isQuestion =
    hinted.entity === "question" ||
    (typeof req.originalUrl === "string" && req.originalUrl.includes("question-bank"));

  // Answers are the candidate's own text, so a route can keep the raw body out of the row.
  // A Buffer body (raw or multipart upload) is never logged, whatever the route says.
  let requestBody =
    !hinted.omitRequestBody &&
    req.body &&
    typeof req.body === "object" &&
    !looksLikeFileData(req.body)
      ? withoutFileData(maskPersonalData(stripNationalIds(redactSecrets(req.body))))
      : undefined;

  if (isQuestion && requestBody) {
    requestBody = redactQuestionContent(requestBody);
  }

  const before = isQuestion
    ? redactQuestionContent(hinted.before)
    : withoutFileData(maskPersonalData(hinted.before));
  const after = isQuestion
    ? redactQuestionContent(hinted.after)
    : withoutFileData(maskPersonalData(hinted.after));

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
    meta: withoutFileData(maskPersonalData(rawMeta)),
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
    // The change is already saved, so a failed audit insert is logged by code and the response kept.
    return Promise.resolve()
      .then(() => logOnce())
      .catch((err) => {
        console.error("audit log write failed", safeErrorCode(err, "AUDIT_WRITE_FAILED"));
      })
      .then(() => originalSend(body));
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
