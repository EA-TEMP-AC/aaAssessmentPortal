import { describe, expect, it } from "@jest/globals";
import type { BatchFieldApi } from "../api/batchApi";
import type { LoginEventApi } from "../api/loginEvents";
import { createEventQueue } from "../queue/eventQueue";
import type { QueuedItem } from "../queue/types";
import { MemoryStorage } from "../storage/memoryStorage";
import { syncQueue } from "./syncQueue";

const dummyLoginApi: LoginEventApi = {
  async post() {
    return {
      kind: "success",
      replayed: false,
      lateSync: false,
      clockSkewFlag: false,
      abEmailQueuedAt: null,
      abEmailSentAt: null,
    };
  },
};

describe("syncQueue for attendance and checklist field writes", () => {
  it("syncs queued attendance to POST /assessor/batches/:id/attendance", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    const attEvt = await queue.enqueue({
      type: "attendance",
      userId: "user-asr",
      batchId: "batch-01",
      capturedAt: "2026-11-20T05:00:00.000Z",
      records: [{ candidateId: "cand-1", present: true, idVerified: true }],
    });

    const postedRecords: unknown[] = [];
    const mockBatchApi: BatchFieldApi = {
      async listAssignedBatches() {
        return [];
      },
      async getBatch() {
        throw new Error("not implemented");
      },
      async getCandidates() {
        return [];
      },
      async postAttendance(batchId, body) {
        postedRecords.push({ batchId, body });
        return {
          kind: "success",
          items: [{ candidateId: "cand-1", present: true, idVerified: true }],
        };
      },
      async postChecklist() {
        throw new Error("not implemented");
      },
    };

    const report = await syncQueue({
      queue,
      api: dummyLoginApi,
      batchApi: mockBatchApi,
      accessToken: "token-asr",
      userId: "user-asr",
      online: true,
      now: () => 10_000,
    });

    expect(report.synced).toBe(1);
    expect(report.conflicts).toBe(0);
    expect(postedRecords).toHaveLength(1);

    const [stored] = await queue.list<QueuedItem>();
    expect(stored?.status).toBe("synced");
    expect(stored?.clientEventId).toBe(attEvt.clientEventId);
  });

  it("syncs queued checklist and completes assessment", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    await queue.enqueue({
      type: "checklist",
      userId: "user-asr",
      batchId: "batch-01",
      capturedAt: "2026-11-20T05:00:00.000Z",
      items: [{ key: "cctv", available: true }],
      completeAssessment: true,
    });

    const mockBatchApi: BatchFieldApi = {
      async listAssignedBatches() {
        return [];
      },
      async getBatch() {
        throw new Error("not implemented");
      },
      async getCandidates() {
        return [];
      },
      async postAttendance() {
        throw new Error("not implemented");
      },
      async postChecklist(batchId, body) {
        return {
          kind: "success",
          replayed: false,
          batchStatus: "assessment_completed",
          batchStatusVersion: 5,
          checklist: { ...body, batchId },
        };
      },
    };

    const report = await syncQueue({
      queue,
      api: dummyLoginApi,
      batchApi: mockBatchApi,
      accessToken: "token-asr",
      userId: "user-asr",
      online: true,
      now: () => 10_000,
    });

    expect(report.synced).toBe(1);
    const [stored] = await queue.list<QueuedItem>();
    expect(stored?.status).toBe("synced");
  });

  it("keeps queue and applies backoff on retryable network errors", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    await queue.enqueue({
      type: "attendance",
      userId: "user-asr",
      batchId: "batch-01",
      capturedAt: "2026-11-20T05:00:00.000Z",
      records: [{ candidateId: "cand-1", present: true }],
    });

    const mockBatchApi: BatchFieldApi = {
      async listAssignedBatches() {
        return [];
      },
      async getBatch() {
        throw new Error("not implemented");
      },
      async getCandidates() {
        return [];
      },
      async postAttendance() {
        return { kind: "retryable", message: "Network request failed" };
      },
      async postChecklist() {
        throw new Error("not implemented");
      },
    };

    const report = await syncQueue({
      queue,
      api: dummyLoginApi,
      batchApi: mockBatchApi,
      accessToken: "token-asr",
      userId: "user-asr",
      online: true,
      now: () => 1_000,
    });

    expect(report.attempted).toBe(1);
    expect(report.synced).toBe(0);
    expect(report.stopped).toBe("backoff");

    const [stored] = await queue.list<QueuedItem>();
    expect(stored?.status).toBe("pending");
    expect(stored?.attempts).toBe(1);
    expect(stored?.lastError).toBe("Network request failed");
    expect(stored?.nextAttemptAt).toBe(1_000 + 1_000); // 1s initial backoff
  });

  it("handles 409 CONFLICT_IDEMPOTENT: kept in queue, not retried, shown in snapshot", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    await queue.enqueue({
      type: "checklist",
      userId: "user-asr",
      batchId: "batch-01",
      capturedAt: "2026-11-20T05:00:00.000Z",
      items: [{ key: "cctv", available: true }],
      completeAssessment: false,
    });

    const mockBatchApi: BatchFieldApi = {
      async listAssignedBatches() {
        return [];
      },
      async getBatch() {
        throw new Error("not implemented");
      },
      async getCandidates() {
        return [];
      },
      async postAttendance() {
        throw new Error("not implemented");
      },
      async postChecklist() {
        return {
          kind: "conflict",
          code: "CONFLICT_IDEMPOTENT",
          message: "Same clientEventId with a different payload",
        };
      },
    };

    const report = await syncQueue({
      queue,
      api: dummyLoginApi,
      batchApi: mockBatchApi,
      accessToken: "token-asr",
      userId: "user-asr",
      online: true,
      now: () => 10_000,
    });

    expect(report.conflicts).toBe(1);
    expect(report.synced).toBe(0);

    const [stored] = await queue.list<QueuedItem>();
    expect(stored?.status).toBe("conflict");
    expect(stored?.conflict?.code).toBe("CONFLICT_IDEMPOTENT");

    const snapshot = await queue.snapshot();
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0]?.message).toBe("Same clientEventId with a different payload");
  });

  it("treats duplicate replay as success", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    await queue.enqueue({
      type: "checklist",
      userId: "user-asr",
      batchId: "batch-01",
      capturedAt: "2026-11-20T05:00:00.000Z",
      items: [{ key: "cctv", available: true }],
      completeAssessment: false,
    });

    const mockBatchApi: BatchFieldApi = {
      async listAssignedBatches() {
        return [];
      },
      async getBatch() {
        throw new Error("not implemented");
      },
      async getCandidates() {
        return [];
      },
      async postAttendance() {
        throw new Error("not implemented");
      },
      async postChecklist() {
        return {
          kind: "success",
          replayed: true,
          batchStatus: "in_progress",
          batchStatusVersion: 2,
          checklist: {},
        };
      },
    };

    const report = await syncQueue({
      queue,
      api: dummyLoginApi,
      batchApi: mockBatchApi,
      accessToken: "token-asr",
      userId: "user-asr",
      online: true,
      now: () => 10_000,
    });

    expect(report.synced).toBe(1);
    const [stored] = await queue.list<QueuedItem>();
    expect(stored?.status).toBe("synced");
  });
});
