import mongoose from "mongoose";
import {
  forbidden,
  invalidTransition,
  notFound,
  slaAcceptExpired,
  validationError,
} from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { recordAudit } from "../../middleware/audit.middleware.js";
import { releaseLocksForBatch } from "./assessor-day-locks.js";
import { batchQueryFilter, isInBatchScope } from "../../middleware/scope.js";
import { AwardingBody } from "../../models/awarding-body.model.js";
import { Centre } from "../../models/centre.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { TrainingPartner } from "../../models/training-partner.model.js";
import { Batch } from "../../models/batch.model.js";
import { BATCH_STATUSES, resolveTransition, rolesForAction } from "./batch-transitions.js";
import { slaDueAtCreation } from "./batch-sla.js";
import { presentLearnerFeedback } from "./learner-feedback.service.js";
import { findBatchIdsForLearner, learnerIsOnBatch } from "../candidates/candidate-scope.js";
import { resolveBatchLinks } from "../schemes/schemes.service.js";
import { recognitionDecision } from "../recognition/recognition.service.js";
import { mergedBreachKeys, OPEN_SLA_STEPS, overdueCondition } from "./sla-breach-job.js";

const ACCEPT_SLA_ACTIONS = new Set(["accept", "reject"]);

function iso(value) {
  return new Date(value).toISOString();
}

function isoOrNull(value) {
  if (value == null) return null;
  return iso(value);
}

function idOf(value) {
  if (value == null || value === "") return null;
  return value.toString();
}

/**
 * Candidate sees batches whose roster contains their learner (Q70).
 * Other roles use the SCHEMA §5 row scope.
 */
async function readScope(user) {
  if (user?.role === "candidate") {
    const ids = await findBatchIdsForLearner(user.linkedProfileId);
    return batchQueryFilter(user, { candidateBatchIds: ids });
  }
  return batchQueryFilter(user);
}

async function canReadBatch(user, batch) {
  if (user?.role === "candidate") {
    return learnerIsOnBatch(user.linkedProfileId, batch._id);
  }
  return isInBatchScope(user, batch);
}

function assertCreator(user, abId) {
  if (user?.role === "aa_admin") return;
  if (user?.role === "ab_reviewer" && user.abId && String(user.abId) === String(abId)) return;
  throw forbidden();
}

function assertReason(action, reason) {
  if (action !== "reject" && action !== "cancel" && action !== "complete") return;
  if (typeof reason !== "string" || reason.trim() === "") {
    throw validationError("reason is required", { reason: ["reason is required"] });
  }
}

async function listFilter(user, query) {
  const scope = await readScope(user);
  if (scope._id?.$in && scope._id.$in.length === 0) return scope;

  const filter = { ...scope };
  if (query.status) filter.status = query.status;
  if (query.tpId) {
    if (filter.tpId && String(filter.tpId) !== query.tpId) return { _id: { $in: [] } };
    filter.tpId = query.tpId;
  }
  if (query.schemeId) filter.schemeId = query.schemeId;
  if (query.projectId) filter.projectId = query.projectId;
  if (query.from || query.to) {
    const range = {};
    if (query.from) range.$gte = query.from;
    if (query.to) range.$lte = query.to;
    filter.assessmentStartDate = range;
  }
  return filter;
}

/**
 * @param {object} doc
 * @param {{ now?: Date, recompute?: boolean }} [options]
 */
export function presentBatch(doc, { now = new Date(), recompute = true } = {}) {
  const breached = recompute ? mergedBreachKeys(doc, now) : [...(doc.sla?.breached ?? [])];
  const ratio = doc.ratioOverride;
  return {
    id: idOf(doc._id),
    abId: idOf(doc.abId),
    qualificationId: idOf(doc.qualificationId),
    type: doc.type,
    mode: doc.mode,
    assessmentStartDate: doc.assessmentStartDate,
    assessmentEndDate: doc.assessmentEndDate,
    tpId: idOf(doc.tpId),
    centreId: idOf(doc.centreId),
    schemeId: idOf(doc.schemeId),
    projectId: idOf(doc.projectId),
    candidateCount: doc.candidateCount,
    sector: doc.sector,
    ratioClass: doc.ratioClass,
    assessmentLanguage: doc.assessmentLanguage,
    state: doc.state,
    learnerFeedback: presentLearnerFeedback(doc.learnerFeedback),
    recognitionOverride: presentRecognitionOverride(doc.recognitionOverride),
    status: doc.status,
    statusVersion: doc.statusVersion,
    assessorId: idOf(doc.assessorId),
    proctorId: idOf(doc.proctorId),
    resultId: idOf(doc.resultId),
    rejectReason: doc.rejectReason ?? null,
    cancelReason: doc.cancelReason ?? null,
    isReassessment: doc.isReassessment,
    reassessmentOf: idOf(doc.reassessmentOf),
    firstAssessmentBatchId: idOf(doc.firstAssessmentBatchId),
    sla: {
      acceptDueAt: isoOrNull(doc.sla?.acceptDueAt),
      assignDueAt: isoOrNull(doc.sla?.assignDueAt),
      resultDueAt: isoOrNull(doc.sla?.resultDueAt),
      breached,
      lateActions: (doc.sla?.lateActions ?? []).map((row) => ({
        key: row.key,
        reason: row.reason,
        byUserId: idOf(row.byUserId),
        at: iso(row.at),
      })),
    },
    ratioOverride: ratio
      ? { byUserId: idOf(ratio.byUserId), reason: ratio.reason, at: iso(ratio.at) }
      : null,
    accommodations: [...(doc.accommodations ?? [])],
    allocatedAt: isoOrNull(doc.allocatedAt),
    acceptedAt: isoOrNull(doc.acceptedAt),
    assignedAt: isoOrNull(doc.assignedAt),
    cancelledAt: isoOrNull(doc.cancelledAt),
    createdAt: isoOrNull(doc.createdAt),
    updatedAt: isoOrNull(doc.updatedAt),
  };
}

async function loadBatchSources(input) {
  const [ab, qualification, tp, centre] = await Promise.all([
    AwardingBody.findById(input.abId).select("_id").lean(),
    Qualification.findById(input.qualificationId).select("sector ratioClass").lean(),
    TrainingPartner.findById(input.tpId).select("_id").lean(),
    Centre.findById(input.centreId).select("tpId state").lean(),
  ]);

  const details = {};
  if (!ab) details.abId = ["Does not exist"];
  if (!qualification) details.qualificationId = ["Does not exist"];
  else if (!qualification.sector || !qualification.ratioClass) {
    details.qualificationId = ["Qualification is missing sector or ratioClass"];
  }
  if (!tp) details.tpId = ["Does not exist"];
  if (!centre) details.centreId = ["Does not exist"];
  else if (String(centre.tpId) !== String(input.tpId)) {
    details.centreId = ["Centre does not belong to this training partner"];
  } else if (!centre.state) {
    details.centreId = ["Centre has no state"];
  }
  if (Object.keys(details).length > 0) {
    throw validationError("Unknown or inconsistent reference", details);
  }
  return {
    sector: qualification.sector,
    ratioClass: qualification.ratioClass,
    state: centre.state,
  };
}

function presentRecognitionOverride(value) {
  if (!value) return null;
  return {
    byUserId: idOf(value.byUserId),
    reason: value.reason,
    at: iso(value.at),
    checks: [...(value.checks ?? [])],
  };
}

function acceptIsLate(batch, now) {
  const due = batch.sla?.acceptDueAt;
  if (!due) return false;
  return now.getTime() > new Date(due).getTime();
}

/**
 * @returns {Promise<{ batch: object, stored: object }>}
 */
export async function createBatch(user, input, context = {}) {
  const now = context.now ?? new Date();
  assertCreator(user, input.abId);
  const copied = await loadBatchSources(input);
  const links = await resolveBatchLinks(input);
  const override = await recognitionDecision({
    sector: copied.sector,
    state: copied.state,
    now,
    user,
    overrideReason: input.recognitionOverrideReason,
  });
  const due = await slaDueAtCreation({
    type: input.type,
    assessmentStartDate: input.assessmentStartDate,
    assessmentEndDate: input.assessmentEndDate,
    allocatedAt: now,
  });

  const _id = new mongoose.Types.ObjectId();
  const created = await Batch.create({
    _id,
    abId: input.abId,
    qualificationId: input.qualificationId,
    type: input.type,
    mode: input.mode,
    assessmentStartDate: input.assessmentStartDate,
    assessmentEndDate: input.assessmentEndDate,
    tpId: input.tpId,
    centreId: input.centreId,
    schemeId: links.schemeId,
    projectId: links.projectId,
    candidateCount: input.candidateCount,
    sector: copied.sector,
    ratioClass: copied.ratioClass,
    assessmentLanguage: input.assessmentLanguage,
    state: copied.state,
    recognitionOverride: override,
    status: "allocated",
    statusVersion: 1,
    isReassessment: false,
    firstAssessmentBatchId: _id,
    sla: {
      acceptDueAt: due.acceptDueAt,
      assignDueAt: due.assignDueAt,
      resultDueAt: due.resultDueAt,
      breached: [],
      lateActions: [],
    },
    accommodations: [],
    allocatedAt: now,
  });
  if (override) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "recognition_override",
      entity: "batch",
      entityId: String(created._id),
      abId: created.abId,
      batchId: created._id,
      meta: { reason: override.reason, checks: [...override.checks] },
      ip: context.ip,
    });
  }

  const plain = created.toObject();
  return {
    batch: presentBatch(plain, { now, recompute: true }),
    stored: presentBatch(plain, { now, recompute: false }),
  };
}

export async function listBatches(user, query, now = new Date()) {
  const filter = await listFilter(user, query);
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    Batch.countDocuments(filter),
    Batch.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map((doc) => presentBatch(doc, { now })),
  };
}

/**
 * The stored batch, for child reads. Unknown id is 404; outside scope is 403.
 */
export async function loadReadableBatch(user, id) {
  const doc = await Batch.findById(id).lean();
  if (!doc) throw notFound();
  if (!(await canReadBatch(user, doc))) throw forbidden();
  return doc;
}

export async function getBatch(user, id, now = new Date()) {
  return presentBatch(await loadReadableBatch(user, id), { now });
}

/**
 * Compare-and-set one transition. The filter includes the current status and
 * statusVersion, so a second in-flight request cannot apply the same move.
 * @returns {Promise<{ before: object, batch: object, stored: object }>}
 */
export async function transitionBatch(user, id, action, body = {}, context = {}) {
  const now = context.now ?? new Date();
  assertReason(action, body.reason);
  if (!rolesForAction(action).includes(user?.role)) throw forbidden();

  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();

  const next = resolveTransition(user.role, existing.status, action);
  if (!next) throw invalidTransition();

  const late = ACCEPT_SLA_ACTIONS.has(action) && acceptIsLate(existing, now);
  const lateReason = typeof body.lateReason === "string" ? body.lateReason.trim() : "";
  if (late && !lateReason) throw slaAcceptExpired();

  const $set = { status: next.to };
  if (action === "accept") $set.acceptedAt = now;
  if (action === "reject") $set.rejectReason = body.reason;
  if (action === "cancel") {
    $set.cancelReason = body.reason;
    $set.cancelledAt = now;
  }

  const update = { $set, $inc: { statusVersion: 1 } };
  if (late) {
    update.$addToSet = { "sla.breached": "accept" };
    update.$push = {
      "sla.lateActions": {
        key: "accept",
        reason: lateReason,
        byUserId: user._id,
        at: now,
      },
    };
  }

  const casFilter = {
    _id: existing._id,
    status: existing.status,
    statusVersion: existing.statusVersion,
  };

  const updated =
    action === "cancel"
      ? await withTransaction(async (session) => {
          const cas = await Batch.findOneAndUpdate(casFilter, update, {
            new: true,
            runValidators: true,
            session,
          }).lean();
          if (!cas) return null;
          await releaseLocksForBatch(cas._id, session);
          return cas;
        })
      : await Batch.findOneAndUpdate(casFilter, update, {
          new: true,
          runValidators: true,
        }).lean();

  if (!updated) {
    const still = await Batch.exists({ _id: existing._id });
    if (!still) throw notFound();
    throw invalidTransition();
  }

  if (late) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: `sla_late_${action}`,
      entity: "batch",
      entityId: String(updated._id),
      abId: updated.abId,
      batchId: updated._id,
      meta: { reason: lateReason, key: "accept" },
      ip: context.ip,
    });
  }

  return {
    before: presentBatch(existing, { now, recompute: false }),
    batch: presentBatch(updated, { now, recompute: true }),
    stored: presentBatch(updated, { now, recompute: false }),
  };
}

export async function complianceDashboard(user, now = new Date()) {
  const scope = await readScope(user);
  const statusCounts = Object.fromEntries(BATCH_STATUSES.map((status) => [status, 0]));
  const grouped = await Batch.aggregate([
    { $match: scope },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  for (const row of grouped) {
    if (BATCH_STATUSES.includes(row._id)) statusCounts[row._id] = row.n;
  }

  const overdue = {};
  for (const step of OPEN_SLA_STEPS) {
    overdue[step.key] = await Batch.countDocuments({
      $and: [scope, overdueCondition(step, now)],
    });
  }
  return { statusCounts, overdue };
}
