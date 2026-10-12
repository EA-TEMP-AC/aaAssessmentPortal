import { describe, expect, it } from "@jest/globals";
import { createMockBatchApi, type BatchFieldApi } from "../api/batchApi";
import { createBatchStore } from "../storage/batchStore";
import { MemoryStorage } from "../storage/memoryStorage";
import { downloadAssignedBatch } from "./downloadBatch";

const BATCH_ID = "66f000000000000000000010";

function counting(api: BatchFieldApi) {
  const calls: string[] = [];
  const wrapped: BatchFieldApi = {
    ...api,
    async listAssignedBatches(token) {
      calls.push("list");
      return api.listAssignedBatches(token);
    },
    async getCandidates(batchId, token) {
      calls.push(`candidates ${batchId}`);
      return api.getCandidates(batchId, token);
    },
  };
  return { api: wrapped, calls };
}

describe("downloadAssignedBatch", () => {
  it("caches the batch for a proctor without asking for the roster", async () => {
    const store = createBatchStore(new MemoryStorage());
    const { api, calls } = counting(createMockBatchApi());
    const result = await downloadAssignedBatch({ api, store, role: "proctor", accessToken: "t" });
    expect(result.kind).toBe("saved");
    expect(calls).toEqual(["list"]);
    const cached = await store.getBatch();
    expect(cached?.batch.id).toBe(BATCH_ID);
    expect(cached?.roster).toEqual([]);
  });

  it("caches the batch and the roster rows the server returns for a candidate and an assessor", async () => {
    for (const role of ["candidate", "assessor"]) {
      const store = createBatchStore(new MemoryStorage());
      const { api, calls } = counting(createMockBatchApi());
      const result = await downloadAssignedBatch({ api, store, role, accessToken: "t" });
      expect(result.kind).toBe("saved");
      expect(calls).toEqual(["list", `candidates ${BATCH_ID}`]);
      expect((await store.getBatch())?.roster).toHaveLength(2);
    }
  });

  it("reports when the server lists no batch and caches nothing", async () => {
    const store = createBatchStore(new MemoryStorage());
    const api: BatchFieldApi = { ...createMockBatchApi(), listAssignedBatches: async () => [] };
    expect(await downloadAssignedBatch({ api, store, role: "candidate", accessToken: "t" })).toEqual({
      kind: "none",
    });
    expect(await store.getBatch()).toBeNull();
  });

  it("keeps the cached batch readable offline after the download", async () => {
    const storage = new MemoryStorage();
    await downloadAssignedBatch({
      api: createMockBatchApi(),
      store: createBatchStore(storage),
      role: "proctor",
      accessToken: "t",
    });
    // A restart with no network: a new store over the same storage.
    expect((await createBatchStore(storage).getBatch())?.batch.assessmentStartDate).toBe("2026-11-20");
  });
});
