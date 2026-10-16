import { apiRequest } from "./client";

export type AccessSettings = {
  abReviewerCanReadAssessorPayments: boolean;
  ncvetViewerCanSeeAbQueue: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type SaveAccessSettingsInput = {
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
