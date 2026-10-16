import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { sameLanguage } from "../../lib/language.js";
import { Attempt } from "../../models/attempt.model.js";
import { Batch } from "../../models/batch.model.js";
import { TestPaper } from "../../models/test-paper.model.js";
import { presentBatch } from "./batch.service.js";

const idOf = (value) => (value == null ? null : value.toString());

function lockedError() {
  return new AppError(
    409,
    "BATCH_TEST_PAPER_LOCKED",
    "The test paper cannot be changed after a candidate has started an attempt on this batch",
  );
}

/**
 * D5: aa_admin sets the one test paper of a batch. The paper must be approved and complete, be
 * for the batch's qualification, and be in the batch's assessment language. Setting or changing
 * it is refused once any attempt exists on the batch. The attempt check runs before and after
 * the write, so an attempt that starts in between undoes the change.
 */
export async function setBatchTestPaper(user, id, { testPaperId }) {
  if (user.role !== "aa_admin") throw forbidden();
  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();
  if (await Attempt.exists({ batchId: existing._id })) throw lockedError();

  const paper = await TestPaper.findById(testPaperId).select("-items").lean();
  if (!paper) throw notFound("Test paper not found");
  if (paper.status !== "approved" || paper.complete !== true) {
    throw new AppError(
      409,
      "BATCH_TEST_PAPER_NOT_APPROVED",
      "Only an approved, complete test paper can be set on a batch",
    );
  }
  if (idOf(paper.qualificationId) !== idOf(existing.qualificationId)) {
    throw new AppError(
      400,
      "BATCH_TEST_PAPER_QUALIFICATION_MISMATCH",
      "The test paper is for a different qualification than the batch",
    );
  }
  if (!sameLanguage(paper.rules?.language, existing.assessmentLanguage)) {
    throw new AppError(
      409,
      "BATCH_TEST_PAPER_LANGUAGE_MISMATCH",
      "The test paper language differs from the batch assessment language",
    );
  }

  const updated = await Batch.findOneAndUpdate(
    { _id: existing._id, testPaperId: existing.testPaperId ?? null },
    { $set: { testPaperId: paper._id } },
    { new: true },
  ).lean();
  if (!updated) {
    throw new AppError(409, "CONFLICT", "The batch changed while setting the paper; try again");
  }
  if (await Attempt.exists({ batchId: existing._id })) {
    const restore = existing.testPaperId
      ? { $set: { testPaperId: existing.testPaperId } }
      : { $unset: { testPaperId: "" } };
    await Batch.updateOne({ _id: existing._id }, restore);
    throw lockedError();
  }
  return {
    batch: presentBatch(updated),
    before: { testPaperId: idOf(existing.testPaperId) },
    after: { testPaperId: idOf(updated.testPaperId) },
    abId: updated.abId,
  };
}
