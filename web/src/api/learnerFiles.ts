import { apiRequest } from "./client";

/** X-47. A student's photo and identity card pictures. Admin and MIS only. */
export const IDENTITY_DOC_TYPES = ["aadhaar_card", "driving_licence", "voter_id"] as const;
export type IdentityDocType = (typeof IDENTITY_DOC_TYPES)[number];

export const IDENTITY_DOC_LABELS: Record<IdentityDocType, string> = {
  aadhaar_card: "Aadhaar card",
  driving_licence: "Driving licence",
  voter_id: "Voter ID card",
};

export type LearnerFile = {
  id: string;
  learnerId: string;
  kind: "photo" | "identity";
  docType: IdentityDocType | null;
  contentType: string;
  size: number;
  uploadedAt: string;
};

export async function listLearnerFiles(
  learnerId: string,
  signal?: AbortSignal,
): Promise<LearnerFile[]> {
  const body = await apiRequest<{ items?: LearnerFile[] }>(
    `/learners/${encodeURIComponent(learnerId)}/files`,
    { signal },
  );
  return Array.isArray(body?.items) ? body.items : [];
}

export async function uploadLearnerFile(
  learnerId: string,
  input: { kind: "photo" | "identity"; docType?: IdentityDocType; file: File },
): Promise<LearnerFile> {
  const form = new FormData();
  form.set("kind", input.kind);
  if (input.docType) form.set("docType", input.docType);
  form.set("file", input.file);
  return apiRequest<LearnerFile>(
    `/learners/${encodeURIComponent(learnerId)}/files`,
    { method: "POST", body: form },
  );
}

export async function fetchLearnerFile(
  learnerId: string,
  fileId: string,
): Promise<Blob> {
  const response = await apiRequest<Response>(
    `/learners/${encodeURIComponent(learnerId)}/files/${encodeURIComponent(fileId)}`,
    { raw: true },
  );
  return response.blob();
}
