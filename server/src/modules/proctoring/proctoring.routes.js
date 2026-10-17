import express, { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { recordAccess } from "../audit/access-log.service.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  PROCTORING_CANDIDATE_ROLES,
  PROCTORING_CAPTURE_READ_ROLES,
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
  getFlagCapture,
  getReport,
  getSessionDetail,
  heartbeat,
  listSessions,
  listWarnings,
  recordFlag,
  reviewFlag,
  unlockSession,
} from "./proctoring.service.js";
import { compliance } from "../../config/compliance.js";
import { VIDEO_MAX_PIECES, listVideo, openVideoTrack, saveVideoPiece } from "./video.service.js";
import { z } from "zod";
import { pipeline } from "node:stream/promises";

const videoParams = z
  .object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id"),
    track: z.enum(["camera", "screen"]),
    seq: z.coerce
      .number()
      .int()
      .min(0)
      .max(VIDEO_MAX_PIECES - 1),
  })
  .strict();
const videoTrackParams = videoParams.omit({ seq: true });
const videoParser = express.raw({
  type: ["video/webm", "application/octet-stream"],
  limit: compliance.EXAM_VIDEO_CHUNK_MAX_BYTES,
});

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

/**
 * GET /api/v1/proctoring/flags/:id/capture. X-07. Coordinates are personal data: when they are
 * returned the read is logged (the flag and the learner) before anything is sent.
 */
proctoringRouter.get(
  "/flags/:id/capture",
  requireRoles(...PROCTORING_CAPTURE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { flag, learnerId, body } = await getFlagCapture(req.user, id);
    if (body.location) {
      await recordAccess(req, {
        subjectType: "proctoringFlag",
        subjectIds: [flag._id],
        kind: "detail",
        fields: ["location"],
      });
      if (learnerId) {
        await recordAccess(req, {
          subjectType: "learner",
          subjectIds: [learnerId],
          kind: "detail",
          fields: ["flagLocation"],
        });
      }
    }
    res.status(200).json(body);
  }),
);

/**
 * POST /api/v1/proctoring/sessions/:id/video/:track/:seq (X-27). The body is one WebM piece of
 * the camera or the shared screen. Only the candidate of the session; only when the batch
 * records video. Sending the same piece again is `200`.
 */
proctoringRouter.post(
  "/sessions/:id/video/:track/:seq",
  requireRoles(...PROCTORING_CANDIDATE_ROLES),
  videoParser,
  asyncHandler(async (req, res) => {
    const { id, track, seq } = videoParams.parse(req.params);
    const saved = await saveVideoPiece(req.user, id, { track, seq }, req.body);
    req.audit = {
      action: saved.replayed ? "exam_video.replay" : "exam_video.piece",
      entity: "proctoringSession",
      entityId: saved.session._id,
      abId: saved.session.abId,
      batchId: saved.session.batchId,
      omitRequestBody: true,
      after: { track, seq, size: saved.size },
    };
    res
      .status(saved.replayed ? 200 : 201)
      .json({ track, seq, size: saved.size, replayed: saved.replayed });
  }),
);

/** GET /api/v1/proctoring/sessions/:id/video (X-27). What was recorded; no video bytes. */
proctoringRouter.get(
  "/sessions/:id/video",
  requireRoles(...PROCTORING_CAPTURE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await listVideo(req.user, id));
  }),
);

/** GET /api/v1/proctoring/sessions/:id/video/:track (X-27). The track as one WebM file; the look is logged. */
proctoringRouter.get(
  "/sessions/:id/video/:track",
  requireRoles(...PROCTORING_CAPTURE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id, track } = videoTrackParams.parse(req.params);
    const download = req.query.download === "1";
    const stream = await openVideoTrack(req, id, track, { download });
    res.set({
      ...(download
        ? { "Content-Disposition": `attachment; filename="exam-${id}-${track}.webm"` }
        : {}),
      "Content-Type": "video/webm",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.status(200);
    await pipeline(stream, res);
  }),
);
