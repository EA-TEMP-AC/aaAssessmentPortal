import { invalidTransition, notFound, validationError } from "../../lib/errors.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { ContentAnomaly } from "../../models/content-anomaly.model.js";
import {
  FINDING_SEVERITIES,
  SecurityAudit,
  SecurityFinding,
} from "../../models/security-audit.model.js";

const idOf = (value) => (value == null ? null : value.toString());
const iso = (value) => new Date(value).toISOString();
const today = () => istCalendarDate(new Date());

function presentAudit(doc) {
  return {
    id: idOf(doc._id),
    type: doc.type,
    auditor: doc.auditor,
    auditDate: doc.auditDate,
    scope: doc.scope,
    status: doc.status,
    fixesDueDate: doc.fixesDueDate ?? null,
    closedDate: doc.closedDate ?? null,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentFinding(doc) {
  return {
    id: idOf(doc._id),
    auditId: idOf(doc.auditId),
    severity: doc.severity,
    description: doc.description,
    owner: doc.owner,
    status: doc.status,
    dueDate: doc.dueDate,
    closedDate: doc.closedDate ?? null,
    evidenceRef: doc.evidenceRef ?? null,
    overdue: doc.status === "open" && doc.dueDate < today(),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentAnomaly(doc) {
  return {
    id: idOf(doc._id),
    userId: idOf(doc.userId),
    role: doc.role,
    day: doc.day,
    cap: doc.cap,
    readCount: doc.readCount,
    attemptedCount: doc.attemptedCount,
    refusedRequests: doc.refusedRequests,
    route: doc.route,
    firstAt: iso(doc.firstAt),
    lastAt: iso(doc.lastAt),
  };
}

async function paginate(model, filter, query, present, sort) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    model.countDocuments(filter),
    model.find(filter).sort(sort).skip(skip).limit(query.pageSize).lean(),
  ]);
  return { page: query.page, pageSize: query.pageSize, total, items: docs.map(present) };
}

/**
 * Status and closed date move together: closing sets the date (today unless the caller gave one,
 * never in the future), reopening clears it, and a date cannot be sent for an open record.
 */
function closedDateFor(current, patch) {
  const status = patch.status ?? current.status;
  if (status === "open") {
    if (patch.closedDate) throw validationError("closedDate only applies to a closed record");
    return patch.status === "open" ? { closedDate: null } : {};
  }
  if (patch.status === "closed" || patch.closedDate) {
    const closedDate = patch.closedDate ?? today();
    if (closedDate > today()) throw validationError("closedDate cannot be in the future");
    return { closedDate };
  }
  return {};
}

function updateSet(current, patch) {
  return { ...patch, ...closedDateFor(current, patch) };
}

async function loadAudit(id) {
  const doc = await SecurityAudit.findOne({ _id: id, archivedAt: null }).lean();
  if (!doc) throw notFound("Security audit not found");
  return doc;
}

async function loadFinding(id) {
  const doc = await SecurityFinding.findOne({ _id: id, archivedAt: null }).lean();
  if (!doc) throw notFound("Security finding not found");
  return doc;
}

export async function createAudit(body) {
  const doc = await SecurityAudit.create({ ...body, fixesDueDate: body.fixesDueDate ?? null });
  return presentAudit(doc.toObject());
}

export async function listAudits(query) {
  const filter = { archivedAt: null };
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  return paginate(SecurityAudit, filter, query, presentAudit, { auditDate: -1, _id: -1 });
}

export async function getAudit(id) {
  return presentAudit(await loadAudit(id));
}

export async function updateAudit(id, patch) {
  const current = await loadAudit(id);
  if (patch.auditDate || "fixesDueDate" in patch) {
    const auditDate = patch.auditDate ?? current.auditDate;
    const due = "fixesDueDate" in patch ? patch.fixesDueDate : current.fixesDueDate;
    if (due && due < auditDate) throw validationError("fixesDueDate must be on or after auditDate");
  }
  const set = updateSet(current, patch);
  if ("fixesDueDate" in set) set.fixesDueDate = set.fixesDueDate ?? null;
  const updated = await SecurityAudit.findOneAndUpdate(
    { _id: id, archivedAt: null },
    { $set: set },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw notFound("Security audit not found");
  return { before: presentAudit(current), after: presentAudit(updated) };
}

/** Archives an audit. Refused while it still has live findings. Nothing is deleted. */
export async function archiveAudit(id) {
  const current = await loadAudit(id);
  const live = await SecurityFinding.countDocuments({ auditId: id, archivedAt: null });
  if (live > 0) throw invalidTransition("Archive this audit's findings first");
  await SecurityAudit.updateOne({ _id: id }, { $set: { archivedAt: new Date() } });
  return presentAudit(current);
}

export async function createFinding(auditId, body) {
  const audit = await loadAudit(auditId);
  if (audit.status === "closed") throw invalidTransition("The audit is closed; reopen it first");
  const doc = await SecurityFinding.create({
    ...body,
    auditId,
    evidenceRef: body.evidenceRef ?? null,
  });
  return presentFinding(doc.toObject());
}

export async function listFindings(query, auditId) {
  const filter = { archivedAt: null };
  if (auditId) await loadAudit(auditId);
  const scopeAudit = auditId ?? query.auditId;
  if (scopeAudit) filter.auditId = scopeAudit;
  if (query.severity) filter.severity = query.severity;
  if (query.status) filter.status = query.status;
  if (query.overdue === true) Object.assign(filter, { status: "open", dueDate: { $lt: today() } });
  if (query.overdue === false) filter.$nor = [{ status: "open", dueDate: { $lt: today() } }];
  return paginate(SecurityFinding, filter, query, presentFinding, { dueDate: 1, _id: -1 });
}

export async function getFinding(id) {
  return presentFinding(await loadFinding(id));
}

export async function updateFinding(id, patch) {
  const current = await loadFinding(id);
  const set = updateSet(current, patch);
  if ("evidenceRef" in set) set.evidenceRef = set.evidenceRef ?? null;
  const updated = await SecurityFinding.findOneAndUpdate(
    { _id: id, archivedAt: null },
    { $set: set },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw notFound("Security finding not found");
  return { before: presentFinding(current), after: presentFinding(updated) };
}

export async function archiveFinding(id) {
  const current = await loadFinding(id);
  await SecurityFinding.updateOne({ _id: id }, { $set: { archivedAt: new Date() } });
  return presentFinding(current);
}

/** Open findings by severity, how many are past due, and how many open audits are past their date. */
export async function auditSummary() {
  const day = today();
  const [bySeverity, overdueFindings, overdueAudits, openAudits] = await Promise.all([
    SecurityFinding.aggregate([
      { $match: { archivedAt: null, status: "open" } },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
    ]),
    SecurityFinding.countDocuments({ archivedAt: null, status: "open", dueDate: { $lt: day } }),
    SecurityAudit.countDocuments({ archivedAt: null, status: "open", fixesDueDate: { $lt: day } }),
    SecurityAudit.countDocuments({ archivedAt: null, status: "open" }),
  ]);
  const openFindingsBySeverity = Object.fromEntries(FINDING_SEVERITIES.map((s) => [s, 0]));
  for (const row of bySeverity) openFindingsBySeverity[row._id] = row.count;
  return {
    asOf: day,
    openAudits,
    openFindingsBySeverity,
    openFindingsTotal: Object.values(openFindingsBySeverity).reduce((a, b) => a + b, 0),
    overdueCount: overdueFindings,
    overdueAudits,
  };
}

export async function listContentAnomalies(query) {
  const filter = {};
  if (query.userId) filter.userId = query.userId;
  if (query.day) filter.day = query.day;
  return paginate(ContentAnomaly, filter, query, presentAnomaly, { lastAt: -1, _id: -1 });
}
