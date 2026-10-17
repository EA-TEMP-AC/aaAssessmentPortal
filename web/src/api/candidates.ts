import { apiRequest } from "./client";

/** X-35: what happened to the student's login when an email was sent with the candidate. */
export type LoginStatus = "created" | "has_login" | "failed";

/** X-36: the sign-in id and first password of a student, for staff who manage the roster. */
export type StudentLogin = {
  loginId: string;
  /** Null once the student has changed it (or staff reset it elsewhere). */
  initialPassword: string | null;
  mustChangePassword: boolean;
  active: boolean;
};

export type CandidateRecord = {
  id: string;
  batchId: string;
  learnerId: string | null;
  name: string;
  externalRef: string | null;
  accommodations: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** On the roster list for staff who manage it: null means the student has no login yet. */
  login?: StudentLogin | null;
};

export type AddedCandidate = Omit<CandidateRecord, "login"> & {
  login?: { status: LoginStatus; emailQueued: boolean };
};

export type CandidateListResponse = {
  items: CandidateRecord[];
};

export type AddCandidateInput = {
  name?: string;
  externalRef?: string;
  learnerId?: string;
  /** X-36: the student's email. Used as the sign-in id when valid and free; never blocks the add. */
  email?: string;
  accommodations?: string[];
  ratioOverrideReason?: string;
};

export type PatchCandidateInput = {
  active?: boolean;
  accommodations?: string[];
  ratioOverrideReason?: string;
};

export type CsvImportRowError = {
  row: number;
  reason: string;
};

export type CsvImportResponse = {
  created: number;
  skipped: number;
  errors: CsvImportRowError[];
  /** X-36: every student added gets a login. */
  logins?: { created: number; existing: number; failed: number };
};

export async function listCandidates(
  batchId: string,
  filter?: { active?: boolean },
  signal?: AbortSignal,
): Promise<CandidateListResponse> {
  const params = new URLSearchParams();
  if (filter?.active !== undefined) {
    params.set("active", String(filter.active));
  }
  const query = params.toString();
  const path = `/batches/${encodeURIComponent(batchId)}/candidates${query ? `?${query}` : ""}`;
  return apiRequest<CandidateListResponse>(path, { signal });
}

export async function addCandidate(
  batchId: string,
  input: AddCandidateInput,
): Promise<AddedCandidate> {
  return apiRequest<AddedCandidate>(
    `/batches/${encodeURIComponent(batchId)}/candidates`,
    {
      method: "POST",
      body: input,
    },
  );
}

/** X-36: creates the login of a student who has none, or with `reset` gives a new first password. */
export async function createStudentLogin(
  batchId: string,
  candidateId: string,
  reset = false,
): Promise<{ status: "created" | "has_login" | "reset" }> {
  return apiRequest(
    `/batches/${encodeURIComponent(batchId)}/candidates/${encodeURIComponent(candidateId)}/login`,
    { method: "POST", body: reset ? { reset: true } : {} },
  );
}

export async function patchCandidate(
  batchId: string,
  candidateId: string,
  input: PatchCandidateInput,
): Promise<CandidateRecord> {
  return apiRequest<CandidateRecord>(
    `/batches/${encodeURIComponent(batchId)}/candidates/${encodeURIComponent(candidateId)}`,
    {
      method: "PATCH",
      body: input,
    },
  );
}

export async function importCandidatesCsv(
  batchId: string,
  fileOrText: File | string,
  ratioOverrideReason?: string,
): Promise<CsvImportResponse> {
  const params = new URLSearchParams();
  if (ratioOverrideReason?.trim()) {
    params.set("ratioOverrideReason", ratioOverrideReason.trim());
  }
  const query = params.toString();
  const path = `/batches/${encodeURIComponent(batchId)}/candidates/import${query ? `?${query}` : ""}`;

  if (typeof fileOrText === "string") {
    return apiRequest<CsvImportResponse>(path, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: fileOrText,
    });
  }

  const formData = new FormData();
  formData.append("file", fileOrText);
  if (ratioOverrideReason?.trim()) {
    formData.append("ratioOverrideReason", ratioOverrideReason.trim());
  }

  return apiRequest<CsvImportResponse>(path, {
    method: "POST",
    body: formData,
  });
}
