import { ApiError, apiRequest } from "./client";
import type { ActiveListQuery, MasterListPage } from "./masterData";

/**
 * Schemes, projects and authorised signatories (H-01). Paths, fields and
 * errors follow API_CONTRACT.md "Schemes, projects, authorised signatories".
 * Nothing is deleted: DELETE marks the row inactive.
 */

export const SIGNATORY_SCOPES = ["scheme", "project", "agency"] as const;
export type SignatoryScope = (typeof SIGNATORY_SCOPES)[number];

export type Scheme = {
  id: string;
  name: string;
  code: string;
  fundingBody: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  code: string;
  schemeId: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Signatory = {
  id: string;
  name: string;
  designation: string;
  scope: SignatoryScope;
  schemeId: string | null;
  projectId: string | null;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SchemeWrite = { name: string; code: string; fundingBody: string; active: boolean };

export type ProjectWrite = {
  name: string;
  code: string;
  schemeId: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
};

export type SignatoryWrite = {
  name: string;
  designation: string;
  scope: SignatoryScope;
  schemeId: string | null;
  projectId: string | null;
  validFrom: string;
  validTo: string | null;
  active: boolean;
};

export type ProjectListQuery = ActiveListQuery & { schemeId?: string };
export type SignatoryListQuery = ActiveListQuery & { scope?: SignatoryScope; schemeId?: string; projectId?: string };

export function isSignatoryScope(value: string): value is SignatoryScope {
  return (SIGNATORY_SCOPES as readonly string[]).includes(value);
}

function responseError(): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", "Scheme response was not recognised.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function count(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : null;
}

function stamps(value: Record<string, unknown>): { createdAt: string; updatedAt: string } | null {
  const createdAt = text(value.createdAt);
  const updatedAt = text(value.updatedAt);
  return createdAt && updatedAt ? { createdAt, updatedAt } : null;
}

export function parseScheme(value: unknown): Scheme {
  if (!isRecord(value)) throw responseError();
  const id = text(value.id);
  const name = text(value.name);
  const code = text(value.code);
  const fundingBody = text(value.fundingBody);
  const times = stamps(value);
  if (!id || !name || !code || !fundingBody || typeof value.active !== "boolean" || !times) throw responseError();
  return { id, name, code, fundingBody, active: value.active, ...times };
}

export function parseProject(value: unknown): Project {
  if (!isRecord(value)) throw responseError();
  const id = text(value.id);
  const name = text(value.name);
  const code = text(value.code);
  const schemeId = text(value.schemeId);
  const startDate = text(value.startDate);
  const endDate = nullableText(value.endDate);
  const times = stamps(value);
  if (!id || !name || !code || !schemeId || !startDate || endDate === undefined || typeof value.active !== "boolean" || !times) {
    throw responseError();
  }
  return { id, name, code, schemeId, startDate, endDate, active: value.active, ...times };
}

export function parseSignatory(value: unknown): Signatory {
  if (!isRecord(value)) throw responseError();
  const id = text(value.id);
  const name = text(value.name);
  const designation = text(value.designation);
  const scope = typeof value.scope === "string" && isSignatoryScope(value.scope) ? value.scope : null;
  const schemeId = nullableText(value.schemeId);
  const projectId = nullableText(value.projectId);
  const validFrom = text(value.validFrom);
  const validTo = nullableText(value.validTo);
  const times = stamps(value);
  if (
    !id ||
    !name ||
    !designation ||
    !scope ||
    schemeId === undefined ||
    projectId === undefined ||
    !validFrom ||
    validTo === undefined ||
    typeof value.active !== "boolean" ||
    !times
  ) {
    throw responseError();
  }
  return { id, name, designation, scope, schemeId, projectId, validFrom, validTo, active: value.active, ...times };
}

function parseList<T>(value: unknown, parseItem: (item: unknown) => T): MasterListPage<T> {
  if (!isRecord(value) || !Array.isArray(value.items)) throw responseError();
  const page = count(value.page, 1);
  const pageSize = count(value.pageSize, 1);
  const total = count(value.total, 0);
  if (page === null || pageSize === null || total === null) throw responseError();
  return { page, pageSize, total, items: value.items.map((item) => parseItem(item)) };
}

function listPath(path: string, query: ActiveListQuery, extra: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page && query.page > 0 ? query.page : 1));
  params.set("pageSize", String(query.pageSize && query.pageSize > 0 ? query.pageSize : 20));
  if (query.active !== undefined) params.set("active", query.active ? "true" : "false");
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return `${path}?${params.toString()}`;
}

function itemPath(path: string, id: string): string {
  return `${path}/${encodeURIComponent(id)}`;
}

export async function listSchemes(query: ActiveListQuery, signal?: AbortSignal): Promise<MasterListPage<Scheme>> {
  return parseList(await apiRequest<unknown>(listPath("/schemes", query, {}), { signal }), parseScheme);
}

export async function getScheme(id: string, signal?: AbortSignal): Promise<Scheme> {
  return parseScheme(await apiRequest<unknown>(itemPath("/schemes", id), { signal }));
}

export async function createScheme(input: SchemeWrite): Promise<Scheme> {
  return parseScheme(await apiRequest<unknown>("/schemes", { method: "POST", body: input }));
}

export async function updateScheme(id: string, input: SchemeWrite): Promise<Scheme> {
  return parseScheme(await apiRequest<unknown>(itemPath("/schemes", id), { method: "PATCH", body: input }));
}

export async function deactivateScheme(id: string): Promise<Scheme> {
  return parseScheme(await apiRequest<unknown>(itemPath("/schemes", id), { method: "DELETE" }));
}

export async function listProjects(query: ProjectListQuery, signal?: AbortSignal): Promise<MasterListPage<Project>> {
  return parseList(await apiRequest<unknown>(listPath("/projects", query, { schemeId: query.schemeId }), { signal }), parseProject);
}

export async function getProject(id: string, signal?: AbortSignal): Promise<Project> {
  return parseProject(await apiRequest<unknown>(itemPath("/projects", id), { signal }));
}

export async function createProject(input: ProjectWrite): Promise<Project> {
  return parseProject(await apiRequest<unknown>("/projects", { method: "POST", body: input }));
}

export async function updateProject(id: string, input: ProjectWrite): Promise<Project> {
  return parseProject(await apiRequest<unknown>(itemPath("/projects", id), { method: "PATCH", body: input }));
}

export async function deactivateProject(id: string): Promise<Project> {
  return parseProject(await apiRequest<unknown>(itemPath("/projects", id), { method: "DELETE" }));
}

export async function listSignatories(query: SignatoryListQuery, signal?: AbortSignal): Promise<MasterListPage<Signatory>> {
  const extra = { scope: query.scope, schemeId: query.schemeId, projectId: query.projectId };
  return parseList(await apiRequest<unknown>(listPath("/signatories", query, extra), { signal }), parseSignatory);
}

export async function createSignatory(input: SignatoryWrite): Promise<Signatory> {
  return parseSignatory(await apiRequest<unknown>("/signatories", { method: "POST", body: input }));
}

export async function updateSignatory(id: string, input: SignatoryWrite): Promise<Signatory> {
  return parseSignatory(await apiRequest<unknown>(itemPath("/signatories", id), { method: "PATCH", body: input }));
}

export async function deactivateSignatory(id: string): Promise<Signatory> {
  return parseSignatory(await apiRequest<unknown>(itemPath("/signatories", id), { method: "DELETE" }));
}
