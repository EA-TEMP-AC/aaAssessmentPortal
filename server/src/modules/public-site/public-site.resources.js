import { z } from "zod";
import { SECTOR_NAMES } from "../../config/annexure.js";
import { validationError } from "../../lib/errors.js";
import { Assessor } from "../../models/assessor.model.js";
import { Proctor } from "../../models/proctor.model.js";
import { Qualification } from "../../models/qualification.model.js";
import {
  GrievanceItem,
  IndustryLinkage,
  OFFICE_DOCUMENT_CATEGORIES,
  OfficeDocument,
  OrganogramNode,
  PEOPLE_KINDS,
  POSH_KINDS,
  PoshItem,
  PublicEvent,
  PublicPerson,
  SamplePaper,
  TeamMember,
} from "../../models/public-site.model.js";

/**
 * One definition per public-site collection. `publicFields` is the whitelist for /public/*:
 * a field not listed there is never returned to anonymous callers. `schema` is the strict admin
 * write body. `check` runs before a write and may throw a 400. `enrich` adds public-safe fields
 * looked up from other collections.
 */

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Not a real calendar date");

const str = (max) => z.string().trim().min(1).max(max);
/** A reference to a file or photo hosted elsewhere. Not fetched, not uploaded. */
const ref = z.string().trim().min(1).max(500);
const optionalText = (max) => z.string().trim().max(max).nullish();

const common = {
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
};

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Use an http or https address");

async function registryCheck(body, existing) {
  if (existing) return {};
  const model = body.kind === "assessor" ? Assessor : Proctor;
  const row = await model.findById(body.registryId).select("name").lean();
  if (!row) {
    throw validationError("registryId is not in the registry", {
      registryId: [`No ${body.kind} with this id`],
    });
  }
  // Only the name is copied. Nothing else from the registry record is read.
  return { name: body.name ?? row.name };
}

async function organogramCheck(body, existing) {
  if (body.parentId === undefined || body.parentId === null) return {};
  if (existing && String(existing._id) === body.parentId) {
    throw validationError("A node cannot be its own parent", { parentId: ["Same node"] });
  }
  let cursor = await OrganogramNode.findById(body.parentId).select("parentId").lean();
  if (!cursor) throw validationError("Unknown parent", { parentId: ["No such node"] });
  for (let hops = 0; cursor && hops < 1000; hops += 1) {
    if (existing && String(cursor._id) === String(existing._id)) {
      throw validationError("The parent would make a loop", { parentId: ["Loop"] });
    }
    cursor = cursor.parentId
      ? await OrganogramNode.findById(cursor.parentId).select("parentId").lean()
      : null;
  }
  return {};
}

async function qualificationCheck(body) {
  if (!body.qualificationId) return {};
  if (!(await Qualification.exists({ _id: body.qualificationId }))) {
    throw validationError("Unknown qualification", { qualificationId: ["No such qualification"] });
  }
  return {};
}

async function addQualification(items) {
  const ids = [...new Set(items.map((item) => String(item.qualificationId)))];
  const rows = await Qualification.find({ _id: { $in: ids } })
    .select("code name sector")
    .lean();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  return items.map((item) => {
    const row = byId.get(String(item.qualificationId));
    return {
      ...item,
      qualification: row ? { code: row.code, name: row.name, sector: row.sector ?? null } : null,
    };
  });
}

/** An organogram node shows its parent only while the parent is published too. */
async function addPublicParent(items) {
  const parentIds = [
    ...new Set(
      items
        .map((item) => item.parentId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const shown = new Set(
    (
      await OrganogramNode.find({ _id: { $in: parentIds }, published: true })
        .select("_id")
        .lean()
    ).map((row) => String(row._id)),
  );
  return items.map((item) => ({
    ...item,
    parentId: item.parentId && shown.has(String(item.parentId)) ? String(item.parentId) : null,
  }));
}

const queryEnum = (values) => z.enum(values).optional();

export const UTILITY_BILL_CATEGORIES = Object.freeze(
  new Set(["telephone_bill", "internet_bill", "electricity_bill"]),
);

function enrichOfficeDocuments(items) {
  return items.map((item) => {
    const isUtility = UTILITY_BILL_CATEGORIES.has(item.category);
    return {
      ...item,
      fileRef: isUtility ? null : item.fileRef,
      proofOnFile: isUtility ? true : false,
    };
  });
}

export const RESOURCES = {
  "team-members": {
    model: TeamMember,
    schema: z
      .object({
        name: str(200),
        designation: str(200),
        department: optionalText(200),
        bio: optionalText(2000),
        photoRef: ref.nullish(),
        ...common,
      })
      .strict(),
    required: ["name", "designation"],
    publicFields: ["name", "designation", "department", "bio", "photoRef"],
  },
  organogram: {
    model: OrganogramNode,
    schema: z
      .object({
        name: str(200),
        title: str(200),
        parentId: objectId.nullish(),
        photoRef: ref.nullish(),
        ...common,
      })
      .strict(),
    required: ["name", "title"],
    publicFields: ["name", "title", "parentId", "photoRef"],
    check: organogramCheck,
    enrich: addPublicParent,
  },
  people: {
    model: PublicPerson,
    schema: z
      .object({
        kind: z.enum(PEOPLE_KINDS),
        registryId: objectId,
        name: str(200).optional(),
        roleLabel: str(100),
        sector: z.enum(SECTOR_NAMES).nullish(),
        photoRef: ref.nullish(),
        consentRecorded: z.boolean(),
        consentNote: optionalText(1000),
        ...common,
      })
      .strict(),
    required: ["kind", "registryId", "roleLabel", "consentRecorded"],
    immutable: ["kind", "registryId"],
    publicFields: ["kind", "name", "roleLabel", "sector", "photoRef"],
    check: registryCheck,
    publicQuery: { kind: queryEnum(PEOPLE_KINDS) },
  },
  "sample-papers": {
    model: SamplePaper,
    schema: z
      .object({ title: str(200), qualificationId: objectId, fileRef: ref, ...common })
      .strict(),
    required: ["title", "qualificationId", "fileRef"],
    publicFields: ["title", "fileRef"],
    enrichedFields: ["qualification"],
    check: qualificationCheck,
    enrich: addQualification,
  },
  "industry-linkages": {
    model: IndustryLinkage,
    schema: z
      .object({
        name: str(200),
        description: optionalText(2000),
        websiteUrl: httpUrl.nullish(),
        logoRef: ref.nullish(),
        ...common,
      })
      .strict(),
    required: ["name"],
    publicFields: ["name", "description", "websiteUrl", "logoRef"],
  },
  grievance: {
    model: GrievanceItem,
    schema: z
      .object({
        title: str(200),
        body: optionalText(5000),
        contactName: optionalText(200),
        contactEmail: z.string().trim().email().max(320).nullish(),
        contactPhone: optionalText(30),
        fileRef: ref.nullish(),
        ...common,
      })
      .strict(),
    required: ["title"],
    publicFields: ["title", "body", "contactName", "contactEmail", "contactPhone", "fileRef"],
  },
  posh: {
    model: PoshItem,
    schema: z
      .object({
        kind: z.enum(POSH_KINDS),
        title: str(200),
        body: optionalText(5000),
        memberName: optionalText(200),
        memberRole: optionalText(200),
        fileRef: ref.nullish(),
        consentRecorded: z.boolean().optional(),
        consentNote: optionalText(1000),
        ...common,
      })
      .strict(),
    required: ["kind", "title"],
    publicFields: ["kind", "title", "body", "memberName", "memberRole", "fileRef"],
    publicQuery: { kind: queryEnum(POSH_KINDS) },
    refine(body, ctx) {
      if (body.kind === "committee_member" && !body.memberName) {
        ctx.addIssue({
          code: "custom",
          path: ["memberName"],
          message: "memberName is required for a committee member",
        });
      }
    },
  },
  "office-documents": {
    model: OfficeDocument,
    schema: z
      .object({
        category: z.enum(OFFICE_DOCUMENT_CATEGORIES),
        title: str(200),
        note: optionalText(1000),
        fileRef: ref,
        ...common,
      })
      .strict(),
    required: ["category", "title", "fileRef"],
    publicFields: ["category", "title", "note", "fileRef"],
    enrichedFields: ["proofOnFile"],
    enrich: enrichOfficeDocuments,
    publicQuery: { category: queryEnum(OFFICE_DOCUMENT_CATEGORIES) },
  },
  events: {
    model: PublicEvent,
    schema: z
      .object({
        title: str(200),
        description: optionalText(2000),
        date: isoDate,
        endDate: isoDate.nullish(),
        location: optionalText(200),
        ...common,
      })
      .strict(),
    required: ["title", "date"],
    publicFields: ["title", "description", "date", "endDate", "location"],
    sort: { date: 1, sortOrder: 1, _id: 1 },
    publicQuery: {
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
    },
    refine(body, ctx) {
      if (body.endDate && body.date && body.endDate < body.date) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate is before date" });
      }
    },
  },
};

export const RESOURCE_SLUGS = Object.freeze(Object.keys(RESOURCES));

/** Create body: required fields enforced, then the resource's own cross-field rule. */
export function createSchemaFor(slug) {
  const def = RESOURCES[slug];
  return def.schema.superRefine((body, ctx) => {
    for (const key of def.required) {
      if (body[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: "Required" });
      }
    }
    def.refine?.(body, ctx);
  });
}

/** Patch body: any subset, at least one field, immutable fields refused. */
export function patchSchemaFor(slug) {
  const def = RESOURCES[slug];
  return def.schema.partial().superRefine((body, ctx) => {
    if (Object.keys(body).length === 0) {
      ctx.addIssue({ code: "custom", message: "At least one field is required" });
    }
    for (const key of def.immutable ?? []) {
      if (body[key] !== undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: "Cannot be changed" });
      }
    }
    def.refine?.(body, ctx);
  });
}

/** Month filter for events: an event shows when its date span touches the month. */
export function monthBounds(month) {
  return { first: `${month}-01`, last: `${month}-31` };
}
