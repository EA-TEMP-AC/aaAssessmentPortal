import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  PROCTORING_CANDIDATE_ROLES,
  PROCTORING_READ_ROLES,
  PROCTORING_REVIEW_ROLES,
  PROCTORING_UNLOCK_ROLES,
} from "../../models/roles.js";
import {
  createSessionSchema,
  flagSchema,
  heartbeatSchema,
  idParamSchema,
  listQuerySchema,
  reviewSchema,
} from "./proctoring.schemas.js";
import {
  createSession,
  getReport,
  getSessionDetail,
  heartbeat,
  listSessions,
  listWarnings,
  recordFlag,
  reviewFlag,
  unlockSession,
} from "./proctoring.service.js";

export const proctoringRouter = Router();

proctoringRouter.use(requireAuth);

/** POST /api/v1/proctoring/sessions. 201 new, 200 when the attempt already has a session. */
proctoringRouter.post(
  "/sessions",
  requireRoles(...PROCTORING_CANDIDATE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createSessionSchema.parse(req.body);
    const { session, created, body: out } = await createSession(req.user, body);
    req.audit = {
      action: created ? "proctoring.session_start" : "proctoring.session_replay",
      entity: "proctoringSession",
      entityId: session._id,
      abId: session.abId,
      batchId: session.batchId,
      omitRequestBody: true,
      after: { attemptId: out.attemptId, batchId: out.batchId, status: out.status },
    };
    res.status(created ? 201 : 200).json(out);
  }),
);

/** GET /api/v1/proctoring/sessions */
proctoringRouter.get(
  "/sessions",
  requireRoles(...PROCTORING_READ_ROLES),
  asyncHandler(async (req, res) => {
    res.status(200).json(await listSessions(req.user, listQuerySchema.parse(req.query)));
  }),
);

/** POST /api/v1/proctoring/sessions/:id/heartbeat */
proctoringRouter.post(
  "/sessions/:id/heartbeat",
  requireRoles(...PROCTORING_CANDIDATE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    heartbeatSchema.parse(req.body ?? {});
    const { session, before, after, body } = await heartbeat(req.user, id);
    req.audit = {
      action: "proctoring.heartbeat",
      entity: "proctoringSession",
      entityId: session._id,
      abId: session.abId,
      batchId: session.batchId,
      omitRequestBody: true,
      before,
      after,
    };
    res.status(200).json(body);
  }),
);

/** POST /api/v1/proctoring/sessions/:id/flags. 201 new, 200 replay. */
proctoringRouter.post(
  "/sessions/:id/flags",
  requireRoles(...PROCTORING_CANDIDATE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = flagSchema.parse(req.body);
    const { flag, replayed, session, body } = await recordFlag(req.user, id, input);
    req.audit = {
      action: replayed ? "proctoring.flag_replay" : "proctoring.flag",
      entity: "proctoringFlag",
      entityId: flag._id,
      abId: session.abId,
      batchId: session.batchId,
      omitRequestBody: true,
      after: {
        sessionId: body.sessionId,
        type: body.type,
        severity: body.severity,
        capturedAt: body.capturedAt,
        evidenceId: body.evidenceId,
      },
    };
    res.status(replayed ? 200 : 201).json(body);
  }),
);

/** GET /api/v1/proctoring/sessions/:id/warnings. The candidate's own session. */
proctoringRouter.get(
  "/sessions/:id/warnings",
  requireRoles(...PROCTORING_CANDIDATE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await listWarnings(req.user, id));
  }),
);

/** GET /api/v1/proctoring/sessions/:id/report. P-04. */
proctoringRouter.get(
  "/sessions/:id/report",
  requireRoles(...PROCTORING_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await getReport(req.user, id));
  }),
);

/** GET /api/v1/proctoring/sessions/:id with its flags. */
proctoringRouter.get(
  "/sessions/:id",
  requireRoles(...PROCTORING_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await getSessionDetail(req.user, id));
  }),
);

/** PATCH /api/v1/proctoring/flags/:id/review. P-08. The note text never reaches the audit row. */
proctoringRouter.patch(
  "/flags/:id/review",
  requireRoles(...PROCTORING_REVIEW_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = reviewSchema.parse(req.body);
    const { flag, before, after, body } = await reviewFlag(req.user, id, input);
    req.audit = {
      action: `proctoring.review_${input.decision}`,
      entity: "proctoringFlag",
      entityId: flag._id,
      abId: flag.abId,
      batchId: flag.batchId,
      omitRequestBody: true,
      before,
      after,
    };
    res.status(200).json(body);
  }),
);

/** POST /api/v1/proctoring/sessions/:id/unlock. B-20. Lifts a flag-policy pause. */
proctoringRouter.post(
  "/sessions/:id/unlock",
  requireRoles(...PROCTORING_UNLOCK_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    heartbeatSchema.parse(req.body ?? {});
    const { session, before, after, body } = await unlockSession(req.user, id);
    req.audit = {
      action: "proctoring.unlock",
      entity: "proctoringSession",
      entityId: session._id,
      abId: session.abId,
      batchId: session.batchId,
      omitRequestBody: true,
      before,
      after,
    };
    res.status(200).json(body);
  }),
);
