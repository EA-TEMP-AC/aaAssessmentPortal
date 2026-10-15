import crypto from "node:crypto";
import { clientIp } from "../../lib/client-ip.js";
import { toObjectIdOrNull } from "../../lib/object-id.js";
import { maskEmail, maskPhone } from "../../lib/redact.js";
import { AccessLog } from "../../models/access-log.model.js";

function sanitizeSubjectId(id) {
  if (typeof id !== "string") return id;
  if (id.includes("@")) return maskEmail(id);
  const digits = id.replace(/\D/g, "");
  if (digits.length >= 10 && id.length <= 15) return maskPhone(id);
  return id;
}

/** Contract lists `page` and `pageSize`. Same default and cap as the other lists. */
export const ACCESS_LOG_DEFAULT_PAGE_SIZE = 20;

/**
 * Records that `req.user` read personal data of the given people. Ids and field names only.
 * The caller awaits this before sending the response, so a read that cannot be logged is
 * not served (the audit middleware does the same for writes).
 *
 * @param {import("express").Request} req
 * @param {{ subjectType: string, subjectIds: Array<string|object>, kind: "list"|"detail", fields: string[] }} entry
 */
export async function recordAccess(req, entry) {
  const ids = [
    ...new Set(entry.subjectIds.filter(Boolean).map((id) => sanitizeSubjectId(String(id)))),
  ];
  if (ids.length === 0) return 0;

  const requestId = crypto.randomUUID();
  const route = `${req.method} ${req.baseUrl}${req.route?.path === "/" ? "" : (req.route?.path ?? "")}`;
  const actorId = toObjectIdOrNull(req.user?._id);
  const rows = ids.map((subjectId) => ({
    actorId,
    actorRole: req.user?.role,
    subjectType: entry.subjectType,
    subjectId,
    kind: entry.kind,
    fields: entry.fields,
    route,
    requestId,
    ip: clientIp(req),
  }));
  await AccessLog.insertMany(rows, { ordered: true });
  return rows.length;
}

function toDto(doc) {
  return {
    id: doc._id.toString(),
    actorId: doc.actorId ? doc.actorId.toString() : null,
    actorRole: doc.actorRole ?? null,
    subjectType: doc.subjectType,
    subjectId: doc.subjectId,
    kind: doc.kind,
    fields: [...(doc.fields ?? [])],
    route: doc.route,
    requestId: doc.requestId,
    ip: doc.ip ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listAccessLogs(query) {
  const filter = {};
  if (query.subjectType) filter.subjectType = query.subjectType;
  if (query.subjectId) filter.subjectId = query.subjectId;
  if (query.kind) filter.kind = query.kind;
  if (query.actorId) filter.actorId = toObjectIdOrNull(query.actorId);
  if (query.actorRole) filter.actorRole = query.actorRole;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    AccessLog.countDocuments(filter),
    AccessLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize),
  ]);
  return { page: query.page, pageSize: query.pageSize, total, items: docs.map(toDto) };
}
