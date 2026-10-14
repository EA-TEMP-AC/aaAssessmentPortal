import type {
  AssignedBatch,
  RosterCandidate,
} from "../domain/batch";
import type { AttendanceRecordInput, ChecklistItemInput } from "../queue/types";
import { isPermanentRejection, readErrorBody, readJson, type RejectedResult } from "./http";
import { stableStringify } from "./loginEvents";

export type AttendancePostResult =
  | { kind: "success"; items: unknown[] }
  | { kind: "conflict"; code: "CONFLICT_IDEMPOTENT"; message: string }
  | RejectedResult
  | { kind: "retryable"; message: string }
  | { kind: "unauthorized"; message: string };

export type ChecklistPostResult =
  | {
      kind: "success";
      replayed: boolean;
      batchStatus: string | null;
      batchStatusVersion: number | null;
      checklist: unknown;
    }
  | { kind: "conflict"; code: "CONFLICT_IDEMPOTENT"; message: string }
  | RejectedResult
  | { kind: "retryable"; message: string }
  | { kind: "unauthorized"; message: string };

export type AttendanceRequestBody = {
  capturedAt: string;
  records: AttendanceRecordInput[];
};

export type ChecklistRequestBody = {
  clientEventId: string;
  capturedAt: string;
  items: ChecklistItemInput[];
  completeAssessment?: boolean;
};

export type BatchFieldApi = {
  listAssignedBatches(accessToken: string): Promise<AssignedBatch[]>;
  getBatch(batchId: string, accessToken: string): Promise<AssignedBatch>;
  getCandidates(batchId: string, accessToken: string): Promise<RosterCandidate[]>;
  postAttendance(
    batchId: string,
    body: AttendanceRequestBody,
    accessToken: string,
  ): Promise<AttendancePostResult>;
  postChecklist(
    batchId: string,
    body: ChecklistRequestBody,
    accessToken: string,
  ): Promise<ChecklistPostResult>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createLiveBatchApi(options: {
  baseUrl: string;
  fetchImpl?: FetchLike;
}): BatchFieldApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  function authHeaders(accessToken: string) {
    return {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    };
  }

  return {
    async listAssignedBatches(accessToken) {
      const response = await fetchImpl(`${baseUrl}/batches`, {
        method: "GET",
        headers: authHeaders(accessToken),
      });
      const payload = await readJson(response);
      if (response.status === 200 && payload && typeof payload === "object") {
        const body = payload as { items?: AssignedBatch[] };
        return body.items ?? [];
      }
      const err = readErrorBody(payload, "Failed to fetch batches");
      throw new Error(`${err.code}: ${err.message}`);
    },

    async getBatch(batchId, accessToken) {
      const response = await fetchImpl(`${baseUrl}/batches/${batchId}`, {
        method: "GET",
        headers: authHeaders(accessToken),
      });
      const payload = await readJson(response);
      if (response.status === 200 && payload && typeof payload === "object") {
        return payload as AssignedBatch;
      }
      const err = readErrorBody(payload, "Failed to fetch batch");
      throw new Error(`${err.code}: ${err.message}`);
    },

    async getCandidates(batchId, accessToken) {
      const response = await fetchImpl(`${baseUrl}/batches/${batchId}/candidates`, {
        method: "GET",
        headers: authHeaders(accessToken),
      });
      const payload = await readJson(response);
      if (response.status === 200 && payload && typeof payload === "object") {
        const body = payload as { items?: RosterCandidate[] };
        return body.items ?? [];
      }
      const err = readErrorBody(payload, "Failed to fetch candidates");
      throw new Error(`${err.code}: ${err.message}`);
    },

    async postAttendance(batchId, body, accessToken) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/assessor/batches/${batchId}/attendance`, {
          method: "POST",
          headers: authHeaders(accessToken),
          body: JSON.stringify({
            capturedAt: body.capturedAt,
            records: body.records.map((r) => {
              const record: Record<string, unknown> = {
                candidateId: r.candidateId,
                present: r.present,
              };
              if (r.idVerified !== undefined) record.idVerified = r.idVerified;
              if (r.note) record.note = r.note;
              return record;
            }),
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network request failed";
        return { kind: "retryable", message };
      }

      const payload = await readJson(response);
      if (response.status === 200) {
        const bodyRes = payload as { items?: unknown[] };
        return { kind: "success", items: bodyRes?.items ?? [] };
      }

      const error = readErrorBody(payload, `Attendance submission failed (${response.status})`);
      if (response.status === 401) {
        return { kind: "unauthorized", message: error.message };
      }
      if (response.status === 409 && error.code === "CONFLICT_IDEMPOTENT") {
        return { kind: "conflict", code: "CONFLICT_IDEMPOTENT", message: error.message };
      }
      if (isPermanentRejection(response.status, error.code)) {
        return { kind: "rejected", status: response.status, code: error.code, message: error.message };
      }
      return { kind: "retryable", message: `${error.code}: ${error.message}` };
    },

    async postChecklist(batchId, body, accessToken) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/assessor/batches/${batchId}/checklist`, {
          method: "POST",
          headers: authHeaders(accessToken),
          body: JSON.stringify({
            clientEventId: body.clientEventId,
            capturedAt: body.capturedAt,
            items: body.items.map((i) => {
              const item: Record<string, unknown> = {
                key: i.key,
                available: i.available,
              };
              if (i.label) item.label = i.label;
              if (i.note) item.note = i.note;
              return item;
            }),
            completeAssessment: body.completeAssessment ?? false,
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network request failed";
        return { kind: "retryable", message };
      }

      const payload = await readJson(response);
      if (response.status === 200) {
        const bodyRes = payload as {
          replayed?: boolean;
          batchStatus?: string;
          batchStatusVersion?: number;
        };
        return {
          kind: "success",
          replayed: bodyRes?.replayed === true,
          batchStatus: bodyRes?.batchStatus ?? null,
          batchStatusVersion: bodyRes?.batchStatusVersion ?? null,
          checklist: payload,
        };
      }

      const error = readErrorBody(payload, `Checklist submission failed (${response.status})`);
      if (response.status === 401) {
        return { kind: "unauthorized", message: error.message };
      }
      if (response.status === 409 && error.code === "CONFLICT_IDEMPOTENT") {
        return { kind: "conflict", code: "CONFLICT_IDEMPOTENT", message: error.message };
      }
      if (isPermanentRejection(response.status, error.code)) {
        return { kind: "rejected", status: response.status, code: error.code, message: error.message };
      }
      return { kind: "retryable", message: `${error.code}: ${error.message}` };
    },
  };
}

export function createMockBatchApi(options?: {
  sampleBatch?: AssignedBatch;
  sampleRoster?: RosterCandidate[];
}): BatchFieldApi {
  const defaultBatch: AssignedBatch = options?.sampleBatch ?? {
    id: "66f000000000000000000010",
    type: "STT",
    mode: "offline",
    status: "in_progress",
    statusVersion: 1,
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    assessmentLanguage: "Hindi",
    candidateCount: 2,
    abId: "66f000000000000000000001",
  };

  const defaultRoster: RosterCandidate[] = options?.sampleRoster ?? [
    {
      id: "66f000000000000000000011",
      batchId: defaultBatch.id,
      learnerId: "66f000000000000000000021",
      name: "Asha Devi",
      externalRef: "R-1",
      active: true,
    },
    {
      id: "66f000000000000000000012",
      batchId: defaultBatch.id,
      learnerId: "66f000000000000000000022",
      name: "Bala Kumar",
      externalRef: "R-2",
      active: true,
    },
  ];

  const seenChecklists = new Map<string, { canonical: string; response: unknown }>();

  return {
    async listAssignedBatches() {
      return [defaultBatch];
    },

    async getBatch(id) {
      if (id === defaultBatch.id) return defaultBatch;
      throw new Error(`Batch not found: ${id}`);
    },

    async getCandidates(batchId) {
      return defaultRoster.filter((c) => c.batchId === batchId);
    },

    async postAttendance(_batchId, body) {
      return {
        kind: "success",
        items: body.records.map((r) => ({
          candidateId: r.candidateId,
          present: r.present,
          idVerified: r.idVerified ?? null,
          note: r.note ?? null,
          capturedAt: body.capturedAt,
        })),
      };
    },

    async postChecklist(batchId, body) {
      const canonical = stableStringify(body);
      const existing = seenChecklists.get(body.clientEventId);
      if (existing) {
        if (existing.canonical !== canonical) {
          return {
            kind: "conflict",
            code: "CONFLICT_IDEMPOTENT",
            message: "Same clientEventId with a different payload",
          };
        }
        return {
          kind: "success",
          replayed: true,
          batchStatus: body.completeAssessment ? "assessment_completed" : "in_progress",
          batchStatusVersion: 2,
          checklist: existing.response,
        };
      }

      const res = {
        id: "chk-mock-" + body.clientEventId,
        clientEventId: body.clientEventId,
        batchId,
        items: body.items,
        completeAssessment: body.completeAssessment ?? false,
      };
      seenChecklists.set(body.clientEventId, { canonical, response: res });

      return {
        kind: "success",
        replayed: false,
        batchStatus: body.completeAssessment ? "assessment_completed" : "in_progress",
        batchStatusVersion: body.completeAssessment ? 2 : 1,
        checklist: res,
      };
    },
  };
}

export function createBatchApi(options: {
  mode: "mock" | "live";
  baseUrl: string;
  fetchImpl?: FetchLike;
}): BatchFieldApi {
  if (options.mode === "live") {
    return createLiveBatchApi({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl });
  }
  return createMockBatchApi();
}
