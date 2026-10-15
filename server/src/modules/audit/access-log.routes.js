import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { ACCESS_LOG_READ_ROLES } from "../../models/roles.js";
import { listAccessLogs } from "./access-log.service.js";
import { listAccessLogsQuerySchema } from "./audit.schemas.js";

export const accessLogRouter = Router();

accessLogRouter.get(
  "/",
  requireAuth,
  requireRoles(...ACCESS_LOG_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listAccessLogsQuerySchema.parse(req.query);
    await res.status(200).json(await listAccessLogs(query));
  }),
);
