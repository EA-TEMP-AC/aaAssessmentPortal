import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  REVIEW_CYCLE_DECIDE_ROLES,
  REVIEW_CYCLE_MANAGE_ROLES,
  REVIEW_CYCLE_READ_ROLES,
} from "../../models/roles.js";
import { updateQuestionSchema } from "./question-bank.schemas.js";
import {
  closeCycleSchema,
  createCycleSchema,
  cycleIdParamSchema,
  decisionSchema,
  intervalSchema,
  listCyclesQuerySchema,
  qualificationParamSchema,
  reviewDueQuerySchema,
} from "./review-cycle.schemas.js";
import {
  closeCycle,
  createCycle,
  cycleSummary,
  getCycle,
  getReviewInterval,
  listCycles,
  listReviewDue,
  recordDecision,
  setReviewInterval,
} from "./review-cycle.service.js";

/**
 * Mounted under /api/v1/question-bank by question-bank.routes.js, after requireAuth.
 * Audit rows carry ids, dates, decisions and counts. Never question text or reviewer comments.
 */
export const reviewCycleRouter = Router();

reviewCycleRouter.get(
  "/review-due",
  requireRoles(...REVIEW_CYCLE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = reviewDueQuerySchema.parse(req.query);
    res.status(200).json(await listReviewDue(req.user, query));
  }),
);

reviewCycleRouter.get(
  "/review-settings/:qualificationId",
  requireRoles(...REVIEW_CYCLE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { qualificationId } = qualificationParamSchema.parse(req.params);
    res.status(200).json(await getReviewInterval(qualificationId));
  }),
);

reviewCycleRouter.put(
  "/review-settings/:qualificationId",
  requireRoles(...REVIEW_CYCLE_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const { qualificationId } = qualificationParamSchema.parse(req.params);
    const body = intervalSchema.parse(req.body);
    const { before, after } = await setReviewInterval(req.user, qualificationId, body);
    req.audit = {
      action: "review_setting.update",
      entity: "review_setting",
      entityId: qualificationId,
      before,
      after,
      meta: { qualificationId },
    };
    res.status(200).json(after);
  }),
);

reviewCycleRouter.post(
  "/review-cycles",
  requireRoles(...REVIEW_CYCLE_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createCycleSchema.parse(req.body);
    const created = await createCycle(req.user, body);
    const summary = cycleSummary(created);
    req.audit = {
      action: "review_cycle.create",
      entity: "review_cycle",
      entityId: summary.id,
      abId: summary.abId,
      after: summary,
      meta: { qualificationId: summary.qualificationId, questionCount: summary.counts.total },
    };
    res.status(201).json(summary);
  }),
);

reviewCycleRouter.get(
  "/review-cycles",
  requireRoles(...REVIEW_CYCLE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listCyclesQuerySchema.parse(req.query);
    res.status(200).json(await listCycles(req.user, query));
  }),
);

reviewCycleRouter.get(
  "/review-cycles/:id",
  requireRoles(...REVIEW_CYCLE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = cycleIdParamSchema.parse(req.params);
    res.status(200).json(await getCycle(req.user, id));
  }),
);

reviewCycleRouter.post(
  "/review-cycles/:id/decisions",
  requireRoles(...REVIEW_CYCLE_DECIDE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = cycleIdParamSchema.parse(req.params);
    const body = decisionSchema.parse(req.body);
    if (body.changes) updateQuestionSchema.parse(body.changes);
    const { cycle, question, previous } = await recordDecision(req.user, id, body);
    const item = cycle.items.find((i) => String(i.questionId) === body.questionId);
    const result = {
      cycleId: String(cycle._id),
      questionId: body.questionId,
      decision: item.decision,
      comment: item.comment,
      decidedBy: String(item.decidedBy),
      decidedAt: item.decidedAt,
      resultQuestionId: item.resultQuestionId ? String(item.resultQuestionId) : null,
      counts: cycleSummary(cycle).counts,
    };
    req.audit = {
      action: "review_cycle.decision",
      entity: "review_cycle",
      entityId: result.cycleId,
      abId: String(cycle.abId),
      after: {
        questionId: result.questionId,
        decision: result.decision,
        resultQuestionId: result.resultQuestionId,
      },
      meta: {
        qualificationId: String(cycle.qualificationId),
        commentLength: body.comment.length,
        previousVersionId: previous ? String(previous._id) : undefined,
        version: question?.version,
      },
    };
    res.status(201).json(result);
  }),
);

reviewCycleRouter.post(
  "/review-cycles/:id/close",
  requireRoles(...REVIEW_CYCLE_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = cycleIdParamSchema.parse(req.params);
    const body = closeCycleSchema.parse(req.body ?? {});
    const { before, after } = await closeCycle(req.user, id, body);
    const summary = cycleSummary(after);
    req.audit = {
      action: "review_cycle.close",
      entity: "review_cycle",
      entityId: summary.id,
      abId: summary.abId,
      before: { status: before.status },
      after: { status: summary.status, incomplete: summary.incomplete, counts: summary.counts },
      meta: { qualificationId: summary.qualificationId },
    };
    res.status(200).json(summary);
  }),
);
