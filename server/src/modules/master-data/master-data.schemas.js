import { z } from "zod";
import { RATIO_CLASSES, SECTOR_NAMES, STATE_UTS } from "../../config/annexure.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const blankToUndefined = (value) => (value === "" || value === undefined ? undefined : value);

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

export const MASTER_PAGE_SIZE_DEFAULT = 20;
export const MASTER_PAGE_SIZE_MAX = 100;

const pageQuery = {
  page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
  pageSize: queryNumber({
    min: 1,
    max: MASTER_PAGE_SIZE_MAX,
    fallback: MASTER_PAGE_SIZE_DEFAULT,
  }),
};

const activeQuery = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const nameSchema = z.string().trim().min(1).max(200);
const codeSchema = z.string().trim().min(1).max(64);
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());

const sectorName = z.string().refine((value) => SECTOR_NAMES.includes(value), {
  message: "Expected an Annexure II sector",
});
const stateName = z.string().refine((value) => STATE_UTS.includes(value), {
  message: "Expected an Annexure IV state",
});
const ratioClass = z.enum(RATIO_CLASSES);
const BATCH_TYPES = ["STT", "LTT"];
const PASS_CRITERIA_MODES = ["nos_wise", "overall"];
const PASS_MARK_UNITS = ["percent", "absolute"];

function uniqueStrings(values) {
  return new Set(values).size === values.length;
}

const componentSchema = z
  .object({
    theory: z.number().finite(),
    practical: z.number().finite(),
    viva: z.number().finite(),
  })
  .strict();

const nullableComponentSchema = z
  .object({
    theory: z.number().finite().nullable(),
    practical: z.number().finite().nullable(),
    viva: z.number().finite().nullable(),
  })
  .strict();

const pcSchema = z
  .object({
    pcId: codeSchema,
    code: codeSchema,
    name: nameSchema,
    passMark: z.number().finite().optional(),
    maxMark: z.number().finite().nullable().optional(),
  })
  .strict();

const nosSchema = z
  .object({
    nosId: codeSchema,
    code: codeSchema,
    name: nameSchema,
    maxMarks: nullableComponentSchema.optional(),
    pcs: z.array(pcSchema),
  })
  .strict();

function refineNos(nos, ctx) {
  if (!nos) return;
  const nosIds = [];
  const nosCodes = [];
  const pcIds = [];
  for (const [nosIndex, item] of nos.entries()) {
    nosIds.push(item.nosId);
    nosCodes.push(item.code);
    const pcCodes = [];
    for (const [pcIndex, pc] of item.pcs.entries()) {
      pcIds.push(pc.pcId);
      pcCodes.push(pc.code);
      if (pcCodes.filter((code) => code === pc.code).length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate PC code in this NOS",
          path: ["nos", nosIndex, "pcs", pcIndex, "code"],
        });
      }
    }
  }
  if (!uniqueStrings(nosIds)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "nosId values must be unique",
      path: ["nos"],
    });
  }
  if (!uniqueStrings(nosCodes)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "NOS codes must be unique",
      path: ["nos"],
    });
  }
  if (!uniqueStrings(pcIds)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "pcId values must be unique",
      path: ["nos"],
    });
  }
}

export const idParamSchema = z.object({
  id: objectIdSchema,
});

export const createAwardingBodySchema = z
  .object({
    name: nameSchema,
    code: codeSchema.optional(),
    notificationEmails: z.array(emailSchema).min(1),
    active: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!uniqueStrings(body.notificationEmails)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "notificationEmails must be unique",
        path: ["notificationEmails"],
      });
    }
  });

export const patchAwardingBodySchema = z
  .object({
    name: nameSchema.optional(),
    code: z.union([codeSchema, z.null()]).optional(),
    notificationEmails: z.array(emailSchema).min(1).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.notificationEmails && !uniqueStrings(body.notificationEmails)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "notificationEmails must be unique",
        path: ["notificationEmails"],
      });
    }
  })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export const listAwardingBodiesQuerySchema = z.object({
  ...pageQuery,
  active: activeQuery,
});

export const createTrainingPartnerSchema = z
  .object({
    name: nameSchema,
    code: codeSchema.optional(),
    email: emailSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const patchTrainingPartnerSchema = z
  .object({
    name: nameSchema.optional(),
    code: z.union([codeSchema, z.null()]).optional(),
    email: z.union([emailSchema, z.null()]).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export const listTrainingPartnersQuerySchema = z.object({
  ...pageQuery,
  active: activeQuery,
});

export const createCentreSchema = z
  .object({
    name: nameSchema,
    code: codeSchema.optional(),
    tpId: objectIdSchema,
    state: stateName,
    email: emailSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const patchCentreSchema = z
  .object({
    name: nameSchema.optional(),
    code: z.union([codeSchema, z.null()]).optional(),
    tpId: objectIdSchema.optional(),
    state: stateName.optional(),
    email: z.union([emailSchema, z.null()]).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export const listCentresQuerySchema = z.object({
  ...pageQuery,
  active: activeQuery,
  tpId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
});

export const createQualificationSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    sector: sectorName,
    ratioClass,
    defaultBatchType: z.enum(BATCH_TYPES).optional(),
    passCriteriaMode: z.enum(PASS_CRITERIA_MODES).optional(),
    passMarkUnit: z.enum(PASS_MARK_UNITS).optional(),
    passMarks: componentSchema,
    maxMarks: nullableComponentSchema.nullable().optional(),
    nos: z.array(nosSchema),
    pcPassMarksRequired: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => refineNos(body.nos, ctx));

export const patchQualificationSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    sector: sectorName.optional(),
    ratioClass: ratioClass.optional(),
    defaultBatchType: z.union([z.enum(BATCH_TYPES), z.null()]).optional(),
    passCriteriaMode: z.union([z.enum(PASS_CRITERIA_MODES), z.null()]).optional(),
    passMarkUnit: z.enum(PASS_MARK_UNITS).optional(),
    passMarks: componentSchema.optional(),
    maxMarks: nullableComponentSchema.nullable().optional(),
    nos: z.array(nosSchema).optional(),
    pcPassMarksRequired: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => refineNos(body.nos, ctx))
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export const listQualificationsQuerySchema = z.object({
  ...pageQuery,
  sector: z.preprocess(blankToUndefined, sectorName.optional()),
});

const phoneSchema = z.string().trim().min(1).max(32);
const externalRefSchema = z.string().trim().min(1).max(64);
const fatherNameSchema = z.string().trim().min(1).max(200);
const addressSchema = z.string().trim().min(1).max(500);
const enrolmentSchema = z.string().trim().min(1).max(64);
const genderSchema = z.enum(["Male", "Female", "Other"]);
/** Twelve digits (spaces and dashes allowed), first digit 2 to 9. Stored as digits only. */
const aadhaarSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .refine((v) => /^[2-9]\d{11}$/.test(v), { message: "Expected a 12 digit Aadhaar number" });

export const createLearnerSchema = z
  .object({
    name: nameSchema,
    externalRef: externalRefSchema.optional(),
    phone: phoneSchema.optional(),
    enrolmentNumber: enrolmentSchema.optional(),
    fatherName: fatherNameSchema.optional(),
    gender: genderSchema.optional(),
    address: addressSchema.optional(),
    aadhaar: aadhaarSchema.optional(),
    accommodations: z.array(z.string().trim().min(1).max(100)).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const patchLearnerSchema = z
  .object({
    name: nameSchema.optional(),
    externalRef: z.union([externalRefSchema, z.null()]).optional(),
    phone: z.union([phoneSchema, z.null()]).optional(),
    enrolmentNumber: z.union([enrolmentSchema, z.null()]).optional(),
    fatherName: z.union([fatherNameSchema, z.null()]).optional(),
    gender: z.union([genderSchema, z.null()]).optional(),
    address: z.union([addressSchema, z.null()]).optional(),
    aadhaar: z.union([aadhaarSchema, z.null()]).optional(),
    accommodations: z.array(z.string().trim().min(1).max(100)).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export const listLearnersQuerySchema = z.object({
  ...pageQuery,
  active: activeQuery,
});
