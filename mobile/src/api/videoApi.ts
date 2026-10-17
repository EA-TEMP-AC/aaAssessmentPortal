import { isPermanentRejection, readErrorBody, readJson } from "./http";

export type VivaQuestion = {
  id: string;
  type: "viva" | "practical";
  nosId: string;
  pcId: string;
  stem: string;
  marks: number;
};

export type VideoPart = "practical" | "viva";

export type VideoUploadMeta = {
  clientEventId: string;
  batchId: string;
  candidateId: string;
  part: VideoPart;
  questionId?: string;
  capturedAt: string;
  deviceId?: string;
  uri: string;
};

export type VideoUploadResult =
  | { kind: "success" }
  | { kind: "unauthorized"; message: string }
  | { kind: "retryable"; message: string }
  | { kind: "rejected"; message: string };

export type VideoApi = {
  getVivaQuestions(batchId: string, accessToken: string): Promise<VivaQuestion[]>;
  uploadVideo(meta: VideoUploadMeta, accessToken: string): Promise<VideoUploadResult>;
};

type Options = { baseUrl: string; fetchImpl?: typeof fetch };

/** X-40. The viva questions to show, and the upload of one recorded video (practical or viva). */
export function createVideoApi({ baseUrl, fetchImpl = fetch }: Options): VideoApi {
  return {
    async getVivaQuestions(batchId, accessToken) {
      const response = await fetchImpl(`${baseUrl}/assessor/batches/${batchId}/viva-questions`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      const payload = await readJson(response);
      if (response.status === 200 && payload && typeof payload === "object") {
        return (payload as { items?: VivaQuestion[] }).items ?? [];
      }
      const err = readErrorBody(payload, "Failed to fetch viva questions");
      throw new Error(`${err.code}: ${err.message}`);
    },

    async uploadVideo(meta, accessToken) {
      const form = new FormData();
      form.append("clientEventId", meta.clientEventId);
      form.append("kind", "video");
      form.append("part", meta.part);
      form.append("candidateId", meta.candidateId);
      form.append("capturedAt", meta.capturedAt);
      if (meta.questionId) form.append("questionId", meta.questionId);
      if (meta.deviceId) form.append("deviceId", meta.deviceId);
      // React Native reads the file from this uri when the request is sent.
      form.append("file", {
        uri: meta.uri,
        name: `${meta.clientEventId}.mp4`,
        type: "video/mp4",
      } as unknown as Blob);

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/batches/${meta.batchId}/evidence`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          body: form,
        });
      } catch (err) {
        return {
          kind: "retryable",
          message: err instanceof Error ? err.message : "Network request failed",
        };
      }
      // 200 is a repeat of an upload the server already holds.
      if (response.status === 201 || response.status === 200) return { kind: "success" };
      const payload = await readJson(response);
      const error = readErrorBody(payload, `Upload failed (${response.status})`);
      if (response.status === 401) return { kind: "unauthorized", message: error.message };
      // A switched-off batch (409 BATCH_FEATURE_OFF) and oversize files (413) cannot succeed on retry.
      if (
        isPermanentRejection(response.status, error.code) ||
        response.status === 413 ||
        response.status === 415 ||
        error.code === "BATCH_FEATURE_OFF" ||
        error.code === "CONFLICT_IDEMPOTENT"
      ) {
        return { kind: "rejected", message: error.message };
      }
      return { kind: "retryable", message: error.message };
    },
  };
}
