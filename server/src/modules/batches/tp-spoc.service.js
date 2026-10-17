import { forbidden, notFound } from "../../lib/errors.js";
import { isInBatchScope } from "../../middleware/scope.js";
import { Batch } from "../../models/batch.model.js";
import { presentBatch } from "./batch.service.js";

/**
 * PUT /batches/:id/tp-spoc. X-29. Sets the training partner's contact person for one batch.
 * The name and number are personal data, so the audit row only says whether one is set.
 * @returns {Promise<{ batch: object, abId: object, before: object, after: object }>}
 */
export async function saveTpSpoc(user, id, body, context = {}) {
  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();
  if (!isInBatchScope(user, existing)) throw forbidden();
  const updated = await Batch.findOneAndUpdate(
    { _id: existing._id },
    { $set: { tpSpoc: { name: body.name, contact: body.contact ?? null } } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw notFound();
  return {
    abId: updated.abId,
    batch: presentBatch(updated, { now: context.now ?? new Date() }),
    before: { tpSpocSet: existing.tpSpoc != null },
    after: { tpSpocSet: true, hasContactNumber: updated.tpSpoc.contact != null },
  };
}
