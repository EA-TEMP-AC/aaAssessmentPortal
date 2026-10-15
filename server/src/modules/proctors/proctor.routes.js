import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { MASTER_DATA_WRITE_ROLES, PROCTOR_READ_ROLES } from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
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

const PROCTOR_PII_FIELDS = ["name", "email"];

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
    const body = await listProctors(req.user, query);
    await recordAccess(req, {
      subjectType: "proctor",
      subjectIds: body.items.map((item) => item.id),
      kind: "list",
      fields: PROCTOR_PII_FIELDS,
    });
    await res.status(200).json(body);
  }),
);

proctorsRouter.get(
  "/:id",
  requireRoles(...PROCTOR_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = proctorIdParamSchema.parse(req.params);
    const body = await getProctor(req.user, id);
    await recordAccess(req, {
      subjectType: "proctor",
      subjectIds: [body.id],
      kind: "detail",
      fields: PROCTOR_PII_FIELDS,
    });
    await res.status(200).json(body);
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
