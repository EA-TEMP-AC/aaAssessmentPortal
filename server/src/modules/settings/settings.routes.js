import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { ACCESS_SETTINGS_READ_ROLES, ACCESS_SETTINGS_WRITE_ROLES } from "../../models/roles.js";
import { putAccessSettingsSchema } from "./settings.schemas.js";
import { getAccessSettings, saveAccessSettings } from "./settings.service.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get(
  "/access",
  requireRoles(...ACCESS_SETTINGS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    await res.status(200).json(await getAccessSettings());
  }),
);

settingsRouter.put(
  "/access",
  requireRoles(...ACCESS_SETTINGS_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = putAccessSettingsSchema.parse(req.body);
    const saved = await saveAccessSettings(body, req.user);
    req.audit = {
      action: "settings.access.update",
      entity: "settings",
      entityId: "access",
      before: saved.before,
      after: saved.settings,
    };
    await res.status(200).json(saved.settings);
  }),
);
