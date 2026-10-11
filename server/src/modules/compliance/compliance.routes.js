import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { BATCH_READ_ROLES } from "../../models/roles.js";
import { complianceDashboard } from "../batches/batch.service.js";

export const complianceRouter = Router();

complianceRouter.use(requireAuth);

complianceRouter.get(
  "/dashboard",
  requireRoles(...BATCH_READ_ROLES),
  asyncHandler(async (req, res) => {
    await res.status(200).json(await complianceDashboard(req.user));
  }),
);
