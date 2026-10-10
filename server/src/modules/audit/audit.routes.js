import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { AUDIT_READ_ROLES } from "../../models/roles.js";
import { listAuditLogsQuerySchema } from "./audit.schemas.js";
import { listAuditLogs } from "./audit.service.js";

export const auditRouter = Router();

auditRouter.get(
  "/",
  requireAuth,
  requireRoles(...AUDIT_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const body = await listAuditLogs(req.user, query);
    res.status(200).json(body);
  }),
);
