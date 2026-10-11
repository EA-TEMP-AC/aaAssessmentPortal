import { Candidate } from "../../models/candidate.model.js";

/**
 * Batch ids whose roster contains this learner (active or deactivated).
 * SCHEMA §5 / open question 70: a candidate user reads those batches only.
 */
export async function findBatchIdsForLearner(learnerId) {
  if (learnerId == null || learnerId === "") return [];
  const rows = await Candidate.find({ learnerId }).select("batchId").lean();
  return rows.map((row) => row.batchId);
}

export async function learnerIsOnBatch(learnerId, batchId) {
  if (learnerId == null || learnerId === "" || batchId == null) return false;
  return Boolean(await Candidate.exists({ learnerId, batchId }));
}
