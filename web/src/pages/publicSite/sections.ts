import { SECTOR_NAMES } from "../../api/annexure";

export type FieldKind = "text" | "textarea" | "number" | "date" | "select" | "url" | "email";

export type FieldDef = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  options?: readonly { value: string; label: string }[];
  /** Set when the item is created and cannot be changed afterwards. */
  createOnly?: boolean;
  /** Shown only when this returns true for the current form values. */
  when?: (values: Record<string, string>) => boolean;
  max?: number;
};

export type SectionDef = {
  slug: string;
  label: string;
  singular: string;
  intro: string;
  /** The field that names an item in the list and in button labels. */
  titleField: string;
  /** Other fields shown in the list. */
  summaryFields: readonly string[];
  fields: readonly FieldDef[];
  /** True when publishing needs consent recorded for an item with these values. */
  needsConsent: (values: Record<string, unknown>) => boolean;
  warning?: string;
};

const FILE_HINT = "A link or reference to a file hosted elsewhere. This screen does not upload files.";

const option = (value: string, label = value) => ({ value, label });

export const OFFICE_BILL_WARNING =
  'Bills are never shown publicly. Telephone, internet and electricity bills appear on the public site only as "proof on file", and their file reference is hidden. Other documents show their file reference.';

export const CONSENT_HINT =
  "Record that this person agreed to be shown on the public website. Required before publishing.";

const never = () => false;

const SORT_ORDER: FieldDef = {
  name: "sortOrder",
  label: "Sort order",
  kind: "number",
  hint: "0 to 100000. Lowest first.",
};

export const SECTIONS: readonly SectionDef[] = [
  {
    slug: "team-members",
    label: "Team members",
    singular: "team member",
    intro: "The operational team.",
    titleField: "name",
    summaryFields: ["designation", "department"],
    needsConsent: never,
    fields: [
      { name: "name", label: "Name", kind: "text", required: true, max: 200 },
      { name: "designation", label: "Designation", kind: "text", required: true, max: 200 },
      { name: "department", label: "Department", kind: "text", max: 200 },
      { name: "bio", label: "Bio", kind: "textarea", max: 2000 },
      { name: "photoRef", label: "Photo reference", kind: "text", hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "organogram",
    label: "Organogram",
    singular: "organogram node",
    intro: "Boxes in the organisation chart. A node shows its parent only while the parent is published too.",
    titleField: "name",
    summaryFields: ["title"],
    needsConsent: never,
    fields: [
      { name: "name", label: "Name", kind: "text", required: true, max: 200 },
      { name: "title", label: "Title", kind: "text", required: true, max: 200 },
      { name: "parentId", label: "Reports to", kind: "select", hint: "Leave blank for the top of the chart." },
      { name: "photoRef", label: "Photo reference", kind: "text", hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "people",
    label: "People",
    singular: "person",
    intro:
      "Assessors and proctors shown publicly. A person is hidden automatically when their registry record is inactive or the assessor's ToA has expired.",
    titleField: "name",
    summaryFields: ["kind", "roleLabel", "sector"],
    needsConsent: () => true,
    fields: [
      {
        name: "kind",
        label: "Kind",
        kind: "select",
        required: true,
        createOnly: true,
        options: [option("assessor", "Assessor"), option("proctor", "Proctor")],
        hint: "Cannot be changed after the person is added.",
      },
      {
        name: "registryId",
        label: "Registry id",
        kind: "text",
        required: true,
        createOnly: true,
        hint: "The id of the assessor or proctor in the registry. Cannot be changed after the person is added.",
      },
      {
        name: "name",
        label: "Name",
        kind: "text",
        max: 200,
        hint: "Leave blank to copy the name from the registry.",
      },
      { name: "roleLabel", label: "Role label", kind: "text", required: true, max: 100 },
      { name: "sector", label: "Sector", kind: "select", options: SECTOR_NAMES.map((name) => option(name)) },
      { name: "photoRef", label: "Photo reference", kind: "text", hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "sample-papers",
    label: "Sample papers",
    singular: "sample paper",
    intro: "Sample assessment papers, one link per qualification.",
    titleField: "title",
    summaryFields: ["qualificationId", "fileRef"],
    needsConsent: never,
    fields: [
      { name: "title", label: "Title", kind: "text", required: true, max: 200 },
      {
        name: "qualificationId",
        label: "Qualification id",
        kind: "text",
        required: true,
        hint: "The id of the qualification in master data.",
      },
      { name: "fileRef", label: "File reference", kind: "text", required: true, hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "industry-linkages",
    label: "Industry linkages",
    singular: "industry linkage",
    intro: "Industry partners.",
    titleField: "name",
    summaryFields: ["websiteUrl"],
    needsConsent: never,
    fields: [
      { name: "name", label: "Name", kind: "text", required: true, max: 200 },
      { name: "description", label: "Description", kind: "textarea", max: 2000 },
      { name: "websiteUrl", label: "Website", kind: "url", hint: "Start with http:// or https://.", max: 500 },
      { name: "logoRef", label: "Logo reference", kind: "text", hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "grievance",
    label: "Grievance",
    singular: "grievance entry",
    intro: "The grievance procedure and who to contact.",
    titleField: "title",
    summaryFields: ["contactName", "contactEmail"],
    needsConsent: never,
    fields: [
      { name: "title", label: "Title", kind: "text", required: true, max: 200 },
      { name: "body", label: "Text", kind: "textarea", max: 5000 },
      { name: "contactName", label: "Contact name", kind: "text", max: 200 },
      { name: "contactEmail", label: "Contact email", kind: "email", max: 320 },
      { name: "contactPhone", label: "Contact phone", kind: "text", max: 30 },
      { name: "fileRef", label: "File reference", kind: "text", hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "posh",
    label: "POSH",
    singular: "POSH entry",
    intro: "The POSH policy and the internal committee members.",
    titleField: "title",
    summaryFields: ["kind", "memberName"],
    needsConsent: (values) => values.kind === "committee_member",
    fields: [
      {
        name: "kind",
        label: "Kind",
        kind: "select",
        required: true,
        options: [option("policy", "Policy"), option("committee_member", "Committee member")],
      },
      { name: "title", label: "Title", kind: "text", required: true, max: 200 },
      { name: "body", label: "Text", kind: "textarea", max: 5000 },
      {
        name: "memberName",
        label: "Member name",
        kind: "text",
        required: true,
        max: 200,
        when: (values) => values.kind === "committee_member",
      },
      {
        name: "memberRole",
        label: "Member role",
        kind: "text",
        max: 200,
        when: (values) => values.kind === "committee_member",
      },
      { name: "fileRef", label: "File reference", kind: "text", hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "office-documents",
    label: "Office documents",
    singular: "office document",
    intro: "Registered office documents.",
    warning: OFFICE_BILL_WARNING,
    titleField: "title",
    summaryFields: ["category"],
    needsConsent: never,
    fields: [
      {
        name: "category",
        label: "Category",
        kind: "select",
        required: true,
        options: [
          option("ownership", "Ownership"),
          option("lease", "Lease"),
          option("telephone_bill", "Telephone bill"),
          option("internet_bill", "Internet bill"),
          option("electricity_bill", "Electricity bill"),
          option("other", "Other"),
        ],
      },
      { name: "title", label: "Title", kind: "text", required: true, max: 200 },
      { name: "note", label: "Note", kind: "textarea", max: 1000 },
      { name: "fileRef", label: "File reference", kind: "text", required: true, hint: FILE_HINT, max: 500 },
      SORT_ORDER,
    ],
  },
  {
    slug: "events",
    label: "Events",
    singular: "event",
    intro: "The monthly calendar of events.",
    titleField: "title",
    summaryFields: ["date", "endDate", "location"],
    needsConsent: never,
    fields: [
      { name: "title", label: "Title", kind: "text", required: true, max: 200 },
      { name: "description", label: "Description", kind: "textarea", max: 2000 },
      { name: "date", label: "Date", kind: "date", required: true },
      { name: "endDate", label: "End date", kind: "date", hint: "Leave blank for a one-day event." },
      { name: "location", label: "Location", kind: "text", max: 200 },
      SORT_ORDER,
    ],
  },
];

export function sectionFor(slug: string | null): SectionDef {
  return SECTIONS.find((section) => section.slug === slug) ?? SECTIONS[0]!;
}

const EXTRA_LABELS: Record<string, string> = {
  consentRecorded: "Consent",
  consentNote: "Consent note",
  duplicate: "Item",
  published: "Published",
};

export function fieldLabel(section: SectionDef, name: string): string {
  return section.fields.find((item) => item.name === name)?.label ?? EXTRA_LABELS[name] ?? name;
}
