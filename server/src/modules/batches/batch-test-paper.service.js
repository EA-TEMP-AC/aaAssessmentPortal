import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { sameLanguage } from "../../lib/language.js";
import { Attempt } from "../../models/attempt.model.js";
import { Batch } from "../../models/batch.model.js";
import { TestPaper } from "../../models/test-paper.model.js";
import { resolveBatchSettings } from "../../config/batch-settings.js";
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
  // X-19: a batch set up for a mock test can use any complete paper without the reviewer's approval.
  const skipApproval = resolveBatchSettings(existing.settings).skipPaperApproval === true;
  if ((paper.status !== "approved" && !skipApproval) || paper.complete !== true) {
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

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

/**
 * X-33: aa_admin sets one extra paper per extra language (the batch's own paper stays the one in
 * its assessment language). Needs the batch's theory-languages switch. Each paper must be
 * approved (or the batch is a mock test), complete, for the batch's qualification, and written in
 * the language it is listed under. Refused once any attempt exists. The list replaces the old one.
 */
export async function setBatchLanguagePapers(user, id, { papers }) {
  if (user.role !== "aa_admin") throw forbidden();
  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();
  if (await Attempt.exists({ batchId: existing._id })) throw lockedError();

  const settings = resolveBatchSettings(existing.settings);
  if (papers.length > 0 && settings.languages.theory !== true) {
    throw new AppError(
      409,
      "BATCH_FEATURE_OFF",
      "Turn on the theory languages switch in the batch settings first",
    );
  }
  const languages = new Set();
  const paperIds = new Set();
  for (const entry of papers) {
    if (norm(entry.language) === norm(existing.assessmentLanguage)) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "The batch's own language is covered by its main paper",
        { papers: [`${entry.language} is the assessment language of this batch`] },
      );
    }
    if (languages.has(norm(entry.language)) || paperIds.has(entry.testPaperId)) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Each language and each paper can be listed once",
        {
          papers: ["Each language and each paper can be listed once"],
        },
      );
    }
    languages.add(norm(entry.language));
    paperIds.add(entry.testPaperId);
  }
  if (paperIds.has(idOf(existing.testPaperId))) {
    throw new AppError(400, "VALIDATION_ERROR", "The main paper cannot also be a language paper", {
      papers: ["The main paper cannot also be a language paper"],
    });
  }

  const found = await TestPaper.find({ _id: { $in: [...paperIds] } })
    .select("-items")
    .lean();
  const byId = new Map(found.map((p) => [idOf(p._id), p]));
  for (const entry of papers) {
    const paper = byId.get(entry.testPaperId);
    if (!paper) throw notFound("Test paper not found");
    if ((paper.status !== "approved" && !settings.skipPaperApproval) || paper.complete !== true) {
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
    if (!sameLanguage(paper.rules?.language, entry.language)) {
      throw new AppError(
        409,
        "BATCH_TEST_PAPER_LANGUAGE_MISMATCH",
        "The test paper language differs from the language it is listed under",
      );
    }
  }

  const next = papers.map((p) => ({ language: p.language, testPaperId: p.testPaperId }));
  const updated = await Batch.findOneAndUpdate(
    { _id: existing._id },
    { $set: { languagePapers: next } },
    { new: true },
  ).lean();
  if (!updated) throw notFound();
  if (await Attempt.exists({ batchId: existing._id })) {
    await Batch.updateOne(
      { _id: existing._id },
      { $set: { languagePapers: existing.languagePapers ?? [] } },
    );
    throw lockedError();
  }
  const shape = (list) =>
    (list ?? []).map((p) => ({ language: p.language, testPaperId: idOf(p.testPaperId) }));
  return {
    batch: presentBatch(updated),
    before: { languagePapers: shape(existing.languagePapers) },
    after: { languagePapers: shape(updated.languagePapers) },
    abId: updated.abId,
  };
}
