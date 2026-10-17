import {
  AppError,
  duplicateResource,
  forbidden,
  invalidTransition,
  notFound,
  validationError,
} from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { recordAudit } from "../../middleware/audit.middleware.js";
import { isInBatchScope } from "../../middleware/scope.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { Learner } from "../../models/learner.model.js";
import { assertRatioOrOverride } from "../batches/assign-rules.js";
import { createCandidateLogin } from "./candidate-login.service.js";
import { learnerIsOnBatch } from "./candidate-scope.js";
import { rosterFromCsv } from "./candidate-csv.js";

/** Roster writes are allowed before assessment starts. SCHEMA has no named list. */
export const CANDIDATE_ROSTER_OPEN_STATUSES = Object.freeze([
  "allocated",
  "accepted",
  "assessor_assigned",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function iso(value) {
  return new Date(value).toISOString();
}

function idOf(value) {
  if (value == null || value === "") return null;
  return value.toString();
}

export function presentCandidate(doc) {
  return {
    id: idOf(doc._id),
    batchId: idOf(doc.batchId),
    learnerId: idOf(doc.learnerId),
    name: doc.name,
    externalRef: doc.externalRef ?? null,
    accommodations: [...(doc.accommodations ?? [])],
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function assertRosterOpen(batch) {
  if (!CANDIDATE_ROSTER_OPEN_STATUSES.includes(batch.status)) {
    throw invalidTransition("Candidates can only be changed before assessment starts");
  }
}

async function canReadCandidates(user, batch) {
  if (user?.role === "candidate") {
    return learnerIsOnBatch(user.linkedProfileId, batch._id);
  }
  return isInBatchScope(user, batch);
}

async function loadBatch(id) {
  const batch = await Batch.findById(id).lean();
  if (!batch) throw notFound();
  return batch;
}

function applyRatioIfNeeded(user, batch, candidateCount, overrideReason, now) {
  if (!batch.assessorId) return null;
  return assertRatioOrOverride({
    ratioClass: batch.ratioClass,
    candidateCount,
    user,
    overrideReason,
    now,
  });
}

async function resolveLearner(body, session) {
  if (body.learnerId) {
    const learner = await Learner.findById(body.learnerId).session(session).lean();
    if (!learner) {
      throw validationError("Unknown learner", { learnerId: ["Does not exist"] });
    }
    return learner;
  }

  const existing = await Learner.findOne({ externalRef: body.externalRef }).session(session).lean();
  if (existing) return existing;

  try {
    const created = await Learner.create(
      [
        {
          name: body.name,
          externalRef: body.externalRef,
          accommodations: [],
          active: true,
        },
      ],
      { session },
    );
    return created[0].toObject();
  } catch (err) {
    if (err?.code === 11000) {
      const raced = await Learner.findOne({ externalRef: body.externalRef })
        .session(session)
        .lean();
      if (raced) return raced;
      throw duplicateResource("A learner with this externalRef already exists");
    }
    throw err;
  }
}

async function syncCandidateCount(batch, session, extraSet = {}) {
  const activeCount = await Candidate.countDocuments({
    batchId: batch._id,
    active: true,
  }).session(session);
  await Batch.updateOne(
    { _id: batch._id },
    { $set: { candidateCount: activeCount, ...extraSet } },
    { session, runValidators: true },
  );
  return activeCount;
}

/**
 * @returns {Promise<{ candidate: object, stored: object, ratioOverride: object|null, abId: string|null }>}
 */
export async function addCandidate(user, batchId, body, context = {}) {
  const now = context.now ?? new Date();
  const batch = await loadBatch(batchId);
  assertRosterOpen(batch);

  try {
    const saved = await withTransaction(async (session) => {
      const learner = await resolveLearner(body, session);
      const already = await Candidate.findOne({
        batchId: batch._id,
        learnerId: learner._id,
      })
        .session(session)
        .lean();
      if (already) throw duplicateResource("Learner is already on this batch");

      const created = await Candidate.create(
        [
          {
            batchId: batch._id,
            learnerId: learner._id,
            name: learner.name,
            externalRef: learner.externalRef,
            accommodations: body.accommodations ?? learner.accommodations ?? [],
            active: true,
          },
        ],
        { session },
      );
      const doc = created[0].toObject();
      const activeCount = await Candidate.countDocuments({
        batchId: batch._id,
        active: true,
      }).session(session);
      const ratioOverride = applyRatioIfNeeded(
        user,
        batch,
        activeCount,
        body.ratioOverrideReason,
        now,
      );
      const extraSet = ratioOverride ? { ratioOverride } : {};
      await Batch.updateOne(
        { _id: batch._id },
        { $set: { candidateCount: activeCount, ...extraSet } },
        { session, runValidators: true },
      );
      const presented = presentCandidate(doc);
      return {
        candidate: presented,
        stored: presented,
        ratioOverride,
        abId: idOf(batch.abId),
        learner,
      };
    });
    // X-35: the login is made after the roster row is saved; a problem there never undoes the row.
    const { learner, ...result } = saved;
    if (body.email) result.login = await createCandidateLogin({ learner, email: body.email });
    return result;
  } catch (err) {
    if (err?.code === 11000) throw duplicateResource("Learner is already on this batch");
    throw err;
  }
}

/**
 * List roster rows. Existing batch outside scope is 403; unknown id is 404.
 */
export async function getCandidates(user, batchId, query = {}) {
  const batch = await loadBatch(batchId);
  if (!(await canReadCandidates(user, batch))) throw forbidden();

  const filter = { batchId: batch._id };
  if (user?.role === "candidate") {
    if (!user.linkedProfileId) return { items: [] };
    filter.learnerId = user.linkedProfileId;
  }
  if (query.active !== undefined) filter.active = query.active;

  const docs = await Candidate.find(filter).sort({ createdAt: 1, _id: 1 }).lean();
  return { items: docs.map(presentCandidate) };
}

/**
 * @returns {Promise<{ before: object, candidate: object, stored: object, ratioOverride: object|null, abId: string|null }>}
 */
export async function patchCandidate(user, batchId, candidateId, body, context = {}) {
  const now = context.now ?? new Date();
  const batch = await loadBatch(batchId);
  assertRosterOpen(batch);

  return withTransaction(async (session) => {
    const existing = await Candidate.findOne({ _id: candidateId, batchId: batch._id })
      .session(session)
      .lean();
    if (!existing) throw notFound();

    const $set = {};
    if (body.accommodations !== undefined) $set.accommodations = body.accommodations;
    if (body.active !== undefined) $set.active = body.active;

    const updated = await Candidate.findOneAndUpdate(
      { _id: existing._id, batchId: batch._id },
      { $set },
      { new: true, session, runValidators: true },
    ).lean();

    const extraSet = {};
    let ratioOverride = null;
    if (body.active === true && existing.active === false) {
      const nextCount = await Candidate.countDocuments({
        batchId: batch._id,
        active: true,
      }).session(session);
      ratioOverride = applyRatioIfNeeded(user, batch, nextCount, body.ratioOverrideReason, now);
      if (ratioOverride) extraSet.ratioOverride = ratioOverride;
    }
    await syncCandidateCount(batch, session, extraSet);
    const presented = presentCandidate(updated);
    return {
      before: presentCandidate(existing),
      candidate: presented,
      stored: presented,
      ratioOverride,
      abId: idOf(batch.abId),
    };
  });
}

/**
 * @returns {Promise<{ created: number, skipped: number, errors: { row: number, reason: string }[], ratioOverride: object|null, abId: string|null }>}
 */
export async function importCandidates(user, batchId, csvText, extras = {}, context = {}) {
  const batch = await loadBatch(batchId);
  assertRosterOpen(batch);
  const rows = rosterFromCsv(csvText);

  let created = 0;
  let skipped = 0;
  const logins = { created: 0, existing: 0, failed: 0 };
  const errors = [];
  let ratioOverride = null;

  for (const row of rows) {
    if (!row.name || !row.externalRef) {
      errors.push({ row: row.rowNumber, reason: "name and externalRef are required" });
      continue;
    }
    if (row.email && !EMAIL_PATTERN.test(row.email)) {
      errors.push({ row: row.rowNumber, reason: "email is not valid" });
      continue;
    }
    try {
      const saved = await addCandidate(
        user,
        batchId,
        {
          name: row.name,
          externalRef: row.externalRef,
          ...(row.email ? { email: row.email.toLowerCase() } : {}),
          ratioOverrideReason: extras.ratioOverrideReason,
        },
        context,
      );
      created += 1;
      if (saved.login) {
        if (saved.login.status === "created") logins.created += 1;
        else if (saved.login.status === "failed") logins.failed += 1;
        else logins.existing += 1;
      }
      if (saved.ratioOverride) ratioOverride = saved.ratioOverride;
    } catch (err) {
      if (err instanceof AppError && err.code === "DUPLICATE_RESOURCE") {
        skipped += 1;
        continue;
      }
      if (err instanceof AppError) {
        errors.push({ row: row.rowNumber, reason: err.message });
        continue;
      }
      throw err;
    }
  }

  return {
    created,
    skipped,
    errors,
    ratioOverride,
    abId: idOf(batch.abId),
    ...(rows.some((r) => r.email) ? { logins } : {}),
  };
}

export async function writeRatioOverrideAudit(user, batchId, ratioOverride, ip) {
  if (!ratioOverride) return;
  const batch = await Batch.findById(batchId).lean();
  if (!batch) return;
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
