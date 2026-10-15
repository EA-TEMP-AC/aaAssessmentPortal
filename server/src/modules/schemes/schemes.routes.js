import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { SCHEME_READ_ROLES, SCHEME_WRITE_ROLES } from "../../models/roles.js";
import {
  createProjectSchema,
  createSchemeSchema,
  createSignatorySchema,
  idParamSchema,
  listProjectsQuerySchema,
  listSchemesQuerySchema,
  listSignatoriesQuerySchema,
  patchProjectSchema,
  patchSchemeSchema,
  patchSignatorySchema,
} from "./schemes.schemas.js";
import {
  createProject,
  createScheme,
  createSignatory,
  deactivateProject,
  deactivateScheme,
  deactivateSignatory,
  getProject,
  getScheme,
  getSignatory,
  listProjects,
  listSchemes,
  listSignatories,
  updateProject,
  updateScheme,
  updateSignatory,
} from "./schemes.service.js";

const REDACTED = "[redacted]";

/** A signatory's name is personal data, so audit rows keep everything but the name. */
function signatoryAuditView(row) {
  return row ? { ...row, name: REDACTED } : row;
}

function redactBodyName(req) {
  if (req.body && typeof req.body === "object" && "name" in req.body) {
    req.body = { ...req.body, name: REDACTED };
  }
}

/**
 * Mounts POST, GET list, GET one, PATCH and DELETE (deactivate) for one collection.
 * `key` is the property the update and deactivate services return the saved row under.
 */
function mountCrud(router, { entity, key, schemas, service, view = (row) => row, onBody }) {
  router.use(requireAuth);

  router.post(
    "/",
    requireRoles(...SCHEME_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const body = schemas.create.parse(req.body);
      const created = await service.create(body);
      onBody?.(req);
      req.audit = {
        action: `${entity}.create`,
        entity,
        entityId: created.id,
        after: view(created),
      };
      await res.status(201).json(created);
    }),
  );

  router.get(
    "/",
    requireRoles(...SCHEME_READ_ROLES),
    asyncHandler(async (req, res) => {
      const query = schemas.list.parse(req.query);
      await res.status(200).json(await service.list(query));
    }),
  );

  router.get(
    "/:id",
    requireRoles(...SCHEME_READ_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      await res.status(200).json(await service.get(id));
    }),
  );

  router.patch(
    "/:id",
    requireRoles(...SCHEME_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const body = schemas.patch.parse(req.body);
      const saved = await service.update(id, body);
      onBody?.(req);
      req.audit = {
        action: `${entity}.update`,
        entity,
        entityId: saved[key].id,
        before: view(saved.before),
        after: view(saved[key]),
      };
      await res.status(200).json(saved[key]);
    }),
  );

  router.delete(
    "/:id",
    requireRoles(...SCHEME_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = idParamSchema.parse(req.params);
      const saved = await service.deactivate(id);
      req.audit = {
        action: `${entity}.deactivate`,
        entity,
        entityId: saved[key].id,
        before: view(saved.before),
        after: view(saved[key]),
      };
      await res.status(200).json(saved[key]);
    }),
  );
}

export const schemesRouter = Router();
export const projectsRouter = Router();
export const signatoriesRouter = Router();

mountCrud(schemesRouter, {
  entity: "scheme",
  key: "scheme",
  schemas: { create: createSchemeSchema, patch: patchSchemeSchema, list: listSchemesQuerySchema },
  service: {
    create: createScheme,
    list: listSchemes,
    get: getScheme,
    update: updateScheme,
    deactivate: deactivateScheme,
  },
});

mountCrud(projectsRouter, {
  entity: "project",
  key: "project",
  schemas: {
    create: createProjectSchema,
    patch: patchProjectSchema,
    list: listProjectsQuerySchema,
  },
  service: {
    create: createProject,
    list: listProjects,
    get: getProject,
    update: updateProject,
    deactivate: deactivateProject,
  },
});

mountCrud(signatoriesRouter, {
  entity: "signatory",
  key: "signatory",
  schemas: {
    create: createSignatorySchema,
    patch: patchSignatorySchema,
    list: listSignatoriesQuerySchema,
  },
  service: {
    create: createSignatory,
    list: listSignatories,
    get: getSignatory,
    update: updateSignatory,
    deactivate: deactivateSignatory,
  },
  view: signatoryAuditView,
  onBody: redactBodyName,
});
