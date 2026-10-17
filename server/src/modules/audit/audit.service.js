import { batchLabels } from "../../lib/display-names.js";
import { forbidden } from "../../lib/errors.js";
import { redactSecrets } from "../../lib/redact.js";
import { AuditLog } from "../../models/audit-log.model.js";
import { findBatchIdsForAb } from "../../middleware/audit.middleware.js";

/** Contract lists `page` only. Fixed page size is a project choice. */
export const AUDIT_PAGE_SIZE = 20;

function andFilters(...filters) {
  const parts = filters.filter((filter) => filter && Object.keys(filter).length > 0);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

/**
 * aa_admin and mis: all rows.
 * ncvet_viewer: all rows (read-only monitoring).
 * ab_reviewer: rows for their abId, or entities tied to batches with that abId.
 * docs/SCHEMA.md §3.15 and §5.
 */
export async function auditReadFilter(user) {
  if (user.role === "aa_admin" || user.role === "mis" || user.role === "ncvet_viewer") {
    return {};
  }
  if (user.role !== "ab_reviewer") {
    throw forbidden();
  }
  if (!user.abId) {
    return { _id: { $in: [] } };
  }

  const batchIds = await findBatchIdsForAb(user.abId);
  return {
    $or: [
      { abId: user.abId },
      { entity: "batch", entityId: { $in: batchIds.map((id) => id.toString()) } },
      { batchId: { $in: batchIds } },
    ],
  };
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * X-20. Batch names for a page of rows. Staff are shown by id, never by name (human decision
 * 2026-10-17, for privacy); only batches, which are not personal data, get a readable label.
 */
async function readableNames(docs) {
  const batchIds = new Set();
  for (const doc of docs) {
    if (doc.batchId) batchIds.add(String(doc.batchId));
    if (doc.entity === "batch" && OBJECT_ID.test(doc.entityId ?? "")) batchIds.add(doc.entityId);
  }
  return { batches: await batchLabels([...batchIds]) };
}

function toDto(doc, names) {
  const entityLabel = doc.entity === "batch" ? (names.batches.get(doc.entityId) ?? null) : null;
  return {
    id: doc._id.toString(),
    actorId: doc.actorId ? doc.actorId.toString() : null,
    actorRole: doc.actorRole ?? null,
    action: doc.action,
    entity: doc.entity,
    entityId: doc.entityId ?? null,
    abId: doc.abId ? doc.abId.toString() : null,
    batchId: doc.batchId ? doc.batchId.toString() : null,
    batchLabel: doc.batchId ? (names.batches.get(String(doc.batchId)) ?? null) : null,
    entityLabel,
    before: redactSecrets(doc.before ?? null),
    after: redactSecrets(doc.after ?? null),
    meta: redactSecrets(doc.meta ?? null),
    ip: doc.ip ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listAuditLogs(user, query) {
  const scope = await auditReadFilter(user);
  const range = {};
  if (query.entity) range.entity = query.entity;
  if (query.entityId) range.entityId = query.entityId;
  if (query.from || query.to) {
    range.createdAt = {};
    if (query.from) range.createdAt.$gte = new Date(query.from);
    if (query.to) range.createdAt.$lte = new Date(query.to);
  }

  const filter = andFilters(scope, range);
  const page = query.page;
  const skip = (page - 1) * AUDIT_PAGE_SIZE;
  const [total, docs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(AUDIT_PAGE_SIZE),
  ]);

  const names = await readableNames(docs);
  return {
    page,
    pageSize: AUDIT_PAGE_SIZE,
    total,
    items: docs.map((doc) => toDto(doc, names)),
  };
}
