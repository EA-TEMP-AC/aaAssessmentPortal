import express, { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  QUESTION_APPROVE_ROLES,
  QUESTION_READ_ROLES,
  QUESTION_WRITE_ROLES,
} from "../../models/roles.js";
import {
  coverageParamSchema,
  createQuestionSchema,
  idParamSchema,
  importQuerySchema,
  listQuestionsQuerySchema,
  updateQuestionSchema,
} from "./question-bank.schemas.js";
import {
  approveQuestion,
  buildImportTemplate,
  createQuestion,
  getCoverage,
  getQuestion,
  importQuestions,
  listQuestions,
  retireQuestion,
  submitQuestionForReview,
  updateQuestion,
} from "./question-bank.service.js";
import { reviewCycleRouter } from "./review-cycle.routes.js";
import { guardContentRead } from "../content-controls/content-guard.js";
import { sectorCoverageRouter } from "./sector-coverage.routes.js";
import { loadReadableQuestionImage, uploadQuestionImage } from "./question-image.service.js";
import { QUESTION_IMAGE_MAX_BYTES } from "../../models/question-image.model.js";

export const questionBankRouter = Router();

questionBankRouter.use(requireAuth);
questionBankRouter.use(sectorCoverageRouter);
questionBankRouter.use(reviewCycleRouter);

// Raw buffer middleware for direct Excel binary upload
const rawBufferParser = express.raw({
  type: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
  ],
  limit: "26mb",
});

const imageParser = express.raw({
  type: ["image/png", "image/jpeg"],
  limit: QUESTION_IMAGE_MAX_BYTES,
});

/**
 * POST /api/v1/question-bank/images (X-25). The body is the picture itself (Content-Type
 * image/png or image/jpeg, at most 1 MB). The picture is attached to a question afterwards,
 * with its text description, through `images` on the question.
 */
questionBankRouter.post(
  "/images",
  requireRoles(...QUESTION_WRITE_ROLES),
  imageParser,
  asyncHandler(async (req, res) => {
    const saved = await uploadQuestionImage(req.user, req.body);
    req.audit = {
      action: "question_image.upload",
      entity: "question_image",
      entityId: saved.id,
      omitRequestBody: true,
      after: saved,
    };
    res.status(201).json(saved);
  }),
);

/** GET /api/v1/question-bank/images/:id/file (X-25). The picture bytes. */
questionBankRouter.get(
  "/images/:id/file",
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const image = await loadReadableQuestionImage(req.user, id);
    res.set({
      "Content-Type": image.contentType,
      "Content-Length": String(image.size),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    res.status(200).end(Buffer.from(image.data.buffer ?? image.data));
  }),
);

/**
 * POST /api/v1/question-bank/questions
 * Creates a new question in draft status.
 */
questionBankRouter.post(
  "/questions",
  requireRoles(...QUESTION_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createQuestionSchema.parse(req.body);
    const created = await createQuestion(req.user, body);

    req.audit = {
      action: "question.create",
      entity: "question",
      entityId: created._id,
      after: created,
      meta: {
        qualificationId: created.qualificationId,
        nosId: created.nosId,
        pcId: created.pcId,
        type: created.type,
        marks: created.marks,
        status: created.status,
      },
    };

    res.status(201).json(created);
  }),
);

/**
 * GET /api/v1/question-bank/questions
 * Lists questions with filters and pagination.
 */
questionBankRouter.get(
  "/questions",
  requireRoles(...QUESTION_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listQuestionsQuerySchema.parse(req.query);
    const results = await listQuestions(req.user, query);
    await guardContentRead(req, { questionIds: results.items.map((q) => q._id), kind: "list" });
    res.status(200).json(results);
  }),
);

/**
 * GET /api/v1/question-bank/coverage/:qualificationId
 * Coverage endpoint for a qualification:
 * Lists each PC with its approved question count, and flags PCs
 * with fewer than 5 approved questions.
 */
questionBankRouter.get(
  "/coverage/:qualificationId",
  requireRoles(...QUESTION_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { qualificationId } = coverageParamSchema.parse(req.params);
    const coverage = await getCoverage(req.user, qualificationId);
    res.status(200).json(coverage);
  }),
);

/**
 * GET /api/v1/question-bank/questions/:id
 * Reads a single question by ID.
 */
questionBankRouter.get(
  "/questions/:id",
  requireRoles(...QUESTION_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const question = await getQuestion(req.user, id);
    await guardContentRead(req, { questionIds: [question._id], kind: "detail" });
    res.status(200).json(question);
  }),
);

/**
 * PUT /api/v1/question-bank/questions/:id
 * Updates a question. Preserves the old version (setting isLatest: false)
 * and creates a new document with an incremented version number.
 */
const handleUpdate = asyncHandler(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const body = updateQuestionSchema.parse(req.body);
  const { question, previous } = await updateQuestion(req.user, id, body);

  req.audit = {
    action: "question.update",
    entity: "question",
    entityId: question._id,
    before: previous,
    after: question,
    meta: {
      previousVersionId: previous._id,
      version: question.version,
      status: question.status,
    },
  };

  await guardContentRead(req, { questionIds: [question._id], kind: "detail" });
  res.status(200).json(question);
});

questionBankRouter.put("/questions/:id", requireRoles(...QUESTION_WRITE_ROLES), handleUpdate);

questionBankRouter.patch("/questions/:id", requireRoles(...QUESTION_WRITE_ROLES), handleUpdate);

/**
 * POST /api/v1/question-bank/questions/:id/retire
 * DELETE /api/v1/question-bank/questions/:id
 * Retires a question (soft-delete). Never hard deletes.
 */
const handleRetire = asyncHandler(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const retired = await retireQuestion(req.user, id);

  req.audit = {
    action: "question.retire",
    entity: "question",
    entityId: retired._id,
    after: retired,
    meta: {
      status: "retired",
      version: retired.version,
    },
  };

  await guardContentRead(req, { questionIds: [retired._id], kind: "detail" });
  res.status(200).json(retired);
});

questionBankRouter.post(
  "/questions/:id/retire",
  requireRoles(...QUESTION_WRITE_ROLES),
  handleRetire,
);

questionBankRouter.delete("/questions/:id", requireRoles(...QUESTION_WRITE_ROLES), handleRetire);

/**
 * POST /api/v1/question-bank/questions/:id/approve
 * Approves a question. Allowed for ab_reviewer and aa_admin.
 */
questionBankRouter.post(
  "/questions/:id/approve",
  requireRoles(...QUESTION_APPROVE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const approved = await approveQuestion(req.user, id);

    req.audit = {
      action: "question.approve",
      entity: "question",
      entityId: approved._id,
      after: approved,
      meta: {
        status: "approved",
        version: approved.version,
      },
    };

    await guardContentRead(req, { questionIds: [approved._id], kind: "detail" });
    res.status(200).json(approved);
  }),
);

/**
 * POST /api/v1/question-bank/questions/:id/submit-for-review
 * X-10: draft -> in_review. Allowed for the people who write questions.
 */
questionBankRouter.post(
  "/questions/:id/submit-for-review",
  requireRoles(...QUESTION_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const submitted = await submitQuestionForReview(req.user, id);

    req.audit = {
      action: "question.submit_for_review",
      entity: "question",
      entityId: submitted._id,
      after: submitted,
      meta: { status: "in_review", version: submitted.version },
    };

    await guardContentRead(req, { questionIds: [submitted._id], kind: "detail" });
    res.status(200).json(submitted);
  }),
);

/**
 * GET /api/v1/question-bank/import-template
 * X-10: the empty .xlsx the import expects.
 */
questionBankRouter.get(
  "/import-template",
  requireRoles(...QUESTION_WRITE_ROLES),
  asyncHandler(async (_req, res) => {
    const buffer = await buildImportTemplate();
    res.status(200);
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="question-import-template.xlsx"',
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  }),
);

/**
 * POST /api/v1/question-bank/import
 * Imports questions from an Excel (.xlsx) file or array.
 * Validates every row; returns a per-row error report.
 * If any row fails, imports nothing unless partial=true.
 */
questionBankRouter.post(
  "/import",
  requireRoles(...QUESTION_WRITE_ROLES),
  rawBufferParser,
  asyncHandler(async (req, res) => {
    const query = importQuerySchema.parse(req.query);
    let buffer = null;
    let rows = null;
    let partial = query.partial;

    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (req.body && typeof req.body === "object") {
      if (req.body.partial !== undefined) {
        partial = Boolean(req.body.partial);
      }
      if (req.body.fileBase64) {
        buffer = Buffer.from(req.body.fileBase64, "base64");
      } else if (req.body.data && typeof req.body.data === "string") {
        buffer = Buffer.from(req.body.data, "base64");
      } else if (Array.isArray(req.body.rows)) {
        rows = req.body.rows;
      } else if (Array.isArray(req.body.questions)) {
        rows = req.body.questions;
      }
    }

    const result = await importQuestions(req.user, { buffer, rows, partial });

    req.audit = {
      action: "question.import",
      entity: "question",
      omitRequestBody: true,
      meta: {
        totalRows: result.totalRows,
        importedCount: result.importedCount,
        errorCount: result.errorCount,
        partial,
      },
    };

    if (!result.success) {
      res.status(400).json(result);
    } else {
      res.status(result.importedCount > 0 ? 201 : 200).json(result);
    }
  }),
);
