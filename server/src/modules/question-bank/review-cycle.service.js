import mongoose from "mongoose";
import { compliance } from "../../config/compliance.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { isCalendarDate, istCalendarDate } from "../../lib/working-days.js";
import { AwardingBody } from "../../models/awarding-body.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { Question } from "../../models/question.model.js";
import { ReviewCycle } from "../../models/review-cycle.model.js";
import { ReviewSetting } from "../../models/review-setting.model.js";
import { User } from "../../models/user.model.js";
import { retireQuestion, updateQuestion } from "./question-bank.service.js";
import { MAX_CYCLE_QUESTIONS } from "./review-cycle.schemas.js";
import { computeReviewDue } from "./review-due.service.js";

const oid = (value) => new mongoose.Types.ObjectId(String(value));

function counts(cycle) {
  const total = cycle.items.length;
  const tally = { keep: 0, revise: 0, retire: 0 };
  for (const item of cycle.items) if (item.decision) tally[item.decision] += 1;
  const decided = tally.keep + tally.revise + tally.retire;
  return { total, decided, undecided: total - decided, ...tally };
}

/** Cycle without items. Ids, dates and counts only. */
export function cycleSummary(cycle, now = new Date()) {
  return {
    id: String(cycle._id),
    qualificationId: String(cycle.qualificationId),
    abId: String(cycle.abId),
    reviewerId: String(cycle.reviewerId),
    dueDate: cycle.dueDate,
    status: cycle.status,
    overdue: cycle.status === "open" && cycle.dueDate < istCalendarDate(now),
    counts: counts(cycle),
    incomplete: cycle.incomplete,
    createdBy: String(cycle.createdBy),
    createdAt: cycle.createdAt,
    closedBy: cycle.closedBy ? String(cycle.closedBy) : null,
    closedAt: cycle.closedAt,
  };
}

/** Full cycle. Items carry the reviewer comment, so this is for the API response only, never audit. */
export function cycleDetail(cycle, now = new Date()) {
  return {
    ...cycleSummary(cycle, now),
    items: cycle.items.map((item) => ({
      questionId: String(item.questionId),
      rootQuestionId: String(item.rootQuestionId),
      decision: item.decision,
      comment: item.comment,
      decidedBy: item.decidedBy ? String(item.decidedBy) : null,
      decidedAt: item.decidedAt,
      resultQuestionId: item.resultQuestionId ? String(item.resultQuestionId) : null,
    })),
  };
}

/** ab_reviewer sees only cycles of their own awarding body; others look as if they do not exist. */
function assertInScope(user, cycle) {
  if (user.role !== "ab_reviewer") return;
  if (!user.abId || String(user.abId) !== String(cycle.abId)) {
    throw notFound("Review cycle not found");
  }
}

async function loadCycle(user, id) {
  const cycle = await ReviewCycle.findById(id);
  if (!cycle) throw notFound("Review cycle not found");
  assertInScope(user, cycle);
  return cycle;
}

export async function createCycle(user, body) {
  const qualification = await Qualification.findById(body.qualificationId).select("_id").lean();
  if (!qualification) {
    throw new AppError(404, "QUALIFICATION_NOT_FOUND", "Qualification not found");
  }
  const ab = await AwardingBody.findById(body.abId).select("active").lean();
  if (!ab || !ab.active) {
    throw new AppError(404, "AWARDING_BODY_NOT_FOUND", "Awarding body not found");
  }

  const reviewer = await User.findOne({ _id: body.reviewerId, role: "ab_reviewer", active: true })
    .select("abId")
    .lean();
  if (!reviewer || String(reviewer.abId ?? "") !== body.abId) {
    throw validationError("reviewerId must be an active ab_reviewer of this awarding body", {
      reviewerId: ["Not an active reviewer of this awarding body"],
    });
  }

  if (!isCalendarDate(body.dueDate) || body.dueDate < istCalendarDate(new Date())) {
    throw validationError("dueDate must be a real date, today or later (IST)", {
      dueDate: ["Must be a real date, today or later"],
    });
  }

  const filter = { qualificationId: oid(body.qualificationId), status: "approved", isLatest: true };
  let questions;
  if (body.questionIds) {
    const wanted = [...new Set(body.questionIds)];
    if (wanted.length !== body.questionIds.length) {
      throw validationError("questionIds contains duplicates");
    }
    questions = await Question.find({ ...filter, _id: { $in: wanted.map(oid) } })
      .select("_id rootQuestionId")
      .lean();
    if (questions.length !== wanted.length) {
      const found = new Set(questions.map((q) => String(q._id)));
      throw new AppError(
        400,
        "INVALID_QUESTIONS",
        "Every question must be an approved, latest question of the qualification",
        { invalidQuestionIds: wanted.filter((id) => !found.has(id)) },
      );
    }
  } else {
    questions = await Question.find(filter)
      .select("_id rootQuestionId")
      .limit(MAX_CYCLE_QUESTIONS + 1)
      .lean();
    if (questions.length > MAX_CYCLE_QUESTIONS) {
      throw validationError(`More than ${MAX_CYCLE_QUESTIONS} questions; send questionIds`, {
        questionIds: ["Too many questions to take all; list them"],
      });
    }
  }
  if (questions.length === 0) {
    throw new AppError(
      409,
      "NO_QUESTIONS_TO_REVIEW",
      "The qualification has no approved questions",
    );
  }

  try {
    return await ReviewCycle.create({
      qualificationId: body.qualificationId,
      abId: body.abId,
      reviewerId: body.reviewerId,
      dueDate: body.dueDate,
      items: questions.map((q) => ({
        questionId: q._id,
        rootQuestionId: q.rootQuestionId ?? q._id,
      })),
      createdBy: user._id,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new AppError(
        409,
        "REVIEW_CYCLE_ALREADY_OPEN",
        "This qualification already has an open review cycle for this awarding body",
      );
    }
    throw err;
  }
}

export async function listCycles(user, query) {
  const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize, totalPages: 1 };
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.qualificationId) filter.qualificationId = oid(query.qualificationId);
  if (user.role === "ab_reviewer") {
    if (!user.abId) return empty;
    filter.abId = user.abId;
  } else if (query.abId) {
    filter.abId = oid(query.abId);
  }
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    ReviewCycle.countDocuments(filter),
    ReviewCycle.find(filter).sort({ dueDate: 1, _id: 1 }).skip(skip).limit(query.pageSize),
  ]);
  const now = new Date();
  return {
    items: docs.map((doc) => cycleSummary(doc, now)),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize) || 1,
  };
}

export async function getCycle(user, id) {
  return cycleDetail(await loadCycle(user, id));
}

async function undoClaim(cycleId, questionId, decidedAt) {
  await ReviewCycle.updateOne(
    { _id: cycleId, items: { $elemMatch: { questionId, decidedAt } } },
    {
      $set: {
        "items.$.decision": null,
        "items.$.comment": null,
        "items.$.decidedBy": null,
        "items.$.decidedAt": null,
        "items.$.resultQuestionId": null,
      },
    },
  );
}

/**
 * Record one decision. The item is claimed first (a conditional update), then the question
 * is revised or retired; if that fails the claim is undone. So an item cannot be decided
 * twice and a decision is not left standing without its effect.
 * @returns {Promise<{ cycle: object, question: object|null, previous: object|null }>}
 */
export async function recordDecision(user, id, body) {
  const cycle = await loadCycle(user, id);
  if (cycle.status !== "open") {
    throw new AppError(409, "REVIEW_CYCLE_CLOSED", "The review cycle is closed");
  }
  const item = cycle.items.find((i) => String(i.questionId) === body.questionId);
  if (!item) throw notFound("Question is not in this review cycle");
  if (item.decision) {
    throw new AppError(409, "DECISION_ALREADY_RECORDED", "This question already has a decision");
  }

  const question = await Question.findById(body.questionId).select("isLatest status").lean();
  if (!question || !question.isLatest || question.status === "retired") {
    throw new AppError(
      409,
      "QUESTION_NOT_REVIEWABLE",
      "The question was changed or retired after the cycle was created",
    );
  }

  const decidedAt = new Date();
  const claimed = await ReviewCycle.findOneAndUpdate(
    {
      _id: cycle._id,
      status: "open",
      items: { $elemMatch: { questionId: body.questionId, decision: null } },
    },
    {
      $set: {
        "items.$.decision": body.decision,
        "items.$.comment": body.comment,
        "items.$.decidedBy": user._id,
        "items.$.decidedAt": decidedAt,
      },
    },
    { new: true },
  );
  if (!claimed) {
    throw new AppError(409, "DECISION_ALREADY_RECORDED", "This question already has a decision");
  }

  let resultQuestion = null;
  let previous = null;
  try {
    if (body.decision === "revise") {
      const revised = await updateQuestion(user, body.questionId, body.changes ?? {});
      resultQuestion = revised.question;
      previous = revised.previous;
      await ReviewCycle.updateOne(
        { _id: cycle._id, "items.questionId": body.questionId },
        { $set: { "items.$.resultQuestionId": resultQuestion._id } },
      );
    } else if (body.decision === "retire") {
      resultQuestion = await retireQuestion(user, body.questionId);
    }
  } catch (err) {
    await undoClaim(cycle._id, body.questionId, decidedAt);
    throw err;
  }

  return { cycle: await ReviewCycle.findById(cycle._id), question: resultQuestion, previous };
}

export async function closeCycle(user, id, { allowIncomplete = false } = {}) {
  const cycle = await loadCycle(user, id);
  if (cycle.status !== "open") {
    throw new AppError(409, "REVIEW_CYCLE_CLOSED", "The review cycle is already closed");
  }
  const { undecided } = counts(cycle);
  if (undecided > 0 && !allowIncomplete) {
    throw new AppError(409, "UNDECIDED_ITEMS", "Some questions have no decision yet", {
      undecided,
    });
  }
  const filter = { _id: cycle._id, status: "open" };
  if (!allowIncomplete) filter.items = { $not: { $elemMatch: { decision: null } } };
  const closed = await ReviewCycle.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "closed",
        closedBy: user._id,
        closedAt: new Date(),
        incomplete: undecided > 0,
      },
    },
    { new: true },
  );
  if (!closed) {
    throw new AppError(409, "UNDECIDED_ITEMS", "The review cycle changed; read it and try again");
  }
  return { before: cycle, after: closed };
}

function intervalView(qualificationId, row) {
  return {
    qualificationId: String(qualificationId),
    intervalMonths: row?.intervalMonths ?? compliance.QUESTION_REVIEW_INTERVAL_MONTHS,
    isDefault: !row,
  };
}

export async function getReviewInterval(qualificationId) {
  const qual = await Qualification.findById(qualificationId).select("_id").lean();
  if (!qual) throw new AppError(404, "QUALIFICATION_NOT_FOUND", "Qualification not found");
  return intervalView(qualificationId, await ReviewSetting.findOne({ qualificationId }).lean());
}

export async function setReviewInterval(user, qualificationId, { intervalMonths }) {
  const before = await getReviewInterval(qualificationId);
  await ReviewSetting.updateOne(
    { qualificationId },
    { $set: { intervalMonths, updatedBy: user._id } },
    { upsert: true },
  );
  return { before, after: intervalView(qualificationId, { intervalMonths }) };
}

/** ab_reviewer sees only qualifications their awarding body has batches or cycles for. */
export async function listReviewDue(user, query, now = new Date()) {
  let due = await computeReviewDue(now);
  if (user.role === "ab_reviewer") {
    const ab = user.abId ? String(user.abId) : null;
    due = due.filter((row) => ab && row.abIds.includes(ab));
  }
  const total = due.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    items: due.slice(start, start + query.pageSize).map((row) => ({
      qualificationId: row.qualificationId,
      code: row.code,
      name: row.name,
      intervalMonths: row.intervalMonths,
      lastCompletedReviewAt: row.lastCompletedReviewAt,
      dueQuestionCount: row.dueQuestionCount,
      qualificationOverdue: row.qualificationOverdue,
      awardingBodyIds: row.abIds,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize) || 1,
  };
}
