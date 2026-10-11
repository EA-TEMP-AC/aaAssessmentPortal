import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  AWARDING_BODY_READ_ROLES,
  CENTRE_READ_ROLES,
  LEARNER_READ_ROLES,
  MASTER_DATA_WRITE_ROLES,
  QUALIFICATION_READ_ROLES,
  TRAINING_PARTNER_READ_ROLES,
} from "../../models/roles.js";
import {
  createAwardingBodySchema,
  createCentreSchema,
  createLearnerSchema,
  createQualificationSchema,
  createTrainingPartnerSchema,
  idParamSchema,
  listAwardingBodiesQuerySchema,
  listCentresQuerySchema,
  listLearnersQuerySchema,
  listQualificationsQuerySchema,
  listTrainingPartnersQuerySchema,
  patchAwardingBodySchema,
  patchCentreSchema,
  patchLearnerSchema,
  patchQualificationSchema,
  patchTrainingPartnerSchema,
} from "./master-data.schemas.js";
import {
  createAwardingBody,
  createCentre,
  createLearner,
  createQualification,
  createTrainingPartner,
  deactivateAwardingBody,
  deactivateCentre,
  deactivateTrainingPartner,
  deleteQualification,
  getAwardingBody,
  getCentre,
  getLearner,
  getQualification,
  getTrainingPartner,
  listAwardingBodies,
  listCentres,
  listLearners,
  listQualifications,
  listTrainingPartners,
  updateAwardingBody,
  updateCentre,
  updateLearner,
  updateQualification,
  updateTrainingPartner,
} from "./master-data.service.js";

function setAudit(req, entry) {
  req.audit = entry;
}

function mountReads(router, readRoles, handlers) {
  router.get(
    "/",
    requireRoles(...readRoles),
    asyncHandler(async (req, res) => {
      const query = handlers.listQuery.parse(req.query);
      await res.status(200).json(await handlers.list(req.user, query));
    }),
  );

  router.get(
    "/:id",
    requireRoles(...readRoles),
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      await res.status(200).json(await handlers.get(req.user, id));
    }),
  );
}

export const awardingBodiesRouter = Router();
export const trainingPartnersRouter = Router();
export const centresRouter = Router();
export const qualificationsRouter = Router();
export const learnersRouter = Router();

for (const router of [
  awardingBodiesRouter,
  trainingPartnersRouter,
  centresRouter,
  qualificationsRouter,
  learnersRouter,
]) {
  router.use(requireAuth);
}

awardingBodiesRouter.post(
  "/",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createAwardingBodySchema.parse(req.body);
    const created = await createAwardingBody(body);
    setAudit(req, {
      action: "awardingBody.create",
      entity: "awardingBody",
      entityId: created.id,
      abId: created.id,
      after: created,
    });
    await res.status(201).json(created);
  }),
);

mountReads(awardingBodiesRouter, AWARDING_BODY_READ_ROLES, {
  listQuery: listAwardingBodiesQuerySchema,
  list: listAwardingBodies,
  get: getAwardingBody,
});

awardingBodiesRouter.patch(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = patchAwardingBodySchema.parse(req.body);
    const saved = await updateAwardingBody(id, body);
    setAudit(req, {
      action: "awardingBody.update",
      entity: "awardingBody",
      entityId: saved.awardingBody.id,
      abId: saved.awardingBody.id,
      before: saved.before,
      after: saved.awardingBody,
    });
    await res.status(200).json(saved.awardingBody);
  }),
);

awardingBodiesRouter.delete(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const saved = await deactivateAwardingBody(id);
    setAudit(req, {
      action: "awardingBody.deactivate",
      entity: "awardingBody",
      entityId: saved.awardingBody.id,
      abId: saved.awardingBody.id,
      before: saved.before,
      after: saved.awardingBody,
    });
    await res.status(200).json(saved.awardingBody);
  }),
);

trainingPartnersRouter.post(
  "/",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createTrainingPartnerSchema.parse(req.body);
    const created = await createTrainingPartner(body);
    setAudit(req, {
      action: "trainingPartner.create",
      entity: "trainingPartner",
      entityId: created.id,
      after: created,
    });
    await res.status(201).json(created);
  }),
);

mountReads(trainingPartnersRouter, TRAINING_PARTNER_READ_ROLES, {
  listQuery: listTrainingPartnersQuerySchema,
  list: listTrainingPartners,
  get: getTrainingPartner,
});

trainingPartnersRouter.patch(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = patchTrainingPartnerSchema.parse(req.body);
    const saved = await updateTrainingPartner(id, body);
    setAudit(req, {
      action: "trainingPartner.update",
      entity: "trainingPartner",
      entityId: saved.trainingPartner.id,
      before: saved.before,
      after: saved.trainingPartner,
    });
    await res.status(200).json(saved.trainingPartner);
  }),
);

trainingPartnersRouter.delete(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const saved = await deactivateTrainingPartner(id);
    setAudit(req, {
      action: "trainingPartner.deactivate",
      entity: "trainingPartner",
      entityId: saved.trainingPartner.id,
      before: saved.before,
      after: saved.trainingPartner,
    });
    await res.status(200).json(saved.trainingPartner);
  }),
);

centresRouter.post(
  "/",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createCentreSchema.parse(req.body);
    const created = await createCentre(body);
    setAudit(req, {
      action: "centre.create",
      entity: "centre",
      entityId: created.id,
      after: created,
    });
    await res.status(201).json(created);
  }),
);

mountReads(centresRouter, CENTRE_READ_ROLES, {
  listQuery: listCentresQuerySchema,
  list: listCentres,
  get: getCentre,
});

centresRouter.patch(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = patchCentreSchema.parse(req.body);
    const saved = await updateCentre(id, body);
    setAudit(req, {
      action: "centre.update",
      entity: "centre",
      entityId: saved.centre.id,
      before: saved.before,
      after: saved.centre,
    });
    await res.status(200).json(saved.centre);
  }),
);

centresRouter.delete(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const saved = await deactivateCentre(id);
    setAudit(req, {
      action: "centre.deactivate",
      entity: "centre",
      entityId: saved.centre.id,
      before: saved.before,
      after: saved.centre,
    });
    await res.status(200).json(saved.centre);
  }),
);

qualificationsRouter.post(
  "/",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createQualificationSchema.parse(req.body);
    const created = await createQualification(body);
    setAudit(req, {
      action: "qualification.create",
      entity: "qualification",
      entityId: created.id,
      after: created,
    });
    await res.status(201).json(created);
  }),
);

mountReads(qualificationsRouter, QUALIFICATION_READ_ROLES, {
  listQuery: listQualificationsQuerySchema,
  list: listQualifications,
  get: getQualification,
});

qualificationsRouter.patch(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = patchQualificationSchema.parse(req.body);
    const saved = await updateQualification(id, body);
    setAudit(req, {
      action: "qualification.update",
      entity: "qualification",
      entityId: saved.qualification.id,
      before: saved.before,
      after: saved.qualification,
    });
    await res.status(200).json(saved.qualification);
  }),
);

qualificationsRouter.delete(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const deleted = await deleteQualification(id);
    setAudit(req, {
      action: "qualification.delete",
      entity: "qualification",
      entityId: deleted.id,
      before: deleted,
    });
    await res.status(204).send();
  }),
);

learnersRouter.post(
  "/",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createLearnerSchema.parse(req.body);
    const created = await createLearner(body);
    setAudit(req, {
      action: "learner.create",
      entity: "learner",
      entityId: created.id,
      after: created,
    });
    await res.status(201).json(created);
  }),
);

mountReads(learnersRouter, LEARNER_READ_ROLES, {
  listQuery: listLearnersQuerySchema,
  list: listLearners,
  get: getLearner,
});

learnersRouter.patch(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = patchLearnerSchema.parse(req.body);
    const saved = await updateLearner(id, body);
    setAudit(req, {
      action: "learner.update",
      entity: "learner",
      entityId: saved.learner.id,
      before: saved.before,
      after: saved.learner,
    });
    await res.status(200).json(saved.learner);
  }),
);
