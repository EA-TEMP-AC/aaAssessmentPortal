import { describe, expect, it, jest } from "@jest/globals";
import { createLiveBatchApi, createMockBatchApi } from "./batchApi";

describe("batchApi live implementation", () => {
  it("fetches assigned batches and roster candidates with auth bearer", async () => {
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer access-token-123",
      });
      if (url.endsWith("/batches")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "batch-1",
                type: "STT",
                mode: "offline",
                status: "in_progress",
                statusVersion: 1,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/batches/batch-1/candidates")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "cand-1",
                batchId: "batch-1",
                learnerId: "lrn-1",
                name: "Asha Devi",
                active: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const api = createLiveBatchApi({
      baseUrl: "http://127.0.0.1:3000/api/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const batches = await api.listAssignedBatches("access-token-123");
    expect(batches).toHaveLength(1);
    expect(batches[0]?.id).toBe("batch-1");

    const candidates = await api.getCandidates("batch-1", "access-token-123");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("Asha Devi");
  });

  it("submits attendance and parses successful response", async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      const parsedBody = JSON.parse(init?.body as string);
      expect(parsedBody.capturedAt).toBe("2026-11-20T05:00:00.000Z");
      expect(parsedBody.records).toHaveLength(1);
      return new Response(
        JSON.stringify({
          items: [
            {
              candidateId: "cand-1",
              present: true,
            },
          ],
        }),
        { status: 200 },
      );
    });

    const api = createLiveBatchApi({
      baseUrl: "http://127.0.0.1:3000/api/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await api.postAttendance(
      "batch-1",
      {
        capturedAt: "2026-11-20T05:00:00.000Z",
        records: [{ candidateId: "cand-1", present: true, idVerified: true }],
      },
      "access-token-123",
    );

    expect(res.kind).toBe("success");
    if (res.kind === "success") {
      expect(res.items).toHaveLength(1);
    }
  });

  it("submits checklist with completeAssessment and detects 409 CONFLICT_IDEMPOTENT", async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "CONFLICT_IDEMPOTENT",
            message: "Same clientEventId with a different payload",
          },
        }),
        { status: 409 },
      );
    });

    const api = createLiveBatchApi({
      baseUrl: "http://127.0.0.1:3000/api/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await api.postChecklist(
      "batch-1",
      {
        clientEventId: "chk-001",
        capturedAt: "2026-11-20T05:00:00.000Z",
        items: [{ key: "cctv", available: true }],
        completeAssessment: true,
      },
      "access-token-123",
    );

    expect(res.kind).toBe("conflict");
    if (res.kind === "conflict") {
      expect(res.code).toBe("CONFLICT_IDEMPOTENT");
    }
  });
});

describe("batchApi mock implementation", () => {
  it("returns sample batch and roster", async () => {
    const api = createMockBatchApi();
    const batches = await api.listAssignedBatches("dummy");
    expect(batches).toHaveLength(1);
    const candidates = await api.getCandidates(batches[0]!.id, "dummy");
    expect(candidates).toHaveLength(2);
  });

  it("handles duplicate checklist replay and payload conflicts", async () => {
    const api = createMockBatchApi();
    const payload = {
      clientEventId: "chk-dup-1",
      capturedAt: "2026-11-20T05:00:00.000Z",
      items: [{ key: "cctv", available: true }],
      completeAssessment: false,
    };

    const first = await api.postChecklist("batch-1", payload, "dummy");
    expect(first.kind).toBe("success");
    if (first.kind === "success") {
      expect(first.replayed).toBe(false);
    }

    // Exact duplicate resend -> replayed: true
    const second = await api.postChecklist("batch-1", payload, "dummy");
    expect(second.kind).toBe("success");
    if (second.kind === "success") {
      expect(second.replayed).toBe(true);
    }

    // Mismatched payload -> CONFLICT_IDEMPOTENT
    const conflict = await api.postChecklist(
      "batch-1",
      { ...payload, items: [{ key: "cctv", available: false }] },
      "dummy",
    );
    expect(conflict.kind).toBe("conflict");
    if (conflict.kind === "conflict") {
      expect(conflict.code).toBe("CONFLICT_IDEMPOTENT");
    }
  });
});
