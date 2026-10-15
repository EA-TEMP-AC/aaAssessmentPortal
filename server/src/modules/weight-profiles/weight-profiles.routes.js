import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  WEIGHT_PROFILE_APPROVE_ROLES,
  WEIGHT_PROFILE_READ_ROLES,
  WEIGHT_PROFILE_WRITE_ROLES,
} from "../../models/roles.js";
import {
  approveSchema,
  createSchema,
  editSchema,
  getQuerySchema,
  idParamSchema,
  listQuerySchema,
} from "./weight-profiles.schemas.js";
import {
  approveProfile,
  createProfile,
  editProfile,
  getProfile,
  listProfiles,
  listVersions,
} from "./weight-profiles.service.js";

export const weightProfileRouter = Router();

weightProfileRouter.use(requireAuth);

/** Audit rows hold ids, name, version, status and the percentages. Nothing personal. */
function auditView(profile) {
  const p = typeof profile.toObject === "function" ? profile.toObject() : profile;
  return {
    rootProfileId: p.rootProfileId,
    version: p.version,
    name: p.name,
    qualificationId: p.qualificationId,
    difficultyWeights: p.difficultyWeights,
    bloomWeights: p.bloomWeights,
    status: p.status,
  };
}

/** POST /api/v1/weight-profiles */
weightProfileRouter.post(
  "/",
  requireRoles(...WEIGHT_PROFILE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const profile = await createProfile(req.user, createSchema.parse(req.body));
    req.audit = {
      action: "weight_profile.create",
      entity: "weightProfile",
      entityId: profile.rootProfileId,
      after: auditView(profile),
    };
    res.status(201).json(profile);
  }),
);

/** GET /api/v1/weight-profiles */
weightProfileRouter.get(
  "/",
  requireRoles(...WEIGHT_PROFILE_READ_ROLES),
  asyncHandler(async (req, res) => {
    res.status(200).json(await listProfiles(listQuerySchema.parse(req.query)));
  }),
);

/** GET /api/v1/weight-profiles/:id/versions */
weightProfileRouter.get(
  "/:id/versions",
  requireRoles(...WEIGHT_PROFILE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await listVersions(id));
  }),
);

/** POST /api/v1/weight-profiles/:id/approve */
weightProfileRouter.post(
  "/:id/approve",
  requireRoles(...WEIGHT_PROFILE_APPROVE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { version } = approveSchema.parse(req.body ?? {});
    const { profile, before } = await approveProfile(req.user, id, version);
    req.audit = {
      action: "weight_profile.approve",
      entity: "weightProfile",
      entityId: profile.rootProfileId,
      before: auditView(before),
      after: auditView(profile),
    };
    res.status(200).json(profile);
  }),
);

/** GET /api/v1/weight-profiles/:id  (?version=n, default the latest) */
weightProfileRouter.get(
  "/:id",
  requireRoles(...WEIGHT_PROFILE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { version } = getQuerySchema.parse(req.query);
    res.status(200).json(await getProfile(id, version));
  }),
);

/** PATCH /api/v1/weight-profiles/:id  Creates a new draft version. */
weightProfileRouter.patch(
  "/:id",
  requireRoles(...WEIGHT_PROFILE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { profile, previous } = await editProfile(req.user, id, editSchema.parse(req.body));
    req.audit = {
      action: "weight_profile.edit",
      entity: "weightProfile",
      entityId: profile.rootProfileId,
      before: auditView(previous),
      after: auditView(profile),
    };
    res.status(200).json(profile);
  }),
);
