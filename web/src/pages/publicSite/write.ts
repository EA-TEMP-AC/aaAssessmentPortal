import { ApiError } from "../../api/client";
import { joinErrorParts } from "../../api/ruleErrors";
import type { PublicSiteItem } from "../../api/publicSite";
import { fieldLabel, type FieldDef, type SectionDef } from "./sections";

export type Draft = {
  values: Record<string, string>;
  consentRecorded: boolean;
};

export type Failure = {
  message: string;
  fields: string[];
  /** Server or client messages by field name, for the text under each field. */
  byField: Record<string, string>;
};

export const CONSENT_REQUIRED_MESSAGE =
  "Consent has not been recorded, so this cannot be published yet. Edit the item, tick the consent box, add a note on how consent was given, save, then publish.";

export const MIS_PUBLISH_REASON =
  "Only an AA admin can publish, unpublish, archive or change published items. As MIS you can add and edit drafts.";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONSENT_FIELDS = ["consentRecorded", "consentNote"] as const;

export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function visible(field: FieldDef, values: Record<string, string>): boolean {
  return field.when ? field.when(values) : true;
}

export function hasConsentFields(section: SectionDef, values: Record<string, unknown>): boolean {
  return section.slug === "people" || (section.slug === "posh" && section.needsConsent(values));
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function emptyDraft(section: SectionDef): Draft {
  const values: Record<string, string> = {};
  for (const field of section.fields) {
    values[field.name] = "";
  }
  if (section.slug === "posh") values.kind = "policy";
  if (section.slug === "people") values.kind = "assessor";
  values.consentNote = "";
  return { values, consentRecorded: false };
}

export function draftFromItem(section: SectionDef, item: PublicSiteItem): Draft {
  const values: Record<string, string> = {};
  for (const field of section.fields) values[field.name] = text(item.fields[field.name]);
  values.consentNote = text(item.fields.consentNote);
  return { values, consentRecorded: item.fields.consentRecorded === true };
}

export type BuildResult = { ok: true; body: Record<string, unknown> } | ({ ok: false } & Failure);

/**
 * Create sends only filled fields. Edit sends blanks as null so a field can be cleared
 * (`people.name` is the one exception: the server does not accept null there).
 */
export function buildBody(section: SectionDef, draft: Draft, mode: "create" | "edit"): BuildResult {
  const body: Record<string, unknown> = {};
  const byField: Record<string, string> = {};
  const values = draft.values;

  for (const field of section.fields) {
    if (mode === "edit" && field.createOnly) continue;
    const raw = (values[field.name] ?? "").trim();
    if (!visible(field, values)) {
      if (mode === "edit" && field.kind !== "select") body[field.name] = null;
      continue;
    }
    if (raw === "") {
      if (field.required) {
        byField[field.name] = `Enter ${field.label.toLowerCase()}.`;
      } else if (mode === "edit" && !(section.slug === "people" && field.name === "name") && field.name !== "sortOrder") {
        body[field.name] = null;
      }
      continue;
    }
    if (field.kind === "number") {
      const number = Number(raw);
      if (!Number.isInteger(number) || number < 0 || number > 100000) {
        byField[field.name] = "Enter a whole number from 0 to 100000.";
      } else {
        body[field.name] = number;
      }
      continue;
    }
    if (field.kind === "date" && !isCalendarDate(raw)) {
      byField[field.name] = `Enter a real ${field.label.toLowerCase()}.`;
      continue;
    }
    if (field.max && raw.length > field.max) {
      byField[field.name] = `${field.label} must be ${field.max} characters or fewer.`;
      continue;
    }
    body[field.name] = raw;
  }

  const date = (values.date ?? "").trim();
  const endDate = (values.endDate ?? "").trim();
  if (section.slug === "events" && !byField.date && !byField.endDate && date && endDate && endDate < date) {
    byField.endDate = "The end date must be on or after the date.";
  }

  if (hasConsentFields(section, values)) {
    body.consentRecorded = draft.consentRecorded;
    const note = (values.consentNote ?? "").trim();
    if (note.length > 1000) {
      byField.consentNote = "The consent note must be 1000 characters or fewer.";
    } else if (note) {
      body.consentNote = note;
    } else if (mode === "edit") {
      body.consentNote = null;
    }
  } else if (section.slug === "posh" && mode === "edit") {
    body.consentNote = null;
  }

  if (mode === "create") body.published = false;

  const fields = Object.keys(byField);
  if (fields.length > 0) {
    const parts = fields.map((name) => byField[name]!);
    return { ok: false, message: joinErrorParts(parts), fields, byField };
  }
  return { ok: true, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plain-words message for any failed call, with the fields the server named. */
export function formatPublicSiteError(section: SectionDef, error: unknown): Failure {
  if (!(error instanceof ApiError)) {
    return { message: "Could not reach the server. Try again.", fields: [], byField: {} };
  }
  if (error.code === "CONSENT_REQUIRED") {
    return {
      message: CONSENT_REQUIRED_MESSAGE,
      fields: [...CONSENT_FIELDS],
      byField: { consentRecorded: "Tick this and save before publishing." },
    };
  }
  if (error.status === 403) {
    return {
      message: "Your role is not allowed to do this. Only an AA admin can publish, unpublish, archive or change published items.",
      fields: [],
      byField: {},
    };
  }
  if (error.status === 404) {
    return {
      message: "This item was not found. It may already be archived. Reload the list.",
      fields: [],
      byField: {},
    };
  }
  const fields: string[] = [];
  const byField: Record<string, string> = {};
  const extras: string[] = [];
  if (isRecord(error.details)) {
    for (const [key, value] of Object.entries(error.details)) {
      if (!Array.isArray(value)) continue;
      const messages = value.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (messages.length === 0) continue;
      fields.push(key);
      byField[key] = messages.join(" ");
      extras.push(`${fieldLabel(section, key)}: ${messages.join(" ")}`);
    }
  }
  return {
    message: joinErrorParts([error.code, error.message, extras.join(" ")]),
    fields,
    byField,
  };
}
