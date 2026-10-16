import { Attempt } from "../../models/attempt.model.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { notFound } from "../../lib/errors.js";
import { isInBatchScope } from "../../middleware/scope.js";
import { buildMarksWorkbook } from "./marks-workbook.js";

/**
 * X-09. The marks of every candidate in a batch as an .xlsx. Roles are checked by the route; the
 * batch scope here (aa_admin all, ab_reviewer own awarding body, assessor own batches).
 * Returns the file and the ids of the candidates whose names are in it (for the access log).
 */
export async function marksExport(user, batchId) {
  const batch = await Batch.findById(batchId)
    .select("abId tpId assessorId proctorId qualificationId assessmentStartDate")
    .lean();
  if (!batch || !isInBatchScope(user, batch)) throw notFound();

  const [candidates, attempts] = await Promise.all([
    Candidate.find({ batchId }).select("name learnerId").sort({ name: 1 }).lean(),
    Attempt.find({ batchId }).select("-questions").lean(),
  ]);
  const attemptOf = new Map(attempts.map((a) => [String(a.candidateId), a]));
  const rows = candidates.map((c) => {
    const a = attemptOf.get(String(c._id));
    return {
      name: c.name,
      status: a ? a.status : "not_started",
      startedAt: a?.startedAt ?? null,
      closedAt: a?.closedAt ?? null,
      scores: a?.scores ?? null,
    };
  });
  const buffer = await buildMarksWorkbook({
    batchLabel: `batch ${String(batchId).slice(-6).toUpperCase()}`,
    rows,
  });
  return {
    buffer,
    learnerIds: candidates.map((c) => c.learnerId).filter(Boolean),
    count: rows.length,
    batch,
  };
}
