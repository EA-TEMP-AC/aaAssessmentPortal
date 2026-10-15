import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { ASSESSOR_PAYMENT_READ_ROLES, ASSESSOR_PAYMENT_WRITE_ROLES } from "../../models/roles.js";
import {
  assessorPaymentBodySchema,
  batchIdParamSchema,
  listPaymentsQuerySchema,
} from "./assessor-payment.schemas.js";
import { forbidUnlessAbReviewerAllowed } from "./assessor-payment.access.js";
import { listPayments, savePayment } from "./assessor-payment.service.js";

/** GET /assessor-payments: the paged list across batches. */
export const assessorPaymentsRouter = Router();

assessorPaymentsRouter.use(requireAuth);

assessorPaymentsRouter.get(
  "/",
  requireRoles(...ASSESSOR_PAYMENT_READ_ROLES),
  asyncHandler(forbidUnlessAbReviewerAllowed),
  asyncHandler(async (req, res) => {
    const query = listPaymentsQuerySchema.parse(req.query);
    await res.status(200).json(await listPayments(req.user, query));
  }),
);

/**
 * Mounted on the batches router, after its requireAuth.
 * @param {import("express").Router} router
 */
export function mountAssessorPaymentRoutes(router) {
  router.put(
    "/:id/assessor-payment",
    requireRoles(...ASSESSOR_PAYMENT_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const body = assessorPaymentBodySchema.parse(req.body ?? {});
      const saved = await savePayment(req.user, id, body);
      req.audit = {
        action: "assessor_payment.save",
        entity: "assessorPayment",
        entityId: saved.payment.id,
        abId: saved.abId,
        batchId: id,
        before: saved.before,
        after: saved.payment,
      };
      await res.status(200).json(saved.payment);
    }),
  );

  router.get(
    "/:id/assessor-payments",
    requireRoles(...ASSESSOR_PAYMENT_READ_ROLES),
    asyncHandler(forbidUnlessAbReviewerAllowed),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const query = listPaymentsQuerySchema.parse(req.query);
      await res.status(200).json(await listPayments(req.user, query, { batchId: id }));
    }),
  );
}
