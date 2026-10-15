import { z } from "zod";
import { isCalendarDate } from "../../lib/working-days.js";
import { SIGNATORY_SCOPES } from "../../models/signatory.model.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");
const nameSchema = z.string().trim().min(1).max(200);
const codeSchema = z.string().trim().min(1).max(64);
const calendarDate = z.string().refine(isCalendarDate, "Expected YYYY-MM-DD");

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

const blankToUndefined = (value) => (value === "" || value === undefined ? undefined : value);

const pageQuery = {
  page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
  pageSize: queryNumber({ min: 1, max: PAGE_SIZE_MAX, fallback: PAGE_SIZE_DEFAULT }),
};

const activeQuery = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const atLeastOne = (body) => Object.keys(body).length > 0;

export const idParamSchema = z.object({ id: objectIdSchema });

export const createSchemeSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    fundingBody: nameSchema,
    active: z.boolean().optional(),
  })
  .strict();

export const patchSchemeSchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    fundingBody: nameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(atLeastOne, { message: "At least one field is required" });

export const listSchemesQuerySchema = z.object({ ...pageQuery, active: activeQuery });

export const createProjectSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    schemeId: objectIdSchema,
    startDate: calendarDate,
    endDate: calendarDate.nullish(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => !body.endDate || body.endDate >= body.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const patchProjectSchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    schemeId: objectIdSchema.optional(),
    startDate: calendarDate.optional(),
    endDate: calendarDate.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(atLeastOne, { message: "At least one field is required" })
  .refine((body) => !body.startDate || !body.endDate || body.endDate >= body.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const listProjectsQuerySchema = z.object({
  ...pageQuery,
  active: activeQuery,
  schemeId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
});

const windowRule = {
  message: "validTo must be on or after validFrom",
  path: ["validTo"],
};

/** scheme needs schemeId only, project needs projectId only, agency needs neither. */
export function signatoryScopeIssues(row) {
  const issues = [];
  const want = {
    scheme: { schemeId: true, projectId: false },
    project: { schemeId: false, projectId: true },
    agency: { schemeId: false, projectId: false },
  }[row.scope];
  if (!want) return issues;
  for (const key of ["schemeId", "projectId"]) {
    if (want[key] && !row[key]) issues.push({ path: key, message: `${key} is required` });
    if (!want[key] && row[key]) {
      issues.push({ path: key, message: `${key} must be empty for scope ${row.scope}` });
    }
  }
  return issues;
}

export const createSignatorySchema = z
  .object({
    name: nameSchema,
    designation: nameSchema,
    scope: z.enum(SIGNATORY_SCOPES),
    schemeId: objectIdSchema.nullish(),
    projectId: objectIdSchema.nullish(),
    validFrom: calendarDate,
    validTo: calendarDate.nullish(),
    active: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    for (const issue of signatoryScopeIssues(body)) {
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
  })
  .refine((body) => !body.validTo || body.validTo >= body.validFrom, windowRule);

/** PATCH may change the scope; the service checks the merged row with the same rules. */
export const patchSignatorySchema = z
  .object({
    name: nameSchema.optional(),
    designation: nameSchema.optional(),
    scope: z.enum(SIGNATORY_SCOPES).optional(),
    schemeId: objectIdSchema.nullable().optional(),
    projectId: objectIdSchema.nullable().optional(),
    validFrom: calendarDate.optional(),
    validTo: calendarDate.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine(atLeastOne, { message: "At least one field is required" })
  .refine((body) => !body.validFrom || !body.validTo || body.validTo >= body.validFrom, windowRule);

export const listSignatoriesQuerySchema = z.object({
  ...pageQuery,
  active: activeQuery,
  scope: z.preprocess(blankToUndefined, z.enum(SIGNATORY_SCOPES).optional()),
  schemeId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
  projectId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
});
