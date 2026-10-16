import { apiRequest } from "./client";

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
};

export type CandidateListResponse = {
  items: CandidateRecord[];
};

export type AddCandidateInput = {
  name?: string;
  externalRef?: string;
  learnerId?: string;
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
): Promise<CandidateRecord> {
  return apiRequest<CandidateRecord>(
    `/batches/${encodeURIComponent(batchId)}/candidates`,
    {
      method: "POST",
      body: input,
    },
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
