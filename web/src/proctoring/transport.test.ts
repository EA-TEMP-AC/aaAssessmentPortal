import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { createTransport, flagPath, isRetryable, snapshotPath } from "./transport";
import type { FlagBody } from "./types";

const body = (n: number): FlagBody => ({
  clientEventId: `evt-${n}`,
  type: "tab_hidden",
  capturedAt: "2026-10-16T05:00:00.000Z",
});

/** Timer stub: collects callbacks so the test decides when a retry runs. */
function manualTimers() {
  const pending: (() => void)[] = [];
  return {
    setTimer: (fn: () => void) => {
      pending.push(fn);
      return pending.length;
    },
    clearTimer: vi.fn(),
    async fire() {
      const fns = pending.splice(0);
      for (const fn of fns) fn();
      await new Promise((r) => setTimeout(r, 0));
    },
    count: () => pending.length,
  };
}

describe("flags", () => {
  it("posts the flag to the session path", async () => {
    const request = vi.fn().mockResolvedValue({});
    const t = createTransport({ request });
    await t.sendFlag("s1", body(1));
    expect(request).toHaveBeenCalledWith("/proctoring/sessions/s1/flags", { method: "POST", body: body(1) });
    expect(t.pending()).toBe(0);
  });

  it("queues a failed send and retries it with the same clientEventId", async () => {
    const timers = manualTimers();
    const request = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue({});
    const t = createTransport({ request, ...timers });
    await t.sendFlag("s1", body(1));
    expect(t.pending()).toBe(1);
    expect(timers.count()).toBe(1);
    await timers.fire();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].body.clientEventId).toBe("evt-1");
    expect(t.pending()).toBe(0);
  });

  it("keeps retrying while the server keeps failing", async () => {
    const timers = manualTimers();
    const request = vi.fn().mockRejectedValue(new ApiError(503, "UNAVAILABLE", "down"));
    const t = createTransport({ request, ...timers });
    await t.sendFlag("s1", body(1));
    await timers.fire();
    await timers.fire();
    expect(request).toHaveBeenCalledTimes(3);
    expect(t.pending()).toBe(1);
  });

  it("drops a flag the server rejects as invalid", async () => {
    const timers = manualTimers();
    const request = vi.fn().mockRejectedValue(new ApiError(400, "VALIDATION_ERROR", "bad"));
    const t = createTransport({ request, ...timers });
    await t.sendFlag("s1", body(1));
    expect(t.pending()).toBe(0);
    expect(timers.count()).toBe(0);
  });

  it("holds at most 50 flags and drops the oldest", async () => {
    const timers = manualTimers();
    const request = vi.fn().mockRejectedValue(new TypeError("offline"));
    const t = createTransport({ request, ...timers });
    for (let i = 1; i <= 55; i += 1) await t.sendFlag("s1", body(i));
    expect(t.pending()).toBe(50);
    request.mockResolvedValue({});
    await t.flush();
    const sent = request.mock.calls.slice(55).map((c) => c[1].body.clientEventId);
    expect(sent[0]).toBe("evt-6");
    expect(sent).toHaveLength(50);
  });

  it("does not queue the same clientEventId twice", async () => {
    const timers = manualTimers();
    const request = vi.fn().mockRejectedValue(new TypeError("offline"));
    const t = createTransport({ request, ...timers });
    await t.sendFlag("s1", body(1));
    await t.sendFlag("s1", body(1));
    expect(t.pending()).toBe(1);
  });

  it("clears the queue and timer on dispose and sends nothing after", async () => {
    const timers = manualTimers();
    const request = vi.fn().mockRejectedValue(new TypeError("offline"));
    const t = createTransport({ request, ...timers });
    await t.sendFlag("s1", body(1));
    t.dispose();
    expect(timers.clearTimer).toHaveBeenCalled();
    expect(t.pending()).toBe(0);
    await t.sendFlag("s1", body(2));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("classifies errors for retry", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new ApiError(500, "X", "x"))).toBe(true);
    expect(isRetryable(new ApiError(429, "X", "x"))).toBe(true);
    expect(isRetryable(new ApiError(409, "X", "x"))).toBe(false);
    expect(isRetryable(new ApiError(403, "X", "x"))).toBe(false);
  });
});

describe("snapshots", () => {
  it("uploads a multipart form with kind proctor_snapshot and returns the evidence id", async () => {
    const request = vi.fn().mockResolvedValue({ id: "ev1" });
    const t = createTransport({ request });
    const blob = new Blob(["x"], { type: "image/jpeg" });
    const id = await t.uploadSnapshot({
      batchId: "b1",
      sessionId: "s1",
      clientEventId: "snap-1",
      capturedAt: "2026-10-16T05:00:00.000Z",
      blob,
    });
    expect(id).toBe("ev1");
    const [path, opts] = request.mock.calls[0];
    expect(path).toBe("/batches/b1/evidence");
    const form = opts.body as FormData;
    expect(form.get("kind")).toBe("proctor_snapshot");
    expect(form.get("sessionId")).toBe("s1");
    expect(form.get("clientEventId")).toBe("snap-1");
    expect(form.get("capturedAt")).toBe("2026-10-16T05:00:00.000Z");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect([...form.keys()].sort()).toEqual(["capturedAt", "clientEventId", "file", "kind", "sessionId"]);
  });

  it("returns null when the upload fails, without queueing", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("offline"));
    const t = createTransport({ request });
    const id = await t.uploadSnapshot({
      batchId: "b1",
      sessionId: "s1",
      clientEventId: "snap-1",
      capturedAt: "2026-10-16T05:00:00.000Z",
      blob: new Blob(["x"]),
    });
    expect(id).toBeNull();
    expect(t.pending()).toBe(0);
  });

  it("encodes ids in paths", () => {
    expect(flagPath("a/b")).toBe("/proctoring/sessions/a%2Fb/flags");
    expect(snapshotPath("a/b")).toBe("/batches/a%2Fb/evidence");
  });
});
