import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { WORKING_DAY_ROLES } from "../../models/roles.js";
import {
  createHolidaySchema,
  holidayIdParamSchema,
  listHolidaysQuerySchema,
  putWorkingDayConfigSchema,
} from "./working-days.schemas.js";
import {
  createHoliday,
  deleteHoliday,
  getWorkingDayConfig,
  listHolidays,
  saveWorkingDayConfig,
} from "./working-days.service.js";

export const workingDayConfigRouter = Router();
export const holidaysRouter = Router();

workingDayConfigRouter.use(requireAuth, requireRoles(...WORKING_DAY_ROLES));
holidaysRouter.use(requireAuth, requireRoles(...WORKING_DAY_ROLES));

workingDayConfigRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    await res.status(200).json(await getWorkingDayConfig());
  }),
);

workingDayConfigRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const body = putWorkingDayConfigSchema.parse(req.body);
    const saved = await saveWorkingDayConfig(body, req.user);
    req.audit = {
      action: "workingDayConfig.update",
      entity: "workingDayConfig",
      entityId: saved.config.id,
      before: saved.before,
      after: saved.config,
    };
    await res.status(200).json(saved.config);
  }),
);

holidaysRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listHolidaysQuerySchema.parse(req.query);
    await res.status(200).json(await listHolidays(query));
  }),
);

holidaysRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createHolidaySchema.parse(req.body);
    const created = await createHoliday(body, req.user);
    req.audit = {
      action: "holiday.create",
      entity: "holiday",
      entityId: created.id,
      after: created,
    };
    await res.status(201).json(created);
  }),
);

holidaysRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = holidayIdParamSchema.parse(req.params);
    const deleted = await deleteHoliday(id);
    req.audit = {
      action: "holiday.delete",
      entity: "holiday",
      entityId: deleted.id,
      before: deleted,
    };
    await res.status(204).send();
  }),
);
