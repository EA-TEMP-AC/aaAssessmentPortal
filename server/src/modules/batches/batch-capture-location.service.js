import { notFound } from "../../lib/errors.js";
import { Batch } from "../../models/batch.model.js";
import { presentBatch } from "./batch.service.js";

/**
 * X-07: aa_admin turns location on flag photos on or off for a batch. Turning it off stops new
 * coordinates from being kept; coordinates already saved stay with their flags.
 */
export async function setBatchCaptureLocation(id, { captureLocation }) {
  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();
  const updated = await Batch.findOneAndUpdate(
    { _id: existing._id },
    { $set: { captureLocation } },
    { new: true },
  ).lean();
  return {
    batch: presentBatch(updated),
    before: { captureLocation: existing.captureLocation === true },
    after: { captureLocation: updated.captureLocation === true },
    abId: updated.abId,
  };
}
