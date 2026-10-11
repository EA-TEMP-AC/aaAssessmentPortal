import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

export const PROCTOR_PAGE_SIZE_DEFAULT = 20;
export const PROCTOR_PAGE_SIZE_MAX = 100;

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

const activeQuery = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const proctorIdParamSchema = z.object({
  id: objectIdSchema,
});

export const createProctorSchema = z
  .object({
    name: nameSchema,
    code: codeSchema.optional(),
    email: emailSchema.optional(),
    qualifications: z.array(qualificationSchema).optional(),
    languages: z.array(languageSchema).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const patchProctorSchema = z
  .object({
    name: nameSchema.optional(),
    code: z.union([codeSchema, z.null()]).optional(),
    email: z.union([emailSchema, z.null()]).optional(),
    qualifications: z.array(qualificationSchema).optional(),
    languages: z.array(languageSchema).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export const listProctorsQuerySchema = z.object({
  page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
  pageSize: queryNumber({
    min: 1,
    max: PROCTOR_PAGE_SIZE_MAX,
    fallback: PROCTOR_PAGE_SIZE_DEFAULT,
  }),
  active: activeQuery,
});
