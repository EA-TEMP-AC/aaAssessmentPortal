import { z } from "zod";
import { isCalendarDate } from "../../lib/working-days.js";
import {
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  SECURITY_AUDIT_STATUSES,
  SECURITY_AUDIT_TYPES,
} from "../../models/security-audit.model.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");
const calendarDate = z.string().refine(isCalendarDate, "Expected YYYY-MM-DD");

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

const pageQuery = {
  page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
  pageSize: queryNumber({ min: 1, max: PAGE_SIZE_MAX, fallback: PAGE_SIZE_DEFAULT }),
};

const blank = (value) => (value === "" ? undefined : value);
const optionalEnum = (values) => z.preprocess(blank, z.enum(values).optional());
const boolQuery = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const atLeastOne = (body) => Object.keys(body).length > 0;

export const idParamSchema = z.object({ id: objectIdSchema }).strict();

const auditor = z.string().trim().min(1).max(200);
const scope = z.string().trim().min(1).max(2000);

export const createAuditSchema = z
  .object({
    type: z.enum(SECURITY_AUDIT_TYPES),
    auditor,
    auditDate: calendarDate,
    scope,
    fixesDueDate: calendarDate.nullish(),
  })
  .strict()
  .refine((body) => !body.fixesDueDate || body.fixesDueDate >= body.auditDate, {
    message: "fixesDueDate must be on or after auditDate",
    path: ["fixesDueDate"],
  });

export const patchAuditSchema = z
  .object({
    type: z.enum(SECURITY_AUDIT_TYPES).optional(),
    auditor: auditor.optional(),
    auditDate: calendarDate.optional(),
    scope: scope.optional(),
    status: z.enum(SECURITY_AUDIT_STATUSES).optional(),
    fixesDueDate: calendarDate.nullish(),
    closedDate: calendarDate.optional(),
  })
  .strict()
  .refine(atLeastOne, { message: "At least one field is required" });

export const listAuditsQuerySchema = z
  .object({
    ...pageQuery,
    status: optionalEnum(SECURITY_AUDIT_STATUSES),
    type: optionalEnum(SECURITY_AUDIT_TYPES),
  })
  .strict();

const description = z.string().trim().min(1).max(4000);
const owner = z.string().trim().min(1).max(200);
const evidenceRef = z.string().trim().min(1).max(500);

export const createFindingSchema = z
  .object({
    severity: z.enum(FINDING_SEVERITIES),
    description,
    owner,
    dueDate: calendarDate,
    evidenceRef: evidenceRef.nullish(),
  })
  .strict();

export const patchFindingSchema = z
  .object({
    severity: z.enum(FINDING_SEVERITIES).optional(),
    description: description.optional(),
    owner: owner.optional(),
    status: z.enum(FINDING_STATUSES).optional(),
    dueDate: calendarDate.optional(),
    closedDate: calendarDate.optional(),
    evidenceRef: evidenceRef.nullish(),
  })
  .strict()
  .refine(atLeastOne, { message: "At least one field is required" });

export const listFindingsQuerySchema = z
  .object({
    ...pageQuery,
    auditId: z.preprocess(blank, objectIdSchema.optional()),
    severity: optionalEnum(FINDING_SEVERITIES),
    status: optionalEnum(FINDING_STATUSES),
    overdue: boolQuery,
  })
  .strict();

export const listAnomaliesQuerySchema = z
  .object({
    ...pageQuery,
    userId: z.preprocess(blank, objectIdSchema.optional()),
    day: z.preprocess(blank, calendarDate.optional()),
  })
  .strict();
