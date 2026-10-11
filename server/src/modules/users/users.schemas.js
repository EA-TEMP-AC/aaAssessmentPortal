import { z } from "zod";
import { USER_ROLES } from "../../models/roles.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

/** Admin-set passwords. Project minimum; the contract example is longer. See DECISIONS.md. */
const passwordSchema = z.string().min(8).max(200);

const blankToUndefined = (value) => (value === "" || value === undefined ? undefined : value);

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

export const USER_PAGE_SIZE_DEFAULT = 20;
export const USER_PAGE_SIZE_MAX = 100;

export const createUserBodySchema = z
  .object({
    email: z.string().trim().email().max(320),
    name: z.string().trim().min(1).max(200),
    role: z.enum(USER_ROLES),
    password: passwordSchema,
    linkedProfileId: objectIdSchema.optional(),
    abId: objectIdSchema.optional(),
    tpId: objectIdSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const patchUserBodySchema = z
  .object({
    email: z.string().trim().email().max(320).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    role: z.enum(USER_ROLES).optional(),
    active: z.boolean().optional(),
    linkedProfileId: z.union([objectIdSchema, z.null()]).optional(),
    abId: z.union([objectIdSchema, z.null()]).optional(),
    tpId: z.union([objectIdSchema, z.null()]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export const passwordResetBodySchema = z
  .object({
    newPassword: passwordSchema.optional(),
    sendEmail: z.literal(true).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const modes = [body.newPassword != null, body.sendEmail === true].filter(Boolean).length;
    if (modes !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide newPassword or sendEmail, not both",
        path: ["newPassword"],
      });
    }
  });

export const userIdParamSchema = z.object({
  id: objectIdSchema,
});

export const listUsersQuerySchema = z.object({
  role: z.preprocess(blankToUndefined, z.enum(USER_ROLES).optional()),
  active: z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean().optional()),
  page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
  pageSize: queryNumber({
    min: 1,
    max: USER_PAGE_SIZE_MAX,
    fallback: USER_PAGE_SIZE_DEFAULT,
  }),
});
