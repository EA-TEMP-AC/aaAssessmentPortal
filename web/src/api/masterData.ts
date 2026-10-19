import {
  isSectorName,
  isStateName,
  type SectorName,
  type StateName,
} from "./annexure";
import { ApiError, apiRequest, apiRequestResult } from "./client";

/**
 * Master data. Learner methods are in API_CONTRACT.md. Other paths, fields,
 * and pass-mark checks follow server/src/modules/master-data (B-07a).
 * Qualification sector is an Annexure II name. ratioClass is separate.
 * Centre state is required. See DECISIONS.md open questions 47–57 and 62–69.
 */

export const MASTER_PAGE_SIZE_DEFAULT = 20;
export const MASTER_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export type MasterPageSize = (typeof MASTER_PAGE_SIZE_OPTIONS)[number];

export const RATIO_CLASSES = [
  "manufacturing",
  "services",
  "school_education",
  "other",
] as const;
export type RatioClass = (typeof RATIO_CLASSES)[number];

export const BATCH_TYPES = ["STT", "LTT"] as const;
export type BatchType = (typeof BATCH_TYPES)[number];

export const PASS_CRITERIA_MODES = ["nos_wise", "overall"] as const;
export type PassCriteriaMode = (typeof PASS_CRITERIA_MODES)[number];

export const PASS_MARK_UNITS = ["percent", "absolute"] as const;
export type PassMarkUnit = (typeof PASS_MARK_UNITS)[number];

export type ComponentMarks = {
  theory: number | null;
  practical: number | null;
  viva: number | null;
};

export type PassMarks = {
  theory: number;
  practical: number;
  viva: number;
};

export type AwardingBody = {
  id: string;
  name: string;
  code: string | null;
  notificationEmails: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TrainingPartner = {
  id: string;
  name: string;
  code: string | null;
  email: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Centre = {
  id: string;
  name: string;
  code: string | null;
  tpId: string;
  state: StateName;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PerformanceCriterion = {
  pcId: string;
  code: string;
  name: string;
  passMark: number | null;
  maxMark: number | null;
};

export type Nos = {
  nosId: string;
  code: string;
  name: string;
  maxMarks: ComponentMarks | null;
  pcs: PerformanceCriterion[];
};

export type Qualification = {
  id: string;
  code: string;
  name: string;
  sector: SectorName;
  ratioClass: RatioClass;
  defaultBatchType: BatchType | null;
  passCriteriaMode: PassCriteriaMode | null;
  passMarkUnit: PassMarkUnit;
  passMarks: PassMarks;
  maxMarks: ComponentMarks | null;
  nos: Nos[];
  pcPassMarksRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

/** SCHEMA §3.3. X-45 added father/husband name, gender, address and enrolment number. */
export type Learner = {
  id: string;
  name: string;
  externalRef: string | null;
  phone: string | null;
  enrolmentNumber: string | null;
  fatherName: string | null;
  gender: string | null;
  address: string | null;
  accommodations: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MasterListPage<T> = {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
};

export type ActiveListQuery = {
  active?: boolean;
  page?: number;
  pageSize?: number;
};

export type CentreListQuery = ActiveListQuery & {
  tpId?: string;
};

export type QualificationListQuery = {
  sector?: SectorName;
  page?: number;
  pageSize?: number;
};

export type AwardingBodyWrite = {
  name: string;
  code?: string | null;
  notificationEmails: string[];
  active: boolean;
};

export type TrainingPartnerWrite = {
  name: string;
  code?: string | null;
  email?: string | null;
  active: boolean;
};

export type CentreWrite = {
  name: string;
  code?: string | null;
  tpId: string;
  state: StateName;
  active: boolean;
};

export type LearnerWrite = {
  name: string;
  externalRef?: string | null;
  phone?: string | null;
  enrolmentNumber?: string | null;
  fatherName?: string | null;
  gender?: "Male" | "Female" | "Other" | null;
  address?: string | null;
  accommodations?: string[];
  active: boolean;
};

export type PcWrite = {
  pcId: string;
  code: string;
  name: string;
  passMark?: number;
  maxMark?: number | null;
};

export type NosWrite = {
  nosId: string;
  code: string;
  name: string;
  maxMarks?: ComponentMarks;
  pcs: PcWrite[];
};

export type QualificationWrite = {
  code: string;
  name: string;
  sector: SectorName;
  ratioClass: RatioClass;
  defaultBatchType?: BatchType | null;
  passCriteriaMode?: PassCriteriaMode | null;
  passMarkUnit: PassMarkUnit;
  passMarks: PassMarks;
  maxMarks?: ComponentMarks | null;
  nos: NosWrite[];
  pcPassMarksRequired: boolean;
};

export function isMasterPageSize(value: number): value is MasterPageSize {
  return (MASTER_PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function isRatioClass(value: string): value is RatioClass {
  return (RATIO_CLASSES as readonly string[]).includes(value);
}

function responseError(): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    "Master data response was not recognised.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum)
    return null;
  return value;
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

function requiredBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return null;
  return value as string[];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function nullableFinite(value: unknown): number | null | undefined {
  if (value === null) return null;
  return finiteNumber(value);
}

function parseComponent(
  value: unknown,
  allowNull: boolean,
): ComponentMarks | null {
  if (value === null && allowNull) return null;
  if (!isRecord(value)) throw responseError();
  const theory = nullableFinite(value.theory);
  const practical = nullableFinite(value.practical);
  const viva = nullableFinite(value.viva);
  if (theory === undefined || practical === undefined || viva === undefined)
    throw responseError();
  return { theory, practical, viva };
}

function parsePassMarks(value: unknown): PassMarks {
  if (!isRecord(value)) throw responseError();
  const theory = finiteNumber(value.theory);
  const practical = finiteNumber(value.practical);
  const viva = finiteNumber(value.viva);
  if (theory === null || practical === null || viva === null)
    throw responseError();
  return { theory, practical, viva };
}

function parseTimestamps(
  value: Record<string, unknown>,
): { createdAt: string; updatedAt: string } | null {
  const createdAt = requiredString(value.createdAt);
  const updatedAt = requiredString(value.updatedAt);
  if (!createdAt || !updatedAt) return null;
  return { createdAt, updatedAt };
}

function parseList<T>(
  value: unknown,
  parseItem: (item: unknown) => T,
): MasterListPage<T> {
  if (!isRecord(value) || !Array.isArray(value.items)) throw responseError();
  const page = wholeNumber(value.page, 1);
  const pageSize = wholeNumber(value.pageSize, 1);
  const total = wholeNumber(value.total, 0);
  if (page === null || pageSize === null || total === null)
    throw responseError();
  return {
    page,
    pageSize,
    total,
    items: value.items.map((item) => parseItem(item)),
  };
}

export function parseAwardingBody(value: unknown): AwardingBody {
  if (!isRecord(value)) throw responseError();
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const code = nullableString(value.code);
  const notificationEmails = stringList(value.notificationEmails);
  const active = requiredBoolean(value.active);
  const timestamps = parseTimestamps(value);
  if (
    !id ||
    !name ||
    code === undefined ||
    !notificationEmails ||
    active === null ||
    !timestamps
  ) {
    throw responseError();
  }
  return { id, name, code, notificationEmails, active, ...timestamps };
}

export function parseTrainingPartner(value: unknown): TrainingPartner {
  if (!isRecord(value)) throw responseError();
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const code = nullableString(value.code);
  const email = nullableString(value.email);
  const active = requiredBoolean(value.active);
  const timestamps = parseTimestamps(value);
  if (
    !id ||
    !name ||
    code === undefined ||
    email === undefined ||
    active === null ||
    !timestamps
  ) {
    throw responseError();
  }
  return { id, name, code, email, active, ...timestamps };
}

export function parseCentre(value: unknown): Centre {
  if (!isRecord(value)) throw responseError();
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const code = nullableString(value.code);
  const tpId = requiredString(value.tpId);
  const state =
    typeof value.state === "string" && isStateName(value.state)
      ? value.state
      : null;
  const active = requiredBoolean(value.active);
  const timestamps = parseTimestamps(value);
  if (
    !id ||
    !name ||
    code === undefined ||
    !tpId ||
    !state ||
    active === null ||
    !timestamps
  )
    throw responseError();
  return { id, name, code, tpId, state, active, ...timestamps };
}

function parsePc(value: unknown): PerformanceCriterion {
  if (!isRecord(value)) throw responseError();
  const pcId = requiredString(value.pcId);
  const code = requiredString(value.code);
  const name = requiredString(value.name);
  const passMark = nullableFinite(value.passMark);
  const maxMark = nullableFinite(value.maxMark);
  if (
    !pcId ||
    !code ||
    !name ||
    passMark === undefined ||
    maxMark === undefined
  )
    throw responseError();
  return { pcId, code, name, passMark, maxMark };
}

function parseNos(value: unknown): Nos {
  if (!isRecord(value) || !Array.isArray(value.pcs)) throw responseError();
  const nosId = requiredString(value.nosId);
  const code = requiredString(value.code);
  const name = requiredString(value.name);
  if (!nosId || !code || !name) throw responseError();
  const maxMarks =
    value.maxMarks === undefined ? null : parseComponent(value.maxMarks, true);
  return {
    nosId,
    code,
    name,
    maxMarks,
    pcs: value.pcs.map((item) => parsePc(item)),
  };
}

export function parseQualification(value: unknown): Qualification {
  if (!isRecord(value) || !Array.isArray(value.nos)) throw responseError();
  const id = requiredString(value.id);
  const code = requiredString(value.code);
  const name = requiredString(value.name);
  const sector =
    typeof value.sector === "string" && isSectorName(value.sector)
      ? value.sector
      : null;
  const ratioClass =
    typeof value.ratioClass === "string" && isRatioClass(value.ratioClass)
      ? value.ratioClass
      : null;
  const defaultBatchType =
    value.defaultBatchType === null
      ? null
      : value.defaultBatchType === "STT" || value.defaultBatchType === "LTT"
        ? value.defaultBatchType
        : undefined;
  const passCriteriaMode =
    value.passCriteriaMode === null
      ? null
      : value.passCriteriaMode === "nos_wise" ||
          value.passCriteriaMode === "overall"
        ? value.passCriteriaMode
        : undefined;
  const passMarkUnit =
    value.passMarkUnit === "percent" || value.passMarkUnit === "absolute"
      ? value.passMarkUnit
      : null;
  const pcPassMarksRequired = requiredBoolean(value.pcPassMarksRequired);
  const timestamps = parseTimestamps(value);
  if (
    !id ||
    !code ||
    !name ||
    !sector ||
    !ratioClass ||
    defaultBatchType === undefined ||
    passCriteriaMode === undefined ||
    !passMarkUnit ||
    pcPassMarksRequired === null ||
    !timestamps
  ) {
    throw responseError();
  }
  return {
    id,
    code,
    name,
    sector,
    ratioClass,
    defaultBatchType,
    passCriteriaMode,
    passMarkUnit,
    passMarks: parsePassMarks(value.passMarks),
    maxMarks:
      value.maxMarks === undefined
        ? null
        : parseComponent(value.maxMarks, true),
    nos: value.nos.map((item) => parseNos(item)),
    pcPassMarksRequired,
    ...timestamps,
  };
}

export function parseLearner(value: unknown): Learner {
  if (!isRecord(value)) throw responseError();
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const externalRef = nullableString(value.externalRef);
  const phone = nullableString(value.phone);
  // Older servers do not send the X-45 fields.
  const optional = (v: unknown) => (typeof v === "string" ? v : null);
  const accommodations = stringList(value.accommodations);
  const active = requiredBoolean(value.active);
  const timestamps = parseTimestamps(value);
  if (
    !id ||
    !name ||
    externalRef === undefined ||
    phone === undefined ||
    !accommodations ||
    active === null ||
    !timestamps
  ) {
    throw responseError();
  }
  return {
    id,
    name,
    externalRef,
    phone,
    enrolmentNumber: optional(value.enrolmentNumber),
    fatherName: optional(value.fatherName),
    gender: optional(value.gender),
    address: optional(value.address),
    accommodations,
    active,
    ...timestamps,
  };
}

function listQuery(
  path: string,
  query: ActiveListQuery & { tpId?: string; sector?: string },
): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page && query.page > 0 ? query.page : 1));
  const pageSize =
    query.pageSize && isMasterPageSize(query.pageSize)
      ? query.pageSize
      : MASTER_PAGE_SIZE_DEFAULT;
  params.set("pageSize", String(pageSize));
  if (query.active !== undefined)
    params.set("active", query.active ? "true" : "false");
  if (query.tpId) params.set("tpId", query.tpId);
  if (query.sector) params.set("sector", query.sector);
  return `${path}?${params.toString()}`;
}

export async function listAwardingBodies(
  query: ActiveListQuery,
  signal?: AbortSignal,
): Promise<MasterListPage<AwardingBody>> {
  const body = await apiRequest<unknown>(listQuery("/awarding-bodies", query), {
    signal,
  });
  return parseList(body, parseAwardingBody);
}

export async function createAwardingBody(
  input: AwardingBodyWrite,
): Promise<AwardingBody> {
  const body = await apiRequest<unknown>("/awarding-bodies", {
    method: "POST",
    body: input,
  });
  return parseAwardingBody(body);
}

export async function updateAwardingBody(
  id: string,
  input: AwardingBodyWrite,
): Promise<AwardingBody> {
  const body = await apiRequest<unknown>(
    `/awarding-bodies/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
  return parseAwardingBody(body);
}

export async function deactivateAwardingBody(
  id: string,
): Promise<AwardingBody> {
  const body = await apiRequest<unknown>(
    `/awarding-bodies/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return parseAwardingBody(body);
}

export async function listTrainingPartners(
  query: ActiveListQuery,
  signal?: AbortSignal,
): Promise<MasterListPage<TrainingPartner>> {
  const body = await apiRequest<unknown>(
    listQuery("/training-partners", query),
    { signal },
  );
  return parseList(body, parseTrainingPartner);
}

export async function createTrainingPartner(
  input: TrainingPartnerWrite,
): Promise<TrainingPartner> {
  const body = await apiRequest<unknown>("/training-partners", {
    method: "POST",
    body: input,
  });
  return parseTrainingPartner(body);
}

export async function updateTrainingPartner(
  id: string,
  input: TrainingPartnerWrite,
): Promise<TrainingPartner> {
  const body = await apiRequest<unknown>(
    `/training-partners/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: input,
    },
  );
  return parseTrainingPartner(body);
}

export async function deactivateTrainingPartner(
  id: string,
): Promise<TrainingPartner> {
  const body = await apiRequest<unknown>(
    `/training-partners/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return parseTrainingPartner(body);
}

export async function listCentres(
  query: CentreListQuery,
  signal?: AbortSignal,
): Promise<MasterListPage<Centre>> {
  const body = await apiRequest<unknown>(listQuery("/centres", query), {
    signal,
  });
  return parseList(body, parseCentre);
}

export async function createCentre(input: CentreWrite): Promise<Centre> {
  const body = await apiRequest<unknown>("/centres", {
    method: "POST",
    body: input,
  });
  return parseCentre(body);
}

export async function updateCentre(
  id: string,
  input: CentreWrite,
): Promise<Centre> {
  const body = await apiRequest<unknown>(`/centres/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
  return parseCentre(body);
}

export async function deactivateCentre(id: string): Promise<Centre> {
  const body = await apiRequest<unknown>(`/centres/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return parseCentre(body);
}

export async function listQualifications(
  query: QualificationListQuery,
  signal?: AbortSignal,
): Promise<MasterListPage<Qualification>> {
  const body = await apiRequest<unknown>(listQuery("/qualifications", query), {
    signal,
  });
  return parseList(body, parseQualification);
}

export async function getQualification(
  id: string,
  signal?: AbortSignal,
): Promise<Qualification> {
  const body = await apiRequest<unknown>(
    `/qualifications/${encodeURIComponent(id)}`,
    { signal },
  );
  return parseQualification(body);
}

export async function createQualification(
  input: QualificationWrite,
): Promise<Qualification> {
  const body = await apiRequest<unknown>("/qualifications", {
    method: "POST",
    body: input,
  });
  return parseQualification(body);
}

export async function updateQualification(
  id: string,
  input: QualificationWrite,
): Promise<Qualification> {
  const body = await apiRequest<unknown>(
    `/qualifications/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
  return parseQualification(body);
}

export async function deleteQualification(id: string): Promise<void> {
  const result = await apiRequestResult<unknown>(
    `/qualifications/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (result.status !== 204) {
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "Qualification delete response was not recognised.",
    );
  }
}

export async function listLearners(
  query: ActiveListQuery,
  signal?: AbortSignal,
): Promise<MasterListPage<Learner>> {
  const body = await apiRequest<unknown>(listQuery("/learners", query), {
    signal,
  });
  return parseList(body, parseLearner);
}

export async function createLearner(input: LearnerWrite): Promise<Learner> {
  const body = await apiRequest<unknown>("/learners", {
    method: "POST",
    body: input,
  });
  return parseLearner(body);
}

export async function updateLearner(
  id: string,
  input: LearnerWrite,
): Promise<Learner> {
  const body = await apiRequest<unknown>(
    `/learners/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
  return parseLearner(body);
}
