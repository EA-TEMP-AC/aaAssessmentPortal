import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { clientIp } from "../../lib/client-ip.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { BATCH_CREATE_ROLES, BATCH_READ_ROLES } from "../../models/roles.js";
import { rolesForAction } from "./batch-transitions.js";
import {
  acceptBodySchema,
  batchIdParamSchema,
  createBatchBodySchema,
  listBatchesQuerySchema,
  reasonBodySchema,
  rejectBodySchema,
} from "./batch.schemas.js";
import { createBatch, getBatch, listBatches, transitionBatch } from "./batch.service.js";

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
