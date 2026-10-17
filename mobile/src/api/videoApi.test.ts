import { describe, expect, it, jest } from "@jest/globals";
import { createVideoApi, type VideoUploadMeta } from "./videoApi";

const meta: VideoUploadMeta = {
  clientEventId: "evt-1",
  batchId: "b1",
  candidateId: "c1",
  part: "viva",
  questionId: "q1",
  capturedAt: "2026-11-20T05:00:00.000Z",
  uri: "file:///v.mp4",
};

function reply(status: number, body: unknown): typeof fetch {
  return jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("videoApi", () => {
  it("lists the viva questions", async () => {
    const items = [{ id: "q1", type: "viva", nosId: "N", pcId: "P", stem: "Why?", marks: 2 }];
    const api = createVideoApi({ baseUrl: "http://x/api/v1", fetchImpl: reply(200, { items }) });
    expect(await api.getVivaQuestions("b1", "tok")).toEqual(items);
  });

  it("sends the part, student and question in the upload", async () => {
    const fetchImpl = reply(201, {});
    const api = createVideoApi({ baseUrl: "http://x/api/v1", fetchImpl });
    expect(await api.uploadVideo(meta, "tok")).toEqual({ kind: "success" });
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://x/api/v1/batches/b1/evidence");
    const form = init.body as FormData;
    expect(form.get("part")).toBe("viva");
    expect(form.get("candidateId")).toBe("c1");
    expect(form.get("questionId")).toBe("q1");
    expect(form.get("kind")).toBe("video");
  });

  it("treats a repeat (200) as done and sorts failures into retry, sign-in and give-up", async () => {
    const run = async (status: number, code = "X") =>
      createVideoApi({
        baseUrl: "http://x",
        fetchImpl: reply(status, { error: { code, message: "m" } }),
      }).uploadVideo(meta, "t");
    expect((await run(200)).kind).toBe("success");
    expect((await run(401)).kind).toBe("unauthorized");
    expect((await run(500)).kind).toBe("retryable");
    expect((await run(409, "BATCH_FEATURE_OFF")).kind).toBe("rejected");
    expect((await run(413, "FILE_TOO_LARGE")).kind).toBe("rejected");
    expect((await run(400, "VALIDATION_ERROR")).kind).toBe("rejected");
  });

  it("retries when the network fails", async () => {
    const api = createVideoApi({
      baseUrl: "http://x",
      fetchImpl: (jest.fn(async () => {
        throw new Error("offline");
      }) as unknown) as typeof fetch,
    });
    expect(await api.uploadVideo(meta, "t")).toEqual({ kind: "retryable", message: "offline" });
  });
});
