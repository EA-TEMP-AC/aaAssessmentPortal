import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  ASSESSOR_AVAILABLE_ROLES,
  ASSESSOR_READ_ROLES,
  MASTER_DATA_WRITE_ROLES,
} from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
import {
  assessorIdParamSchema,
  availableAssessorsQuerySchema,
  createAssessorSchema,
  listAssessorsQuerySchema,
  patchAssessorSchema,
} from "./assessor.schemas.js";
import {
  createAssessor,
  deactivateAssessor,
  getAssessor,
  listAssessors,
  listAvailableAssessors,
  updateAssessor,
} from "./assessor.service.js";

function setAudit(req, entry) {
  req.audit = entry;
}

export const assessorsRouter = Router();

const ASSESSOR_PII_FIELDS = ["name", "email"];

assessorsRouter.use(requireAuth);

assessorsRouter.post(
  "/",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createAssessorSchema.parse(req.body);
    const created = await createAssessor(body);
    setAudit(req, {
      action: "assessor.create",
      entity: "assessor",
      entityId: created.id,
      after: created,
    });
    await res.status(201).json(created);
  }),
);

assessorsRouter.get(
  "/available",
  requireRoles(...ASSESSOR_AVAILABLE_ROLES),
  asyncHandler(async (req, res) => {
    const query = availableAssessorsQuerySchema.parse(req.query);
    const body = await listAvailableAssessors(query);
    await recordAccess(req, {
      subjectType: "assessor",
      subjectIds: body.items.map((item) => item.id),
      kind: "list",
      fields: ASSESSOR_PII_FIELDS,
    });
    await res.status(200).json(body);
  }),
);

assessorsRouter.get(
  "/",
  requireRoles(...ASSESSOR_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listAssessorsQuerySchema.parse(req.query);
    const body = await listAssessors(req.user, query);
    await recordAccess(req, {
      subjectType: "assessor",
      subjectIds: body.items.map((item) => item.id),
      kind: "list",
      fields: ASSESSOR_PII_FIELDS,
    });
    await res.status(200).json(body);
  }),
);

assessorsRouter.get(
  "/:id",
  requireRoles(...ASSESSOR_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = assessorIdParamSchema.parse(req.params);
    const body = await getAssessor(req.user, id);
    await recordAccess(req, {
      subjectType: "assessor",
      subjectIds: [body.id],
      kind: "detail",
      fields: ASSESSOR_PII_FIELDS,
    });
    await res.status(200).json(body);
  }),
);

assessorsRouter.patch(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = assessorIdParamSchema.parse(req.params);
    const body = patchAssessorSchema.parse(req.body);
    const saved = await updateAssessor(id, body);
    setAudit(req, {
      action: "assessor.update",
      entity: "assessor",
      entityId: saved.assessor.id,
      before: saved.before,
      after: saved.assessor,
    });
    await res.status(200).json(saved.assessor);
  }),
);

assessorsRouter.delete(
  "/:id",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = assessorIdParamSchema.parse(req.params);
    const saved = await deactivateAssessor(id);
    setAudit(req, {
      action: "assessor.deactivate",
      entity: "assessor",
      entityId: saved.assessor.id,
      before: saved.before,
      after: saved.assessor,
    });
    await res.status(200).json(saved.assessor);
  }),
);
