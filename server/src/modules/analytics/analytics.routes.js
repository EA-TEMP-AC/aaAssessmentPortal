import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { ANALYTICS_READ_ROLES } from "../../models/roles.js";
import { groupedQuerySchema, summaryQuerySchema } from "./analytics.schemas.js";
import { analyticsByDimension, analyticsSummary } from "./analytics.service.js";

/** GET /analytics/*. Read-only. aa_admin, mis, ncvet_viewer, and ab_reviewer (own awarding body). */
export const analyticsRouter = Router();

analyticsRouter.use(requireAuth, requireRoles(...ANALYTICS_READ_ROLES));

analyticsRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const query = summaryQuerySchema.parse(req.query);
    await res.status(200).json(await analyticsSummary(req.user, query));
  }),
);

const ROUTES = {
  "/by-assessor": "assessor",
  "/by-training-partner": "training-partner",
  "/by-job-role": "job-role",
  "/by-state": "state",
};

for (const [path, dimension] of Object.entries(ROUTES)) {
  analyticsRouter.get(
    path,
    asyncHandler(async (req, res) => {
      const query = groupedQuerySchema.parse(req.query);
      await res.status(200).json(await analyticsByDimension(req.user, dimension, query));
    }),
  );
}
