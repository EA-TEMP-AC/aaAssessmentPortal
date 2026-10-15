import { ApiError } from "../../api/client";
import type { ProjectWrite, SchemeWrite, SignatoryScope, SignatoryWrite } from "../../api/schemes";
import { isSignatoryScope } from "../../api/schemes";
import { isObjectId } from "../masterData/simpleWrite";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type WriteResult<T> = { ok: true; body: T } | { ok: false; message: string; fields: string[] };

export type SchemeDraft = { name: string; code: string; fundingBody: string; active: boolean };

export type ProjectDraft = {
  name: string;
  code: string;
  schemeId: string;
  startDate: string;
  endDate: string;
  active: boolean;
};

export type SignatoryDraft = {
  name: string;
  designation: string;
  scope: SignatoryScope;
  schemeId: string;
  projectId: string;
  validFrom: string;
  validTo: string;
  active: boolean;
};

export const SCHEME_FIELDS = ["name", "code", "fundingBody"] as const;
export const PROJECT_FIELDS = ["name", "code", "schemeId", "startDate", "endDate"] as const;
export const SIGNATORY_FIELDS = ["name", "designation", "scope", "schemeId", "projectId", "validFrom", "validTo"] as const;

export function emptySchemeDraft(): SchemeDraft {
  return { name: "", code: "", fundingBody: "", active: true };
}

export function emptyProjectDraft(): ProjectDraft {
  return { name: "", code: "", schemeId: "", startDate: "", endDate: "", active: true };
}

export function emptySignatoryDraft(): SignatoryDraft {
  return { name: "", designation: "", scope: "agency", schemeId: "", projectId: "", validFrom: "", validTo: "", active: true };
}

function isRealDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === day;
}

class Problems {
  readonly messages: string[] = [];
  readonly fields: string[] = [];

  add(field: string, message: string) {
    this.messages.push(message);
    this.fields.push(field);
  }

  text(field: string, label: string, value: string, max: number): string {
    const trimmed = value.trim();
    if (!trimmed) this.add(field, `${label} is required.`);
    else if (trimmed.length > max) this.add(field, `${label} must be ${max} characters or fewer.`);
    return trimmed;
  }

  id(field: string, label: string, value: string): string {
    const trimmed = value.trim();
    if (!trimmed) this.add(field, `Choose a ${label}.`);
    else if (!isObjectId(trimmed)) this.add(field, `${label[0]?.toUpperCase()}${label.slice(1)} must be a 24-character id.`);
    return trimmed;
  }

  date(field: string, label: string, value: string, required: boolean): string {
    const trimmed = value.trim();
    if (!trimmed) {
      if (required) this.add(field, `${label} is required.`);
    } else if (!isRealDate(trimmed)) this.add(field, `${label} must be a real calendar date.`);
    return trimmed;
  }

  result<T>(body: () => T): WriteResult<T> {
    if (this.messages.length > 0) return { ok: false, message: this.messages.join(" "), fields: this.fields };
    return { ok: true, body: body() };
  }
}

export function buildSchemeWrite(draft: SchemeDraft): WriteResult<SchemeWrite> {
  const problems = new Problems();
  const name = problems.text("name", "Name", draft.name, 200);
  const code = problems.text("code", "Code", draft.code, 64);
  const fundingBody = problems.text("fundingBody", "Funding body", draft.fundingBody, 200);
  return problems.result(() => ({ name, code, fundingBody, active: draft.active }));
}

export function buildProjectWrite(draft: ProjectDraft): WriteResult<ProjectWrite> {
  const problems = new Problems();
  const name = problems.text("name", "Name", draft.name, 200);
  const code = problems.text("code", "Code", draft.code, 64);
  const schemeId = problems.id("schemeId", "scheme", draft.schemeId);
  const startDate = problems.date("startDate", "Start date", draft.startDate, true);
  const endDate = problems.date("endDate", "End date", draft.endDate, false);
  if (startDate && endDate && !problems.fields.includes("startDate") && !problems.fields.includes("endDate") && endDate < startDate) {
    problems.add("endDate", "End date must be on or after the start date.");
  }
  return problems.result(() => ({ name, code, schemeId, startDate, endDate: endDate || null, active: draft.active }));
}

export function buildSignatoryWrite(draft: SignatoryDraft): WriteResult<SignatoryWrite> {
  const problems = new Problems();
  const name = problems.text("name", "Name", draft.name, 200);
  const designation = problems.text("designation", "Designation", draft.designation, 200);
  if (!isSignatoryScope(draft.scope)) problems.add("scope", "Choose a scope.");
  let schemeId = "";
  let projectId = "";
  if (draft.scope === "scheme") schemeId = problems.id("schemeId", "scheme", draft.schemeId);
  if (draft.scope === "project") projectId = problems.id("projectId", "project", draft.projectId);
  const validFrom = problems.date("validFrom", "Valid from", draft.validFrom, true);
  const validTo = problems.date("validTo", "Valid to", draft.validTo, false);
  if (validFrom && validTo && !problems.fields.includes("validFrom") && !problems.fields.includes("validTo") && validTo < validFrom) {
    problems.add("validTo", "Valid to must be on or after valid from.");
  }
  return problems.result(() => ({
    name,
    designation,
    scope: draft.scope,
    schemeId: schemeId || null,
    projectId: projectId || null,
    validFrom,
    validTo: validTo || null,
    active: draft.active,
  }));
}

/**
 * The server lists each bad field as a key of `details` holding messages
 * (VALIDATION_ERROR). Only keys the form actually has are returned, so the
 * first one can take focus.
 */
export function serverFieldErrors(error: unknown, known: readonly string[]): string[] {
  if (!(error instanceof ApiError)) return [];
  const details = error.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return [];
  const record = details as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => Array.isArray(record[key]));
  if (typeof record.field === "string") keys.push(record.field);
  return known.filter((field) => keys.includes(field));
}
