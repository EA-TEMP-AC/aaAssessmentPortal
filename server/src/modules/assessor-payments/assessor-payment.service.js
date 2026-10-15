import { forbidden, invalidTransition, notFound, validationError } from "../../lib/errors.js";
import { AssessorPayment } from "../../models/assessor-payment.model.js";
import { Batch } from "../../models/batch.model.js";

function idOf(value) {
  return value == null ? null : value.toString();
}

/** Whole paise, so differences stay exact. */
function paise(rupees) {
  return Math.round(rupees * 100);
}

export function presentPayment(doc) {
  return {
    id: idOf(doc._id),
    batchId: idOf(doc.batchId),
    assessorId: idOf(doc.assessorId),
    amountDue: doc.amountDue,
    amountPaid: doc.amountPaid,
    pending: doc.pending,
    logisticsNote: doc.logisticsNote ?? null,
    updatedBy: idOf(doc.updatedBy),
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

/**
 * Writes the row for the batch's assigned assessor. `body.assessorId` may name
 * that assessor, or a previous one who already has a row on this batch.
 * @returns {Promise<{ before: object|null, payment: object, abId: unknown }>}
 */
export async function savePayment(user, batchId, body) {
  const batch = await Batch.findById(batchId).select("abId assessorId").lean();
  if (!batch) throw notFound();
  if (!batch.assessorId) {
    throw invalidTransition("The batch has no assigned assessor");
  }

  let assessorId = batch.assessorId;
  if (body.assessorId && body.assessorId !== String(batch.assessorId)) {
    const previous = await AssessorPayment.exists({
      batchId: batch._id,
      assessorId: body.assessorId,
    });
    if (!previous) {
      throw validationError("assessorId is not an assessor of this batch", {
        assessorId: ["Not the assigned assessor and has no payment row on this batch"],
      });
    }
    assessorId = body.assessorId;
  }

  const key = { batchId: batch._id, assessorId };
  const $set = {
    amountDue: body.amountDue,
    amountPaid: body.amountPaid,
    pending: (paise(body.amountDue) - paise(body.amountPaid)) / 100,
    logisticsNote: body.logisticsNote ? body.logisticsNote : null,
    updatedBy: user._id,
  };
  const options = { upsert: true, new: false, runValidators: true, setDefaultsOnInsert: true };

  let before;
  try {
    before = await AssessorPayment.findOneAndUpdate(key, { $set }, options).lean();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    before = await AssessorPayment.findOneAndUpdate(key, { $set }, options).lean();
  }
  const saved = await AssessorPayment.findOne(key).lean();
  return {
    before: before ? presentPayment(before) : null,
    payment: presentPayment(saved),
    abId: batch.abId,
  };
}

/**
 * Paged list. An assessor sees only rows with their own assessor id.
 * `batchId` limits the list to one batch (unknown batch is 404).
 */
export async function listPayments(user, query, { batchId } = {}) {
  if (batchId) {
    const batch = await Batch.findById(batchId).select("abId").lean();
    if (!batch) throw notFound();
    if (user?.role === "ab_reviewer" && String(batch.abId) !== String(user.abId)) {
      throw forbidden();
    }
  }

  const filter = {};
  if (batchId) filter.batchId = batchId;
  if (user?.role === "ab_reviewer" && !batchId) {
    if (!user.abId) throw forbidden();
    const own = await Batch.find({ abId: user.abId }).select("_id").lean();
    filter.batchId = { $in: own.map((row) => row._id) };
  }
  if (user?.role === "assessor") {
    if (!user.linkedProfileId) throw forbidden();
    if (query.assessorId && query.assessorId !== String(user.linkedProfileId)) {
      return { page: query.page, pageSize: query.pageSize, total: 0, items: [] };
    }
    filter.assessorId = user.linkedProfileId;
  } else if (query.assessorId) {
    filter.assessorId = query.assessorId;
  }
  if (query.pendingOnly === "true") filter.pending = { $gt: 0 };

  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    AssessorPayment.countDocuments(filter),
    AssessorPayment.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(skip)
      .limit(query.pageSize)
      .lean(),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map(presentPayment),
  };
}
