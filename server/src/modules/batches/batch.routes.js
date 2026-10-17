import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { clientIp } from "../../lib/client-ip.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  BATCH_CREATE_ROLES,
  BATCH_CAPTURE_LOCATION_ROLES,
  BATCH_READ_ROLES,
  BATCH_SETTINGS_READ_ROLES,
  BATCH_SETTINGS_WRITE_ROLES,
  BATCH_TEST_PAPER_ROLES,
  BATCH_TP_SPOC_WRITE_ROLES,
  CANDIDATE_INFO_READ_ROLES,
  CANDIDATE_INFO_WRITE_ROLES,
  LEARNER_FEEDBACK_READ_ROLES,
  LEARNER_FEEDBACK_WRITE_ROLES,
  REASSESSMENT_CREATE_ROLES,
} from "../../models/roles.js";
import { rolesForAction } from "./batch-transitions.js";
import {
  acceptBodySchema,
  assignBodySchema,
  batchIdParamSchema,
  batchSettingsBodySchema,
  candidateInfoBodySchema,
  captureLocationBodySchema,
  createBatchBodySchema,
  learnerFeedbackBodySchema,
  listBatchesQuerySchema,
  reasonBodySchema,
  reassessmentBodySchema,
  reassignBodySchema,
  rejectBodySchema,
  languagePapersBodySchema,
  testPaperBodySchema,
  tpSpocBodySchema,
} from "./batch.schemas.js";
import { saveTpSpoc } from "./tp-spoc.service.js";
import { mountBatchChildReadRoutes } from "../attendance/attendance.routes.js";
import { mountAssessorPaymentRoutes } from "../assessor-payments/assessor-payment.routes.js";
import { mountEvidenceBatchRoutes } from "../evidence/evidence.routes.js";
import { mountCandidateRoutes } from "../candidates/candidate.routes.js";
import { mountResultRoutes } from "../results/result.routes.js";
import { assignAssessor, reassignAssessor } from "./assign.service.js";
import { setBatchCaptureLocation } from "./batch-capture-location.service.js";
import { setBatchLanguagePapers, setBatchTestPaper } from "./batch-test-paper.service.js";
import { recordAccess } from "../audit/access-log.service.js";
import { getBatchSettings, updateBatchSettings } from "./batch-settings.service.js";
import { getOwnPopup, listBatchInfo, saveOwnInfo } from "./candidate-info.service.js";
import { createBatch, getBatch, listBatches, transitionBatch } from "./batch.service.js";
import { getLearnerFeedback, saveLearnerFeedback } from "./learner-feedback.service.js";
import { createReassessment } from "./reassessment.service.js";

function setAudit(req, entry) {
  req.audit = entry;
}

function postTransition(router, action, schema) {
  router.post(
    `/:id/${action}`,
    requireRoles(...rolesForAction(action)),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const body = schema.parse(req.body ?? {});
      const saved = await transitionBatch(req.user, id, action, body, { ip: clientIp(req) });
      setAudit(req, {
        action: `batch.${action}`,
        entity: "batch",
        entityId: saved.batch.id,
        abId: saved.batch.abId,
        batchId: saved.batch.id,
        before: saved.before,
        after: saved.stored,
        ...(body.reason ? { meta: { reason: body.reason } } : {}),
      });
      await res.status(200).json(saved.batch);
    }),
  );
}

export const batchesRouter = Router();

batchesRouter.use(requireAuth);

batchesRouter.post(
  "/",
  requireRoles(...BATCH_CREATE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createBatchBodySchema.parse(req.body);
    const saved = await createBatch(req.user, body, { ip: clientIp(req) });
    setAudit(req, {
      action: "batch.create",
      entity: "batch",
      entityId: saved.batch.id,
      abId: saved.batch.abId,
      batchId: saved.batch.id,
      after: saved.stored,
    });
    await res.status(201).json(saved.batch);
  }),
);

batchesRouter.get(
  "/",
  requireRoles(...BATCH_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listBatchesQuerySchema.parse(req.query);
    await res.status(200).json(await listBatches(req.user, query));
  }),
);

batchesRouter.get(
  "/:id",
  requireRoles(...BATCH_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    await res.status(200).json(await getBatch(req.user, id));
  }),
);

postTransition(batchesRouter, "accept", acceptBodySchema);
postTransition(batchesRouter, "reject", rejectBodySchema);
postTransition(batchesRouter, "cancel", reasonBodySchema);
postTransition(batchesRouter, "complete", reasonBodySchema);

function postAssignment(action, schema, handler) {
  batchesRouter.post(
    `/:id/${action}`,
    requireRoles(...rolesForAction(action)),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const body = schema.parse(req.body ?? {});
      const saved = await handler(req.user, id, body, { ip: clientIp(req) });
      setAudit(req, {
        action: `batch.${action}`,
        entity: "batch",
        entityId: saved.batch.id,
        abId: saved.batch.abId,
        batchId: saved.batch.id,
        before: saved.before,
        after: saved.stored,
        ...(saved.batch.warnings ? { meta: { warnings: saved.batch.warnings } } : {}),
      });
      await res.status(200).json(saved.batch);
    }),
  );
}

postAssignment("assign", assignBodySchema, assignAssessor);
postAssignment("reassign", reassignBodySchema, reassignAssessor);

// Reassessment is a new batch, not a status change, so it has no transition row.
batchesRouter.post(
  "/:id/reassessments",
  requireRoles(...REASSESSMENT_CREATE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = reassessmentBodySchema.parse(req.body ?? {});
    const saved = await createReassessment(req.user, id, body, { ip: clientIp(req) });
    setAudit(req, {
      action: "batch.reassess",
      entity: "batch",
      entityId: saved.batch.id,
      abId: saved.batch.abId,
      batchId: saved.batch.id,
      after: saved.stored,
      meta: saved.meta,
    });
    await res.status(201).json(saved.batch);
  }),
);

batchesRouter.put(
  "/:id/learner-feedback",
  requireRoles(...LEARNER_FEEDBACK_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = learnerFeedbackBodySchema.parse(req.body ?? {});
    const saved = await saveLearnerFeedback(req.user, id, body);
    setAudit(req, {
      action: "batch.learner_feedback",
      entity: "batch",
      entityId: saved.batch.id,
      abId: saved.batch.abId,
      batchId: saved.batch.id,
      before: { learnerFeedback: saved.before },
      after: { learnerFeedback: saved.after },
    });
    await res.status(200).json(saved.batch);
  }),
);

batchesRouter.put(
  "/:id/tp-spoc",
  requireRoles(...BATCH_TP_SPOC_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = tpSpocBodySchema.parse(req.body ?? {});
    const saved = await saveTpSpoc(req.user, id, body);
    setAudit(req, {
      action: "batch.set_tp_spoc",
      // The name and phone number must not reach the audit row through the request body.
      omitRequestBody: true,
      entity: "batch",
      entityId: saved.batch.id,
      abId: saved.abId,
      batchId: saved.batch.id,
      before: saved.before,
      after: saved.after,
    });
    await res.status(200).json(saved.batch);
  }),
);

batchesRouter.put(
  "/:id/test-paper",
  requireRoles(...BATCH_TEST_PAPER_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = testPaperBodySchema.parse(req.body ?? {});
    const saved = await setBatchTestPaper(req.user, id, body);
    setAudit(req, {
      action: "batch.set_test_paper",
      entity: "batch",
      entityId: saved.batch.id,
      abId: saved.abId,
      batchId: saved.batch.id,
      before: saved.before,
      after: saved.after,
    });
    await res.status(200).json(saved.batch);
  }),
);

batchesRouter.put(
  "/:id/language-papers",
  requireRoles(...BATCH_TEST_PAPER_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = languagePapersBodySchema.parse(req.body ?? {});
    const saved = await setBatchLanguagePapers(req.user, id, body);
    setAudit(req, {
      action: "batch.set_language_papers",
      entity: "batch",
      entityId: saved.batch.id,
      abId: saved.abId,
      batchId: saved.batch.id,
      before: saved.before,
      after: saved.after,
    });
    await res.status(200).json(saved.batch);
  }),
);

batchesRouter.put(
  "/:id/capture-location",
  requireRoles(...BATCH_CAPTURE_LOCATION_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = captureLocationBodySchema.parse(req.body ?? {});
    const saved = await setBatchCaptureLocation(id, body);
    setAudit(req, {
      action: "batch.set_capture_location",
      entity: "batch",
      entityId: saved.batch.id,
      abId: saved.abId,
      batchId: saved.batch.id,
      before: saved.before,
      after: saved.after,
    });
    await res.status(200).json(saved.batch);
  }),
);

batchesRouter.get(
  "/:id/learner-feedback",
  requireRoles(...LEARNER_FEEDBACK_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    await res.status(200).json(await getLearnerFeedback(req.user, id));
  }),
);

batchesRouter.get(
  "/:id/settings",
  requireRoles(...BATCH_SETTINGS_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    await res.status(200).json(await getBatchSettings(req.user, id));
  }),
);

batchesRouter.patch(
  "/:id/settings",
  requireRoles(...BATCH_SETTINGS_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const patch = batchSettingsBodySchema.parse(req.body ?? {});
    const saved = await updateBatchSettings(req.user, id, patch);
    setAudit(req, {
      action: "batch.settings_update",
      entity: "batch",
      entityId: id,
      abId: saved.abId,
      batchId: id,
      before: { settings: saved.before },
      after: { settings: saved.after },
    });
    await res.status(200).json(saved.body);
  }),
);

// Candidate pop-up (B-20). The answers are personal data: the audit row gets field names only.
batchesRouter.get(
  "/:id/candidate-info/mine",
  requireRoles(...CANDIDATE_INFO_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    await res.status(200).json(await getOwnPopup(req.user, id));
  }),
);

batchesRouter.put(
  "/:id/candidate-info",
  requireRoles(...CANDIDATE_INFO_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = candidateInfoBodySchema.parse(req.body ?? {});
    const saved = await saveOwnInfo(req.user, id, body);
    setAudit(req, {
      action: "batch.candidate_info_save",
      entity: "batch",
      entityId: id,
      abId: saved.abId,
      batchId: id,
      omitRequestBody: true,
      meta: { fields: saved.fields },
    });
    await res.status(200).json(saved.body);
  }),
);

batchesRouter.get(
  "/:id/candidate-info",
  requireRoles(...CANDIDATE_INFO_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = batchIdParamSchema.parse(req.params);
    const body = await listBatchInfo(req.user, id);
    await recordAccess(req, {
      subjectType: "learner",
      subjectIds: body.items.map((item) => item.learnerId),
      kind: "list",
      fields: body.fields,
    });
    await res.status(200).json(body);
  }),
);

mountAssessorPaymentRoutes(batchesRouter);
mountCandidateRoutes(batchesRouter);
mountBatchChildReadRoutes(batchesRouter);
mountResultRoutes(batchesRouter);
mountEvidenceBatchRoutes(batchesRouter);
