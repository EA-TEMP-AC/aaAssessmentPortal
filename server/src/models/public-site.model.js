import mongoose from "mongoose";
import { SECTOR_NAMES } from "../config/annexure.js";

/**
 * Public website content. docs/SCHEMA.md §3.23. NCVET:TR s22.
 * Each collection holds one kind of item. Every item has `published` (default false) and
 * `sortOrder`. Files and photos are references (a string), never uploaded here: DECISIONS.md.
 * Assessor and proctor entries link to the registry by id and copy the name only, never
 * email, phone, code or any identity data.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const OFFICE_DOCUMENT_CATEGORIES = Object.freeze([
  "ownership",
  "lease",
  "telephone_bill",
  "internet_bill",
  "electricity_bill",
  "other",
]);
export const POSH_KINDS = Object.freeze(["policy", "committee_member"]);
export const PEOPLE_KINDS = Object.freeze(["assessor", "proctor"]);

const common = {
  published: { type: Boolean, required: true, default: false },
  archived: { type: Boolean, required: true, default: false },
  sortOrder: { type: Number, required: true, default: 0, min: 0, max: 100000 },
  createdBy: { type: mongoose.Schema.Types.ObjectId },
  updatedBy: { type: mongoose.Schema.Types.ObjectId },
};

const text = (max, required = false) => ({ type: String, trim: true, maxlength: max, required });

function model(name, collection, fields, indexes = []) {
  const schema = new mongoose.Schema({ ...fields, ...common }, { timestamps: true });
  schema.index({ published: 1, sortOrder: 1 });
  schema.index({ archived: 1, published: 1, sortOrder: 1 });
  for (const [spec, options] of indexes) schema.index(spec, options);
  return mongoose.model(name, schema, collection);
}

export const TeamMember = model("TeamMember", "publicTeamMembers", {
  name: text(200, true),
  designation: text(200, true),
  department: text(200),
  bio: text(2000),
  photoRef: text(500),
});

export const OrganogramNode = model("OrganogramNode", "publicOrganogram", {
  name: text(200, true),
  title: text(200, true),
  parentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  photoRef: text(500),
});

export const PublicPerson = model(
  "PublicPerson",
  "publicPeople",
  {
    kind: { type: String, required: true, enum: PEOPLE_KINDS },
    registryId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: text(200, true),
    roleLabel: text(100, true),
    sector: { type: String, enum: [...SECTOR_NAMES, null], default: null },
    photoRef: text(500),
    consentRecorded: { type: Boolean, required: true, default: false },
    consentNote: text(1000),
  },
  [[{ kind: 1, registryId: 1 }, { unique: true }]],
);

export const SamplePaper = model("SamplePaper", "publicSamplePapers", {
  title: text(200, true),
  qualificationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  fileRef: text(500, true),
});

export const IndustryLinkage = model("IndustryLinkage", "publicIndustryLinkages", {
  name: text(200, true),
  description: text(2000),
  websiteUrl: text(500),
  logoRef: text(500),
});

export const GrievanceItem = model("GrievanceItem", "publicGrievance", {
  title: text(200, true),
  body: text(5000),
  contactName: text(200),
  contactEmail: text(320),
  contactPhone: text(30),
  fileRef: text(500),
});

export const PoshItem = model("PoshItem", "publicPosh", {
  kind: { type: String, required: true, enum: POSH_KINDS },
  title: text(200, true),
  body: text(5000),
  memberName: text(200),
  memberRole: text(200),
  fileRef: text(500),
  consentRecorded: { type: Boolean, default: false },
  consentNote: text(1000),
});

export const OfficeDocument = model("OfficeDocument", "publicOfficeDocuments", {
  category: { type: String, required: true, enum: OFFICE_DOCUMENT_CATEGORIES },
  title: text(200, true),
  note: text(1000),
  fileRef: text(500, true),
});

export const PublicEvent = model(
  "PublicEvent",
  "publicEvents",
  {
    title: text(200, true),
    description: text(2000),
    date: { type: String, required: true, match: ISO_DATE },
    endDate: { type: String, default: null, match: ISO_DATE },
    location: text(200),
  },
  [[{ published: 1, date: 1 }, {}]],
);
