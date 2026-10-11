import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { MASTER_DATA_WRITE_ROLES, PROCTOR_READ_ROLES } from "../../models/roles.js";
import {
  createProctorSchema,
  listProctorsQuerySchema,
  patchProctorSchema,
  proctorIdParamSchema,
} from "./proctor.schemas.js";
import {
  createProctor,
  deactivateProctor,
  getProctor,
  listProctors,
  updateProctor,
} from "./proctor.service.js";

function setAudit(req, entry) {
  req.audit = entry;
}

export const proctorsRouter = Router();

proctorsRouter.use(requireAuth);

proctorsRouter.post(
  "/",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createProctorSchema.parse(req.body);
    const created = await createProctor(body);
    setAudit(req, {
      action: "proctor.create",
      entity: "proctor",
      entityId: created.id,
      after: created,
    });
    await res.status(201).json(created);
  }),
);

proctorsRouter.get(
  "/",
  requireRoles(...PROCTOR_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listProctorsQuerySchema.parse(req.query);
    await res.status(200).json(await listProctors(req.user, query));
  }),
);

proctorsRouter.get(
  "/:id",
  requireRoles(...PROCTOR_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = proctorIdParamSchema.parse(req.params);
    await res.status(200).json(await getProctor(req.user, id));
  }),
);

proctorsRouter.patch(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = proctorIdParamSchema.parse(req.params);
    const body = patchProctorSchema.parse(req.body);
    const saved = await updateProctor(id, body);
    setAudit(req, {
      action: "proctor.update",
      entity: "proctor",
      entityId: saved.proctor.id,
      before: saved.before,
      after: saved.proctor,
    });
    await res.status(200).json(saved.proctor);
  }),
);

proctorsRouter.delete(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = proctorIdParamSchema.parse(req.params);
    const saved = await deactivateProctor(id);
    setAudit(req, {
      action: "proctor.deactivate",
      entity: "proctor",
      entityId: saved.proctor.id,
      before: saved.before,
      after: saved.proctor,
    });
    await res.status(200).json(saved.proctor);
  }),
);
