import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { REPORT_MARKS_ROLES } from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
import { marksExport } from "./reports.service.js";

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
