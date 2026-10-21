import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { BATCH_MAIL_ROLES, DASHBOARD_ROLES } from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
import {
  ASSESSOR_FILTERS,
  MAIL_RECIPIENTS,
  TP_FILTERS,
  searchMailBatches,
  sendBatchMails,
} from "./batch-mails.service.js";
import { dashboardSummary } from "./dashboard.service.js";
import { loginHistory, punchDetails } from "./login-history.service.js";

const idSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const sectorSchema = z.string().trim().min(1).max(100);
const pageSchema = z.coerce.number().int().min(1).max(10000);

const dashboardQuery = z
  .object({
    sector: sectorSchema.optional(),
    batchId: idSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict();
const mailSearchQuery = dashboardQuery
  .extend({
    assessorStatus: z.enum(ASSESSOR_FILTERS).optional(),
    tpStatus: z.enum(TP_FILTERS).optional(),
    page: pageSchema.optional(),
  })
  .strict();
const mailSendBody = z
  .object({
    batchIds: z.array(idSchema).min(1).max(50),
    recipients: z.array(z.enum(MAIL_RECIPIENTS)).min(1).max(MAIL_RECIPIENTS.length),
  })
  .strict();
const loginQuery = z
  .object({
    sector: sectorSchema.optional(),
    batchId: idSchema.optional(),
    examDate: dateSchema.optional(),
    role: z.enum(["assessor", "proctor", "student"]).optional(),
    userId: idSchema.optional(),
    type: z.enum(["login", "logout"]).optional(),
    view: z.enum(["log", "punch"]).optional(),
    page: pageSchema.optional(),
  })
  .strict();

/** GET /api/v1/dashboard. X-49. */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get(
  "/",
  requireRoles(...DASHBOARD_ROLES),
  asyncHandler(async (req, res) => {
    const query = dashboardQuery.parse(req.query);
    res.set("Cache-Control", "no-store");
    res.status(200).json(await dashboardSummary(req.user, query));
  }),
);

/** /api/v1/batch-mails. X-49. */
export const batchMailsRouter = Router();
batchMailsRouter.use(requireAuth);
batchMailsRouter.get(
  "/batches",
  requireRoles(...BATCH_MAIL_ROLES),
  asyncHandler(async (req, res) => {
    const query = mailSearchQuery.parse(req.query);
    res.set("Cache-Control", "no-store");
    res.status(200).json(await searchMailBatches(req.user, query));
  }),
);
batchMailsRouter.post(
  "/send",
  requireRoles(...BATCH_MAIL_ROLES),
  asyncHandler(async (req, res) => {
    const body = mailSendBody.parse(req.body);
    const result = await sendBatchMails(req.user, body);
    // Counts and ids only: no addresses, no mail text.
    req.audit = {
      action: "batchMail.send",
      entity: "batch",
      omitRequestBody: true,
      meta: {
        batches: body.batchIds.length,
        recipients: body.recipients,
        queued: result.queued,
        skipped: result.skipped.length,
      },
    };
    res.status(200).json(result);
  }),
);

/** GET /api/v1/reports/login-history. X-49. Mounted on the reports router path in app.js. */
export const loginHistoryRouter = Router();
loginHistoryRouter.use(requireAuth);
loginHistoryRouter.get(
  "/",
  requireRoles(...DASHBOARD_ROLES),
  asyncHandler(async (req, res) => {
    const { view, ...query } = loginQuery.parse(req.query);
    const body =
      view === "punch" ? await punchDetails(req.user, query) : await loginHistory(req.user, query);
    await recordAccess(req, {
      subjectType: "user",
      subjectIds: [...new Set(body.items.map((i) => i.userId))],
      kind: "list",
      fields: ["name", "loginTimes"],
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json(body);
  }),
);
