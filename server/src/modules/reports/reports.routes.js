import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { REPORT_MARKS_ROLES, RESULT_REPORT_ROLES } from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
import { marksExport } from "./reports.service.js";
import {
  RESULT_BATCH_STATUSES,
  buildCandidateSummaryWorkbook,
  candidateSummary,
  listResultBatches,
} from "./results-report.js";

const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const resultListQuerySchema = z
  .object({
    status: z.enum(RESULT_BATCH_STATUSES).optional(),
    sector: z.string().trim().min(1).max(100).optional(),
    qualificationId: idSchema.optional(),
    centreId: idSchema.optional(),
    batchId: idSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

const batchParamSchema = z
  .object({ batchId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid batch ID") })
  .strict();

/**
 * GET /api/v1/reports/batches/:batchId/marks.xlsx
 * X-09. Candidate names and marks for the batch. Names are personal data, so the read is logged
 * before the file is sent. Nothing is written to the audit log beyond ids and the row count.
 */
reportsRouter.get(
  "/batches/:batchId/marks.xlsx",
  requireRoles(...REPORT_MARKS_ROLES),
  asyncHandler(async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { batchId } = batchParamSchema.parse(req.params);
    const { buffer, learnerIds, count, batch } = await marksExport(req.user, batchId);
    await recordAccess(req, {
      subjectType: "learner",
      subjectIds: learnerIds,
      kind: "list",
      fields: ["name", "marks"],
    });
    req.audit = {
      action: "report.marks_export",
      entity: "batch",
      entityId: batchId,
      abId: batch.abId,
      batchId,
      meta: { rows: count },
    };
    res.status(200);
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="marks-${batchId}.xlsx"`,
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  }),
);

/**
 * GET /api/v1/reports/results
 * X-44. Batches that have reached results, with the pass, fail and absent counts. Counts only.
 */
reportsRouter.get(
  "/results",
  requireRoles(...RESULT_REPORT_ROLES),
  asyncHandler(async (req, res) => {
    const query = resultListQuerySchema.parse(req.query);
    res.set("Cache-Control", "no-store");
    res.status(200).json(await listResultBatches(req.user, query));
  }),
);

/**
 * GET /api/v1/reports/batches/:batchId/candidate-summary
 * X-44. The candidate summary report as data (names and marks, so the read is logged).
 */
reportsRouter.get(
  "/batches/:batchId/candidate-summary",
  requireRoles(...RESULT_REPORT_ROLES),
  asyncHandler(async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { batchId } = batchParamSchema.parse(req.params);
    const summary = await candidateSummary(req.user, batchId);
    await recordAccess(req, {
      subjectType: "learner",
      subjectIds: summary.rows.map((r) => r.learnerId).filter(Boolean),
      kind: "list",
      fields: ["name", "marks"],
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json(summary);
  }),
);

/** GET /api/v1/reports/batches/:batchId/candidate-summary.xlsx. The same report as Excel. */
reportsRouter.get(
  "/batches/:batchId/candidate-summary.xlsx",
  requireRoles(...RESULT_REPORT_ROLES),
  asyncHandler(async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { batchId } = batchParamSchema.parse(req.params);
    const summary = await candidateSummary(req.user, batchId);
    const buffer = await buildCandidateSummaryWorkbook(summary);
    await recordAccess(req, {
      subjectType: "learner",
      subjectIds: summary.rows.map((r) => r.learnerId).filter(Boolean),
      kind: "list",
      fields: ["name", "marks"],
    });
    req.audit = {
      action: "report.candidate_summary_export",
      entity: "batch",
      entityId: batchId,
      batchId,
      meta: { rows: summary.rows.length },
    };
    res.status(200);
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="candidate-summary-${batchId}.xlsx"`,
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  }),
);
