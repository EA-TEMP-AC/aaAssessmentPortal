import { ApiError, apiRequest } from "./client";

/**
 * Assessor availability and proctor list for assign/reassign.
 * GET /assessors/available and GET /proctors follow B-04. See DECISIONS.md
 * open question 101.
 */

export type AssessorToa = {
  certNo: string;
  issuedOn: string;
  expiresOn: string;
};

export type AssessorRecord = {
  id: string;
  name: string;
  code: string | null;
  email: string | null;
  qualifications: string[];
  yearsOfExperience: number | null;
  languages: string[];
  toa: AssessorToa | null;
  otherAaCount: number;
  undertaking: boolean;
  active: boolean;
};

export type ProctorRecord = {
  id: string;
  name: string;
  code: string | null;
  email: string | null;
  qualifications: string[];
  languages: string[];
  active: boolean;
};

export type AvailableAssessorsQuery = {
  from?: string;
  to?: string;
  languages?: string;
  batchId?: string;
};

function responseError(kind: string): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", `${kind} response was not recognised.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

function parseToa(value: unknown): AssessorToa | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw responseError("Assessor");
  const certNo = requiredString(value.certNo);
  const issuedOn = requiredString(value.issuedOn);
  const expiresOn = requiredString(value.expiresOn);
  if (!certNo || !issuedOn || !expiresOn) throw responseError("Assessor");
  return { certNo, issuedOn, expiresOn };
}

export function parseAssessor(value: unknown): AssessorRecord {
  if (!isRecord(value)) throw responseError("Assessor");
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const code = nullableString(value.code);
  const email = nullableString(value.email);
  const qualifications = stringList(value.qualifications) ?? [];
  const languages = stringList(value.languages) ?? [];
  if (!id || !name || code === undefined || email === undefined) throw responseError("Assessor");
  const years =
    value.yearsOfExperience === null || value.yearsOfExperience === undefined
      ? null
      : typeof value.yearsOfExperience === "number"
        ? value.yearsOfExperience
        : undefined;
  if (years === undefined) throw responseError("Assessor");
  if (typeof value.otherAaCount !== "number" || typeof value.undertaking !== "boolean") {
    throw responseError("Assessor");
  }
  if (typeof value.active !== "boolean") throw responseError("Assessor");
  return {
    id,
    name,
    code,
    email,
    qualifications,
    yearsOfExperience: years,
    languages,
    toa: parseToa(value.toa),
    otherAaCount: value.otherAaCount,
    undertaking: value.undertaking,
    active: value.active,
  };
}

export function parseProctor(value: unknown): ProctorRecord {
  if (!isRecord(value)) throw responseError("Proctor");
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const code = nullableString(value.code);
  const email = nullableString(value.email);
  const qualifications = stringList(value.qualifications) ?? [];
  const languages = stringList(value.languages) ?? [];
  if (!id || !name || code === undefined || email === undefined) throw responseError("Proctor");
  if (typeof value.active !== "boolean") throw responseError("Proctor");
  return { id, name, code, email, qualifications, languages, active: value.active };
}

export async function listAvailableAssessors(
  query: AvailableAssessorsQuery,
  signal?: AbortSignal,
): Promise<AssessorRecord[]> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.languages) params.set("languages", query.languages);
  if (query.batchId) params.set("batchId", query.batchId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const body = await apiRequest<unknown>(`/assessors/available${suffix}`, { signal });
  if (!isRecord(body) || !Array.isArray(body.items)) throw responseError("Available assessors");
  return body.items.map((item) => parseAssessor(item));
}

export async function listProctors(
  query: { page?: number; pageSize?: number; active?: boolean } = {},
  signal?: AbortSignal,
): Promise<{ page: number; pageSize: number; total: number; items: ProctorRecord[] }> {
  const params = new URLSearchParams();
  params.set("page", String(query.page && query.page > 0 ? query.page : 1));
  params.set("pageSize", String(query.pageSize && query.pageSize > 0 ? query.pageSize : 100));
  if (query.active !== undefined) params.set("active", query.active ? "true" : "false");
  const body = await apiRequest<unknown>(`/proctors?${params.toString()}`, { signal });
  if (!isRecord(body) || !Array.isArray(body.items)) throw responseError("Proctor");
  const page = typeof body.page === "number" ? body.page : 1;
  const pageSize = typeof body.pageSize === "number" ? body.pageSize : body.items.length;
  const total = typeof body.total === "number" ? body.total : body.items.length;
  return {
    page,
    pageSize,
    total,
    items: body.items.map((item) => parseProctor(item)),
  };
}
