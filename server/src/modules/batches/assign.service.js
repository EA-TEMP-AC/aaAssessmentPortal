import {
  forbidden,
  invalidTransition,
  notFound,
  ruleAssessorClash,
  slaAssignExpired,
  validationError,
} from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { recordAudit } from "../../middleware/audit.middleware.js";
import { Assessor } from "../../models/assessor.model.js";
import { Batch } from "../../models/batch.model.js";
import { Proctor } from "../../models/proctor.model.js";
import { resolveTransition, rolesForAction } from "./batch-transitions.js";
import { presentBatch } from "./batch.service.js";
import {
  assertLanguageOrOverride,
  assertMaxAas,
  assertRatioOrOverride,
  assertToaValid,
} from "./assign-rules.js";
import { releaseLocksForBatch, takeLocksForBatch } from "./assessor-day-locks.js";

const LIVE_STATUSES = Object.freeze([
  "allocated",
  "accepted",
  "assessor_assigned",
  "in_progress",
  "assessment_completed",
  "result_submitted",
  "ab_validated",
  "published",
  "disputed",
]);

function assignIsLate(batch, now) {
  const due = batch.sla?.assignDueAt;
  if (!due) return false;
  return now.getTime() > new Date(due).getTime();
}

async function loadAssessor(assessorId) {
  const assessor = await Assessor.findById(assessorId).lean();
  if (!assessor) {
    throw validationError("Unknown or inactive assessor", { assessorId: ["Does not exist"] });
  }
  if (!assessor.active) {
    throw validationError("Unknown or inactive assessor", { assessorId: ["Assessor is inactive"] });
  }
  return assessor;
}

async function loadProctor(proctorId) {
  if (proctorId == null) return null;
  const proctor = await Proctor.findById(proctorId).lean();
  if (!proctor) {
    throw validationError("Unknown or inactive proctor", { proctorId: ["Does not exist"] });
  }
  if (!proctor.active) {
    throw validationError("Unknown or inactive proctor", { proctorId: ["Proctor is inactive"] });
  }
  return proctor;
}

async function isAlreadyLinked(assessorId, exceptBatchId) {
  const filter = {
    assessorId,
    status: { $in: LIVE_STATUSES },
  };
  if (exceptBatchId) filter._id = { $ne: exceptBatchId };
  return Boolean(await Batch.exists(filter));
}

/**
 * Shared assign / reassign checks. Soft SLA matches B-03 accept.
 * @returns {Promise<{
 *   assessor: object,
 *   proctorId: import("mongoose").Types.ObjectId|null,
 *   late: boolean,
 *   lateReason: string,
 *   ratioOverride: object|null,
 *   languageOverrideReason: string|null,
 * }>}
 */
export async function evaluateAssignment(user, batch, body, now) {
  const late = assignIsLate(batch, now);
  const lateReason = typeof body.lateReason === "string" ? body.lateReason.trim() : "";
  if (late && !lateReason) throw slaAssignExpired();

  const assessor = await loadAssessor(body.assessorId);
  const proctor = await loadProctor(body.proctorId ?? null);

  assertToaValid(assessor.toa, batch.assessmentStartDate, batch.assessmentEndDate);
  assertMaxAas(assessor, await isAlreadyLinked(assessor._id, batch._id));

  const ratioOverride = assertRatioOrOverride({
    ratioClass: batch.ratioClass,
    candidateCount: batch.candidateCount,
    user,
    overrideReason: body.ratioOverrideReason,
    now,
  });

  const languageOverrideReason = assertLanguageOrOverride({
    languages: assessor.languages,
    assessmentLanguage: batch.assessmentLanguage,
    user,
    overrideReason: body.languageOverrideReason,
  });

  return {
    assessor,
    proctorId: proctor?._id ?? null,
    late,
    lateReason,
    ratioOverride,
    languageOverrideReason,
  };
}

/**
 * Retry a duplicate-key abort so two same-centre assigns can merge
 * after the first transaction commits. A remaining 11000 is a clash.
 */
async function withAssignmentTransaction(work) {
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTransaction(work);
    } catch (err) {
      lastError = err;
      if (err?.code === 11000 && attempt < maxAttempts) continue;
      if (err?.code === 11000) throw ruleAssessorClash();
      throw err;
    }
  }
  throw lastError;
}

async function writeAssignmentAudits({
  user,
  batch,
  late,
  lateReason,
  ratioOverride,
  languageOverrideReason,
  warnings,
  ip,
}) {
  if (late) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "sla_late_assign",
      entity: "batch",
      entityId: String(batch._id),
      abId: batch.abId,
      batchId: batch._id,
      meta: { reason: lateReason, key: "assign" },
      ip,
    });
  }
  if (ratioOverride) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "ratio_override",
      entity: "batch",
      entityId: String(batch._id),
      abId: batch.abId,
      batchId: batch._id,
      meta: { reason: ratioOverride.reason },
      ip,
    });
  }
  if (languageOverrideReason) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "assessor_language_override",
      entity: "batch",
      entityId: String(batch._id),
      abId: batch.abId,
      batchId: batch._id,
      meta: { reason: languageOverrideReason },
      ip,
    });
  }
  for (const warning of warnings) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "assessor_same_centre_warning",
      entity: "batch",
      entityId: String(batch._id),
      abId: batch.abId,
      batchId: batch._id,
      meta: warning,
      ip,
    });
  }
}

function presentAssigned(existing, updated, now, warnings) {
  const batch = presentBatch(updated, { now, recompute: true });
  if (warnings.length > 0) batch.warnings = warnings;
  return {
    before: presentBatch(existing, { now, recompute: false }),
    batch,
    stored: presentBatch(updated, { now, recompute: false }),
  };
}

/**
 * accepted → assessor_assigned. Transaction: CAS + take locks.
 */
export async function assignAssessor(user, id, body, context = {}) {
  const now = context.now ?? new Date();
  if (!rolesForAction("assign").includes(user?.role)) throw forbidden();

  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();

  const next = resolveTransition(user.role, existing.status, "assign");
  if (!next) throw invalidTransition();

  const evaled = await evaluateAssignment(user, existing, body, now);

  const updated = await withAssignmentTransaction(async (session) => {
    const $set = {
      status: next.to,
      assessorId: evaled.assessor._id,
      proctorId: evaled.proctorId,
      assignedAt: now,
    };
    if (evaled.ratioOverride) $set.ratioOverride = evaled.ratioOverride;

    const update = { $set, $inc: { statusVersion: 1 } };
    if (evaled.late) {
      update.$addToSet = { "sla.breached": "assign" };
      update.$push = {
        "sla.lateActions": {
          key: "assign",
          reason: evaled.lateReason,
          byUserId: user._id,
          at: now,
        },
      };
    }

    const cas = await Batch.findOneAndUpdate(
      { _id: existing._id, status: existing.status, statusVersion: existing.statusVersion },
      update,
      { new: true, runValidators: true, session },
    ).lean();
    if (!cas) throw invalidTransition();

    const warnings = await takeLocksForBatch(
      {
        assessorId: evaled.assessor._id,
        batchId: cas._id,
        centreId: cas.centreId,
        start: cas.assessmentStartDate,
        end: cas.assessmentEndDate,
        candidateCount: cas.candidateCount,
      },
      session,
    );
    return { cas, warnings };
  });

  await writeAssignmentAudits({
    user,
    batch: updated.cas,
    late: evaled.late,
    lateReason: evaled.lateReason,
    ratioOverride: evaled.ratioOverride,
    languageOverrideReason: evaled.languageOverrideReason,
    warnings: updated.warnings,
    ip: context.ip,
  });

  return presentAssigned(existing, updated.cas, now, updated.warnings);
}

/**
 * assessor_assigned → assessor_assigned. Release old locks, take new locks.
 */
export async function reassignAssessor(user, id, body, context = {}) {
  const now = context.now ?? new Date();
  if (!rolesForAction("reassign").includes(user?.role)) throw forbidden();

  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();

  const next = resolveTransition(user.role, existing.status, "reassign");
  if (!next) throw invalidTransition();

  const evaled = await evaluateAssignment(user, existing, body, now);

  const updated = await withAssignmentTransaction(async (session) => {
    const $set = {
      status: next.to,
      assessorId: evaled.assessor._id,
      proctorId: evaled.proctorId,
      assignedAt: now,
    };
    if (evaled.ratioOverride) $set.ratioOverride = evaled.ratioOverride;

    const update = { $set, $inc: { statusVersion: 1 } };
    if (evaled.late) {
      update.$addToSet = { "sla.breached": "assign" };
      update.$push = {
        "sla.lateActions": {
          key: "assign",
          reason: evaled.lateReason,
          byUserId: user._id,
          at: now,
        },
      };
    }

    const cas = await Batch.findOneAndUpdate(
      { _id: existing._id, status: existing.status, statusVersion: existing.statusVersion },
      update,
      { new: true, runValidators: true, session },
    ).lean();
    if (!cas) throw invalidTransition();

    await releaseLocksForBatch(cas._id, session);
    const warnings = await takeLocksForBatch(
      {
        assessorId: evaled.assessor._id,
        batchId: cas._id,
        centreId: cas.centreId,
        start: cas.assessmentStartDate,
        end: cas.assessmentEndDate,
        candidateCount: cas.candidateCount,
      },
      session,
    );
    return { cas, warnings };
  });

  await writeAssignmentAudits({
    user,
    batch: updated.cas,
    late: evaled.late,
    lateReason: evaled.lateReason,
    ratioOverride: evaled.ratioOverride,
    languageOverrideReason: evaled.languageOverrideReason,
    warnings: updated.warnings,
    ip: context.ip,
  });

  return presentAssigned(existing, updated.cas, now, updated.warnings);
}
