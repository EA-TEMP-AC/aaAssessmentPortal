import { apiRequest, ApiError } from "./client";

export const EVIDENCE_KINDS = [
  "photo",
  "id_proof",
  "attendance",
  "equipment",
  "other",
  "video",
  "proctor_snapshot",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const KIND_LABELS: Record<EvidenceKind, string> = {
  photo: "Photo",
  id_proof: "ID proof",
  attendance: "Attendance",
  equipment: "Equipment",
  other: "Other",
  video: "Video",
  proctor_snapshot: "Proctor snapshot",
};

export type VerifyResult = "ok" | "mismatch" | "missing";

export type Verification = {
  at: string;
  byUserId: string | null;
  result: VerifyResult;
  expectedSha256: string | null;
  actualSha256: string | null;
  actualSize: number | null;
};

export type EvidenceRow = {
  id: string;
  batchId: string;
  candidateId: string | null;
  kind: string;
  contentType: string;
  size: number;
  sha256: string;
  uploaderId: string;
  uploaderRole: string;
  capturedAt: string;
  uploadedAt: string;
  locationStatus: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  locationUnavailableReason: string | null;
  hasLocation: boolean;
  deviceId: string | null;
  verification: Verification | null;
  verifyCount: number;
};

export type EvidencePage = { page: number; pageSize: number; total: number; items: EvidenceRow[] };

export type EvidenceQuery = {
  batchId?: string;
  candidateId?: string;
  kind?: string;
  uploaderId?: string;
  /** X-06: the snapshots of one proctoring session. */
  sessionId?: string;
  from?: string;
  to?: string;
  hasLocation?: "true" | "false" | "";
  page?: number;
  pageSize?: number;
};

export type VerifyResponse = { id: string; sha256: string; verifyCount: number; verification: Verification };

/** What GET /evidence/:id/file gave back: a short-lived link (S3) or the bytes (local disk). */
export type EvidenceFile =
  | { mode: "link"; url: string; expiresAt: string | null }
  | { mode: "bytes"; blob: Blob };

function bad(what: string): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", `${what} response was not recognised.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseVerification(value: unknown): Verification | null {
  if (!isRecord(value)) return null;
  const at = str(value.at);
  const result = value.result;
  if (!at || (result !== "ok" && result !== "mismatch" && result !== "missing")) return null;
  return {
    at,
    byUserId: nullableStr(value.byUserId),
    result,
    expectedSha256: nullableStr(value.expectedSha256),
    actualSha256: nullableStr(value.actualSha256),
    actualSize: nullableNum(value.actualSize),
  };
}

function parseRow(value: unknown): EvidenceRow {
  if (!isRecord(value)) throw bad("Evidence");
  const id = str(value.id);
  const batchId = str(value.batchId);
  const kind = str(value.kind);
  const contentType = str(value.contentType);
  const sha256 = str(value.sha256);
  const uploaderId = str(value.uploaderId);
  const capturedAt = str(value.capturedAt);
  const uploadedAt = str(value.uploadedAt);
  const locationStatus = str(value.locationStatus);
  const size = nullableNum(value.size);
  if (
    !id || !batchId || !kind || !contentType || !sha256 || !uploaderId || !capturedAt || !uploadedAt ||
    !locationStatus || size === null
  ) {
    throw bad("Evidence");
  }
  return {
    id,
    batchId,
    candidateId: nullableStr(value.candidateId),
    kind,
    contentType,
    size,
    sha256,
    uploaderId,
    uploaderRole: nullableStr(value.uploaderRole) ?? "",
    capturedAt,
    uploadedAt,
    locationStatus,
    latitude: nullableNum(value.latitude),
    longitude: nullableNum(value.longitude),
    accuracy: nullableNum(value.accuracy),
    locationUnavailableReason: nullableStr(value.locationUnavailableReason),
    hasLocation: value.hasLocation === true,
    deviceId: nullableStr(value.deviceId),
    verification: parseVerification(value.verification),
    verifyCount: nullableNum(value.verifyCount) ?? 0,
  };
}

export async function listEvidence(query: EvidenceQuery, signal?: AbortSignal): Promise<EvidencePage> {
  const params = new URLSearchParams();
  for (const key of ["batchId", "candidateId", "kind", "uploaderId", "sessionId", "from", "to", "hasLocation"] as const) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }
  params.set("page", String(query.page && query.page > 0 ? query.page : 1));
  if (query.pageSize && query.pageSize > 0) params.set("pageSize", String(query.pageSize));

  const body = await apiRequest<unknown>(`/evidence?${params.toString()}`, { signal });
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad("Evidence list");
  const page = nullableNum(body.page);
  const pageSize = nullableNum(body.pageSize);
  const total = nullableNum(body.total);
  if (page === null || pageSize === null || total === null || pageSize < 1) throw bad("Evidence list");
  return { page, pageSize, total, items: body.items.map(parseRow) };
}

export async function verifyEvidence(id: string): Promise<VerifyResponse> {
  const body = await apiRequest<unknown>(`/evidence/${encodeURIComponent(id)}/verify`, { method: "POST" });
  if (!isRecord(body)) throw bad("Verify");
  const verification = parseVerification(body.verification);
  if (!verification) throw bad("Verify");
  return {
    id: str(body.id) ?? id,
    sha256: nullableStr(body.sha256) ?? "",
    verifyCount: nullableNum(body.verifyCount) ?? 0,
    verification,
  };
}

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Handles both download modes. The type of the blob comes from the stored row,
 * not from the response, so a wrong header cannot turn a file into something else.
 */
export async function fetchEvidenceFile(row: Pick<EvidenceRow, "id" | "contentType">): Promise<EvidenceFile> {
  const response = await apiRequest<Response>(`/evidence/${encodeURIComponent(row.id)}/file`, { raw: true });
  const type = response.headers.get("Content-Type") ?? "";
  if (type.toLowerCase().includes("application/json")) {
    const body: unknown = await response.json();
    const url = isRecord(body) ? str(body.url) : null;
    if (!url || !isWebUrl(url)) throw bad("File");
    return { mode: "link", url, expiresAt: isRecord(body) ? nullableStr(body.expiresAt) : null };
  }
  const bytes = await response.arrayBuffer();
  return { mode: "bytes", blob: new Blob([bytes], { type: row.contentType }) };
}
