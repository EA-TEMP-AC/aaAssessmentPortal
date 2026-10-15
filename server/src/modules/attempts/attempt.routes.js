import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  ATTEMPT_CANDIDATE_ROLES,
  ATTEMPT_LIST_ROLES,
  ATTEMPT_MARK_ROLES,
  ATTEMPT_READ_ROLES,
  ATTEMPT_SUMMARY_ROLES,
} from "../../models/roles.js";
import {
  answersSchema,
  idParamSchema,
  listQuerySchema,
  manualMarksSchema,
  startSchema,
} from "./attempt.schemas.js";
import {
  applyManualMarks,
  auditView,
  getAttempt,
  getSummary,
  listAttempts,
  presentAttempt,
  presentClosed,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from "./attempt.service.js";

export const attemptsRouter = Router();

attemptsRouter.use(requireAuth);

/** POST /api/v1/attempts/start. 201 for a new attempt, 200 when it already exists. */
attemptsRouter.post(
  "/start",
  requireRoles(...ATTEMPT_CANDIDATE_ROLES),
  asyncHandler(async (req, res) => {
    const body = startSchema.parse(req.body);
    const { attempt, created } = await startAttempt(req.user, body);
    req.audit = {
      action: created ? "attempt.start" : "attempt.start_replay",
      entity: "attempt",
      entityId: attempt._id,
      abId: attempt.abId,
      batchId: attempt.batchId,
      after: auditView(attempt),
    };
    res.status(created ? 201 : 200).json(await presentAttempt(req.user, attempt));
  }),
);

/** GET /api/v1/attempts */
attemptsRouter.get(
  "/",
  requireRoles(...ATTEMPT_LIST_ROLES),
  asyncHandler(async (req, res) => {
    res.status(200).json(await listAttempts(req.user, listQuerySchema.parse(req.query)));
  }),
);

/** GET /api/v1/attempts/:id/summary */
attemptsRouter.get(
  "/:id/summary",
  requireRoles(...ATTEMPT_SUMMARY_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await getSummary(req.user, id));
  }),
);

/** PUT /api/v1/attempts/:id/answers. The raw body is kept out of the audit row. */
attemptsRouter.put(
  "/:id/answers",
  requireRoles(...ATTEMPT_CANDIDATE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = answersSchema.parse(req.body);
    const result = await saveAnswers(req.user, id, body.answers);
    req.audit = {
      action: "attempt.answers_save",
      entity: "attempt",
      entityId: id,
      omitRequestBody: true,
      meta: { savedCount: result.saved },
    };
    res.status(200).json(result);
  }),
);

/** POST /api/v1/attempts/:id/submit */
attemptsRouter.post(
  "/:id/submit",
  requireRoles(...ATTEMPT_CANDIDATE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { attempt, outcome } = await submitAttempt(req.user, id);
    const action = {
      submitted: "attempt.submit",
      replay: "attempt.submit_replay",
      late: "attempt.submit_late",
    }[outcome];
    req.audit = {
      action,
      entity: "attempt",
      entityId: attempt._id,
      abId: attempt.abId,
      batchId: attempt.batchId,
      after: auditView(attempt),
    };
    res.status(200).json(presentClosed(attempt));
  }),
);

/** PUT /api/v1/attempts/:id/manual-marks */
attemptsRouter.put(
  "/:id/manual-marks",
  requireRoles(...ATTEMPT_MARK_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = manualMarksSchema.parse(req.body);
    const { attempt, before, after } = await applyManualMarks(req.user, id, body.marks);
    req.audit = {
      action: "attempt.manual_marks",
      entity: "attempt",
      entityId: attempt._id,
      abId: attempt.abId,
      batchId: attempt.batchId,
      before,
      after,
    };
    res.status(200).json(await presentAttempt(req.user, attempt));
  }),
);

/** GET /api/v1/attempts/:id */
attemptsRouter.get(
  "/:id",
  requireRoles(...ATTEMPT_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await getAttempt(req.user, id));
  }),
);
