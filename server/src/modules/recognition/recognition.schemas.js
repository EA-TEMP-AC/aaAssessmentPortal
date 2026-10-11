import { z } from "zod";
import { SECTOR_NAMES, STATE_UTS } from "../../config/annexure.js";
import { isCalendarDate } from "../../lib/working-days.js";

const sectorName = z.string().refine((value) => SECTOR_NAMES.includes(value), {
  message: "Expected an Annexure II sector",
});

const stateName = z.string().refine((value) => STATE_UTS.includes(value), {
  message: "Expected an Annexure IV state",
});

const calendarDate = z.string().refine(isCalendarDate, "Expected YYYY-MM-DD");

function unique(values) {
  return new Set(values).size === values.length;
}

export const putRecognitionSchema = z
  .object({
    sectors: z.array(sectorName).min(1),
    panIndia: z.boolean(),
    states: z.array(stateName),
    startDate: calendarDate,
    endDate: calendarDate,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!unique(body.sectors)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sectors must be unique",
        path: ["sectors"],
      });
    }
    if (!unique(body.states)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "states must be unique",
        path: ["states"],
      });
    }
    if (body.panIndia && body.states.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "panIndia requires an empty states list",
        path: ["states"],
      });
    }
    if (!body.panIndia && body.states.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "states are required when panIndia is false",
        path: ["states"],
      });
    }
    if (body.endDate < body.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endDate must be on or after startDate",
        path: ["endDate"],
      });
    }
  });
