import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { clientIp } from "../../lib/client-ip.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { ATTENDANCE_WRITE_ROLES, BATCH_READ_ROLES } from "../../models/roles.js";
import { Question } from "../../models/question.model.js";
import { recordAccess } from "../audit/access-log.service.js";
import { loadReadableBatch } from "../batches/batch.service.js";
import { listBatchLoginEvents } from "../login-events/login-event.service.js";
import {
  attendanceBodySchema,
  batchIdParamSchema,
  checklistBodySchema,
  checklistQuerySchema,
  loginEventsQuerySchema,
} from "./attendance.schemas.js";
import { listAttendance, recordAttendance } from "./attendance.service.js";
import { listChecklists, presentChecklist, recordChecklist } from "./checklist.service.js";

/**
 * POST /api/v1/assessor/batches/:id/attendance | checklist. docs/SCHEMA.md §3.13.
 * Mounted beside the assessor login-event router.
 */
export const assessorFieldRouter = Router();

assessorFieldRouter.use(requireAuth);

assessorFieldRouter.post(
  "/batches/:id/attendance",
  requireRoles(...ATTENDANCE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = attendanceBodySchema.parse(req.body);
    const saved = await recordAttendance(req.user, id, body);
    req.audit = {
      action: "attendance.record",
      entity: "attendance",
      entityId: id,
      abId: saved.abId,
      batchId: id,
      before: saved.before,
      after: saved.items,
    };
    await res.status(200).json({ items: saved.items });
  }),
);

assessorFieldRouter.post(
  "/batches/:id/checklist",
  requireRoles(...ATTENDANCE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = checklistBodySchema.parse(req.body);
    const saved = await recordChecklist(req.user, id, body, { ip: clientIp(req) });
    const checklist = {
      ...presentChecklist(saved.checklist),
      replayed: saved.replayed,
      batchStatus: saved.batch?.status ?? null,
      batchStatusVersion: saved.batch?.statusVersion ?? null,
    };
    req.audit = {
      action: saved.replayed ? "checklist.replay" : "checklist.create",
      entity: "checklist",
      entityId: checklist.id,
      abId: saved.abId,
      batchId: checklist.batchId,
      after: checklist,
    };
    await res.status(200).json(checklist);
  }),
);

/**
 * Batch child reads. Mounted on the batches router (already behind requireAuth).
 * @param {import("express").Router} router
 */
export function mountBatchChildReadRoutes(router) {
  router.get(
    "/:id/login-events",
    requireRoles(...BATCH_READ_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const query = loginEventsQuerySchema.parse(req.query);
      const batch = await loadReadableBatch(req.user, id);
      await res.status(200).json(await listBatchLoginEvents(req.user, batch, query));
    }),
  );

  router.get(
    "/:id/attendance",
    requireRoles(...BATCH_READ_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      await res.status(200).json(await listAttendance(req.user, id));
    }),
  );

  router.get(
    "/:id/checklist",
    requireRoles(...BATCH_READ_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const query = checklistQuerySchema.parse(req.query);
      await res
        .status(200)
        .json(await listChecklists(req.user, id, { latest: query.latest === "true" }));
    }),
  );
}

/**
 * X-40. The viva and practical questions the assessor asks and shows on screen while recording.
 * Approved, newest version, in the batch's assessment language; the qualification of the batch only.
 * Every read is logged against the questions.
 */
assessorFieldRouter.get(
  "/batches/:id/viva-questions",
  requireRoles(...ATTENDANCE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const batch = await loadReadableBatch(req.user, id);
    const rows = await Question.find({
      qualificationId: batch.qualificationId,
      type: { $in: ["viva", "practical"] },
      status: "approved",
      isLatest: true,
      language: batch.assessmentLanguage,
    })
      .sort({ type: 1, nosId: 1, pcId: 1, _id: 1 })
      .lean();
    const items = rows.map((q) => ({
      id: String(q._id),
      type: q.type,
      nosId: q.nosId,
      pcId: q.pcId,
      stem: q.stem,
      marks: q.marks,
    }));
    await recordAccess(req, {
      subjectType: "question",
      subjectIds: items.map((item) => item.id),
      kind: "list",
      fields: ["stem"],
    });
    await res.status(200).json({ items });
  }),
);
