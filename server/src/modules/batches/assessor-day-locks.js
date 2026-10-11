import { AssessorDayLock } from "../../models/assessor-day-lock.model.js";
import { Batch } from "../../models/batch.model.js";
import { ruleAssessorClash } from "../../lib/errors.js";
import { civilDateRange, sameCentreLowCandidateWarning } from "./assign-rules.js";

function sessionOpt(session) {
  return session ? { session } : {};
}

function idsEqual(left, right) {
  return String(left) === String(right);
}

/**
 * Pull this batch off every lock. Delete the lock when no batch remains.
 * SCHEMA §3.9 cancel / reassign release.
 * @param {import("mongoose").Types.ObjectId|string} batchId
 * @param {import("mongoose").ClientSession|null} [session]
 */
export async function releaseLocksForBatch(batchId, session = null) {
  const opt = sessionOpt(session);
  const locks = await AssessorDayLock.find({ batchIds: batchId }, null, opt).lean();
  for (const lock of locks) {
    const remaining = lock.batchIds.filter((id) => !idsEqual(id, batchId));
    if (remaining.length === 0) {
      await AssessorDayLock.deleteOne({ _id: lock._id }, opt);
    } else {
      await AssessorDayLock.updateOne({ _id: lock._id }, { $set: { batchIds: remaining } }, opt);
    }
  }
}

/**
 * Insert or merge locks for each IST date in the batch window.
 * Same centre merges. Different centre → RULE_ASSESSOR_CLASH.
 * Returns non-blocking same-centre warnings (may be empty).
 * @param {{
 *   assessorId: import("mongoose").Types.ObjectId,
 *   batchId: import("mongoose").Types.ObjectId,
 *   centreId: import("mongoose").Types.ObjectId,
 *   start: string,
 *   end: string,
 *   candidateCount: number,
 * }} input
 * @param {import("mongoose").ClientSession|null} [session]
 */
export async function takeLocksForBatch(input, session = null) {
  const opt = sessionOpt(session);
  const dates = civilDateRange(input.start, input.end);
  const warningByOther = new Map();

  for (const istDate of dates) {
    const lock = await findOrCreateLock(
      {
        assessorId: input.assessorId,
        istDate,
        centreId: input.centreId,
        batchId: input.batchId,
      },
      session,
    );

    const others = lock.batchIds.filter((id) => !idsEqual(id, input.batchId));
    if (others.length === 0) continue;

    const otherBatches = await Batch.find(
      { _id: { $in: others } },
      { candidateCount: 1 },
      opt,
    ).lean();
    for (const other of otherBatches) {
      const warning = sameCentreLowCandidateWarning([input.candidateCount, other.candidateCount]);
      if (!warning) continue;
      const key = String(other._id);
      if (!warningByOther.has(key)) {
        warningByOther.set(key, {
          code: warning.code,
          message: warning.message,
          details: {
            threshold: warning.details.threshold,
            otherBatchId: key,
            istDates: [istDate],
            candidateCounts: {
              [String(input.batchId)]: input.candidateCount,
              [key]: other.candidateCount,
            },
          },
        });
      } else {
        const existing = warningByOther.get(key);
        if (!existing.details.istDates.includes(istDate)) {
          existing.details.istDates.push(istDate);
        }
      }
    }
  }

  return [...warningByOther.values()];
}

async function findOrCreateLock({ assessorId, istDate, centreId, batchId }, session) {
  const opt = sessionOpt(session);
  const existing = await AssessorDayLock.findOne({ assessorId, istDate }, null, opt);
  if (existing) {
    if (!idsEqual(existing.centreId, centreId)) throw ruleAssessorClash();
    if (!existing.batchIds.some((id) => idsEqual(id, batchId))) {
      await AssessorDayLock.updateOne(
        { _id: existing._id },
        { $addToSet: { batchIds: batchId } },
        opt,
      );
      existing.batchIds.push(batchId);
    }
    return existing;
  }

  try {
    const [created] = await AssessorDayLock.create(
      [{ assessorId, istDate, centreId, batchIds: [batchId] }],
      opt,
    );
    return created.toObject();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const raced = await AssessorDayLock.findOne({ assessorId, istDate }, null, opt);
    if (!raced) throw ruleAssessorClash();
    if (!idsEqual(raced.centreId, centreId)) throw ruleAssessorClash();
    await AssessorDayLock.updateOne({ _id: raced._id }, { $addToSet: { batchIds: batchId } }, opt);
    if (!raced.batchIds.some((id) => idsEqual(id, batchId))) {
      raced.batchIds.push(batchId);
    }
    return raced.toObject ? raced.toObject() : raced;
  }
}
