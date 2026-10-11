import { z } from "zod";
import { isCalendarDate } from "../../lib/working-days.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const blankToUndefined = (value) => (value === "" || value === undefined ? undefined : value);

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

export const ASSESSOR_PAGE_SIZE_DEFAULT = 20;
export const ASSESSOR_PAGE_SIZE_MAX = 100;

const calendarDate = z.string().refine(isCalendarDate, "Expected YYYY-MM-DD");
const nameSchema = z.string().trim().min(1).max(200);
const codeSchema = z.string().trim().min(1).max(64);
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
const languageSchema = z.string().trim().min(1).max(80);
const qualificationSchema = z.string().trim().min(1).max(200);

const toaSchema = z
  .object({
    certNo: z.string().trim().min(1).max(64),
    issuedOn: calendarDate,
    expiresOn: calendarDate,
  })
  .strict()
  .refine((toa) => toa.expiresOn >= toa.issuedOn, {
    message: "expiresOn must be on or after issuedOn",
    path: ["expiresOn"],
  });

const activeQuery = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const assessorIdParamSchema = z.object({
  id: objectIdSchema,
});

export const createAssessorSchema = z
  .object({
    name: nameSchema,
    code: codeSchema.optional(),
    email: emailSchema.optional(),
    qualifications: z.array(qualificationSchema).optional(),
    yearsOfExperience: z.number().int().min(0).max(80).nullable().optional(),
    languages: z.array(languageSchema).optional(),
    toa: toaSchema.nullable().optional(),
    otherAaCount: z.number().int().min(0).max(99).optional(),
    undertaking: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const patchAssessorSchema = z
  .object({
    name: nameSchema.optional(),
    code: z.union([codeSchema, z.null()]).optional(),
    email: z.union([emailSchema, z.null()]).optional(),
    qualifications: z.array(qualificationSchema).optional(),
    yearsOfExperience: z.number().int().min(0).max(80).nullable().optional(),
    languages: z.array(languageSchema).optional(),
    toa: toaSchema.nullable().optional(),
    otherAaCount: z.number().int().min(0).max(99).optional(),
    undertaking: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export const listAssessorsQuerySchema = z.object({
  page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
  pageSize: queryNumber({
    min: 1,
    max: ASSESSOR_PAGE_SIZE_MAX,
    fallback: ASSESSOR_PAGE_SIZE_DEFAULT,
  }),
  active: activeQuery,
});

export const availableAssessorsQuerySchema = z
  .object({
    from: z.preprocess(blankToUndefined, calendarDate.optional()),
    to: z.preprocess(blankToUndefined, calendarDate.optional()),
    languages: z.preprocess((value) => {
      if (value === "" || value === undefined) return undefined;
      if (Array.isArray(value)) return value;
      return String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }, z.array(languageSchema).optional()),
    batchId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must be on or before to",
    path: ["from"],
  });
