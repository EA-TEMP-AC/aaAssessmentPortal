import { z } from "zod";
import { isCalendarDate } from "../../lib/working-days.js";

const optionalQuery = (schema) =>
  z.preprocess((value) => (value === "" || value === undefined ? undefined : value), schema);

const calendarDate = z.string().refine(isCalendarDate, { message: "Invalid date" });

export const putWorkingDayConfigSchema = z
  .object({
    weekendDays: z
      .array(z.number().int().min(0).max(6))
      .max(6)
      .refine((days) => new Set(days).size === days.length, {
        message: "weekendDays must be unique",
      }),
  })
  .strict();

export const createHolidaySchema = z
  .object({
    date: calendarDate,
    name: z.string().trim().min(1).max(200),
    region: z.union([z.string().trim().min(1).max(64), z.null()]).optional(),
  })
  .strict();

export const holidayIdParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id"),
});

export const listHolidaysQuerySchema = z
  .object({
    from: optionalQuery(calendarDate.optional()),
    to: optionalQuery(calendarDate.optional()),
    region: optionalQuery(z.string().trim().min(1).max(64).optional()),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "`from` must be before or equal to `to`",
    path: ["from"],
  });
