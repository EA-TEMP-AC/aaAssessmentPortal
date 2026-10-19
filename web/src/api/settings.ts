import { apiRequest } from "./client";

export type AccessSettings = {
  abReviewerCanReadAssessorPayments: boolean;
  ncvetViewerCanSeeAbQueue: boolean;
  aadhaarVisibility: AadhaarVisibility;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AadhaarVisibility = "hidden" | "masked" | "full";

export type SaveAccessSettingsInput = {
  aadhaarVisibility?: AadhaarVisibility;
  abReviewerCanReadAssessorPayments?: boolean;
  ncvetViewerCanSeeAbQueue?: boolean;
};

export async function getAccessSettings(
  signal?: AbortSignal,
): Promise<AccessSettings> {
  return apiRequest<AccessSettings>("/settings/access", { signal });
}

export async function saveAccessSettings(
  body: SaveAccessSettingsInput,
  signal?: AbortSignal,
): Promise<AccessSettings> {
  return apiRequest<AccessSettings>("/settings/access", {
    method: "PUT",
    body,
    signal,
  });
}
