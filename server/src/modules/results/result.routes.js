import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { clientIp } from "../../lib/client-ip.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  RESULT_CHANGE_LOG_ROLES,
  RESULT_READ_ROLES,
  RESULT_WRITE_ROLES,
} from "../../models/roles.js";
import { rolesForAction } from "../batches/batch-transitions.js";
import {
  idParamSchema,
  resultsBodySchema,
  returnForCorrectionBodySchema,
  reviewBodySchema,
  submitResultBodySchema,
} from "./result.schemas.js";
import {
  getResults,
  listChangeLog,
  returnForCorrection,
  reviewResult,
  saveResults,
  submitResult,
} from "./result.service.js";

function postResultMove(router, action, schema, handler) {
  router.post(
    `/:id/${action}`,
    requireRoles(...rolesForAction(action)),
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const body = schema.parse(req.body ?? {});
      const saved = await handler(req.user, id, body, { ip: clientIp(req) });
      req.audit = {
        action: `batch.${action}`,
        entity: "batch",
        entityId: id,
        abId: saved.abId,
        batchId: id,
        before: saved.before,
        after: saved.after,
        ...(saved.meta ? { meta: saved.meta } : {}),
      };
      await res.status(200).json(saved.result);
    }),
  );
}

/**
 * Result routes under /api/v1/batches/:id. docs/SCHEMA.md §3.14.
 * Mounted on the batches router (already behind requireAuth).
 * dispute and resolve-dispute are deliberately not mounted: disputes are deferred.
 * @param {import("express").Router} router
 */
export function mountResultRoutes(router) {
  router.put(
    "/:id/results",
    requireRoles(...RESULT_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const body = resultsBodySchema.parse(req.body);
      const saved = await saveResults(req.user, id, body);
      req.audit = {
        action: "result.save",
        entity: "result",
        entityId: saved.result.id,
        abId: saved.abId,
        batchId: id,
        before: saved.before,
        after: saved.result,
      };
      await res.status(200).json(saved.result);
    }),
  );

  router.get(
    "/:id/results",
    requireRoles(...RESULT_READ_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      await res.status(200).json(await getResults(req.user, id));
    }),
  );

  postResultMove(router, "submit-result", submitResultBodySchema, submitResult);
  postResultMove(router, "validate", reviewBodySchema, (user, id, body, context) =>
    reviewResult(user, id, "validate", body, context),
  );
  postResultMove(router, "publish", reviewBodySchema, (user, id, body, context) =>
    reviewResult(user, id, "publish", body, context),
  );
  postResultMove(
    router,
    "return-for-correction",
    returnForCorrectionBodySchema,
    returnForCorrection,
  );
}

/** GET /api/v1/results/:id/change-log. */
export const resultsRouter = Router();

resultsRouter.use(requireAuth);

resultsRouter.get(
  "/:id/change-log",
  requireRoles(...RESULT_CHANGE_LOG_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await res.status(200).json(await listChangeLog(req.user, id));
  }),
);
