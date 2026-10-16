import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDetector } from "./detector";
import { createEngine, type EngineOptions } from "./engine";
import type { Detection, FlagBody, ProctorConfig, ProctorStatus, ProctorTransport } from "./types";

/**
 * Camera and MediaPipe cannot run in jsdom. These tests use a fake stream, FakeDetector,
 * a fake frame sampler and fake timers.
 */

const config: ProctorConfig = {
  snapshotIntervalSeconds: 30,
  detectionIntervalMs: 500,
  flagCooldownSeconds: 10,
  sustainedSeconds: { face_not_present: 2, multiple_faces: 0, phone_detected: 0, camera_blocked: 1 },
};

class FakeTrack extends EventTarget {
  readyState: "live" | "ended" = "live";
}

function fakeStream(track = new FakeTrack()) {
  return { stream: { getVideoTracks: () => [track] } as unknown as MediaStream, track };
}

function fakeTransport() {
  const flags: FlagBody[] = [];
  const snapshots: string[] = [];
  const transport: ProctorTransport & { disposed: boolean } = {
    disposed: false,
    sendFlag: vi.fn(async (_sessionId: string, body: FlagBody) => {
      flags.push(body);
    }),
    uploadSnapshot: vi.fn(async (input) => {
      snapshots.push(input.clientEventId);
      return `ev-${snapshots.length}`;
    }),
    dispose() {
      this.disposed = true;
    },
  };
  return { transport, flags, snapshots };
}

const face: Detection = { kind: "face", label: "face", confidence: 0.9 };
const phone: Detection = { kind: "phone", label: "cell phone", confidence: 0.8 };

function setup(extra: EngineOptions = {}, frames: Detection[][] = [[face]]) {
  const detector = new FakeDetector(frames);
  const { transport, flags, snapshots } = fakeTransport();
  let brightness = 120;
  let tick = 0;
  const sampler = {
    // A changing grey frame so the freeze rule stays quiet unless a test darkens it.
    sample: vi.fn(() => new Uint8ClampedArray([brightness, (brightness + (tick += 1)) % 256])),
    release: vi.fn(),
  };
  const engine = createEngine({
    detectorFactory: async () => detector,
    transport,
    samplerFactory: () => sampler,
    takeSnapshot: async () => new Blob(["jpeg"], { type: "image/jpeg" }),
    isFrameReady: () => true,
    ...extra,
  });
  const statuses: ProctorStatus[] = [];
  const setBrightness = (value: number) => {
    brightness = value;
  };
  return { engine, detector, transport, flags, snapshots, sampler, statuses, setBrightness };
}

async function startEngine(s: ReturnType<typeof setup>, stream = fakeStream().stream) {
  await s.engine.start({
    stream,
    sessionId: "sess-1",
    attemptId: "att-1",
    batchId: "batch-1",
    config,
    onStatus: (status) => s.statuses.push(status),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-16T05:00:00.000Z") });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("engine start and stop", () => {
  it("reports starting then running and adds one hidden video", async () => {
    const s = setup();
    await startEngine(s);
    expect(s.statuses.map((x) => x.state)).toEqual(["starting", "running"]);
    const videos = document.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveAttribute("aria-hidden", "true");
    s.engine.stop();
  });

  it("runs the detector every detectionIntervalMs", async () => {
    const s = setup();
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.detector.calls).toBe(4);
    s.engine.stop();
  });

  it("skips a cycle while the previous detection is still running", async () => {
    let release: () => void = () => {};
    const slow = {
      calls: 0,
      detect() {
        this.calls += 1;
        return new Promise<Detection[]>((resolve) => {
          release = () => resolve([face]);
        });
      },
    };
    const s = setup({ detectorFactory: async () => slow });
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(2000);
    expect(slow.calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(slow.calls).toBe(2);
    s.engine.stop();
  });

  it("stops timers, listeners and the model, and removes the video", async () => {
    const s = setup();
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(1000);
    s.engine.stop();
    const calls = s.detector.calls;
    await vi.advanceTimersByTimeAsync(5000);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.detector.calls).toBe(calls);
    expect(s.detector.closed).toBe(true);
    expect(s.sampler.release).toHaveBeenCalled();
    expect(document.querySelectorAll("video")).toHaveLength(0);
    expect(s.flags).toEqual([]);
    expect(s.statuses.at(-1)).toEqual({ state: "stopped" });
    // The caller passed this transport in, so the caller disposes it.
    expect(s.transport.disposed).toBe(false);
  });

  it("does not stop the caller's camera tracks", async () => {
    const { stream, track } = fakeStream();
    const stopSpy = vi.fn();
    Object.assign(track, { stop: stopSpy });
    const s = setup();
    await startEngine(s, stream);
    s.engine.stop();
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("is safe to stop twice and to start again", async () => {
    const s = setup();
    await startEngine(s);
    s.engine.stop();
    s.engine.stop();
    await startEngine(s);
    expect(document.querySelectorAll("video")).toHaveLength(1);
    s.engine.stop();
  });
});

describe("degraded mode", () => {
  it("reports degraded with a message when the model fails to load and keeps browser checks", async () => {
    const s = setup({ detectorFactory: () => Promise.reject(new Error("wasm 404")) });
    await startEngine(s);
    const last = s.statuses.at(-1);
    expect(last?.state).toBe("degraded");
    expect(last?.message).toMatch(/could not be loaded/i);

    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.flags.map((f) => f.type)).toEqual(["window_blur"]);

    // Brightness still works without a model.
    s.setBrightness(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.flags.map((f) => f.type)).toContain("camera_blocked");
    expect(s.flags.map((f) => f.type)).not.toContain("face_not_present");
    s.engine.stop();
  });

  it("goes degraded when a detection throws and back to running when it works", async () => {
    let fail = true;
    const flaky = {
      async detect() {
        if (fail) throw new Error("gpu lost");
        return [face];
      },
    };
    const s = setup({ detectorFactory: async () => flaky });
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.statuses.at(-1)?.state).toBe("degraded");
    fail = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(s.statuses.at(-1)?.state).toBe("running");
    s.engine.stop();
  });
});

describe("flags", () => {
  it("raises face_not_present after the sustained time, with a snapshot evidenceId", async () => {
    const s = setup({}, [[]]);
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.flags).toHaveLength(1);
    const flag = s.flags[0];
    expect(flag.type).toBe("face_not_present");
    expect(flag.evidenceId).toBe("ev-1");
    expect(flag.detail).toEqual({ label: "no face", count: 0, confidence: 0 });
    expect(flag.capturedAt).toMatch(/^2026-10-16T05:00:0\d\.\d{3}Z$/);
    expect(flag.clientEventId).toMatch(/^att-1-f\d+-/);
    expect(Object.keys(flag).sort()).toEqual(["capturedAt", "clientEventId", "detail", "evidenceId", "type"]);
    s.engine.stop();
  });

  it("raises phone_detected once per cooldown", async () => {
    const s = setup({}, [[face, phone]]);
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(9000);
    expect(s.flags.map((f) => f.type)).toEqual(["phone_detected"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.flags.map((f) => f.type)).toEqual(["phone_detected", "phone_detected"]);
    s.engine.stop();
  });

  it("sends the flag without evidenceId when the snapshot cannot be taken", async () => {
    const s = setup({ takeSnapshot: async () => null }, [[face, phone]]);
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.flags).toHaveLength(1);
    expect(s.flags[0].evidenceId).toBeUndefined();
    s.engine.stop();
  });

  it("raises tab_hidden, window_blur and fullscreen_exit from browser events", async () => {
    const s = setup();
    await startEngine(s);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("blur"));

    let full: Element | null = document.body;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => full });
    document.dispatchEvent(new Event("fullscreenchange"));
    full = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(s.flags.map((f) => f.type).sort()).toEqual(["fullscreen_exit", "tab_hidden", "window_blur"]);
    s.engine.stop();
    Reflect.deleteProperty(document, "visibilityState");
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("raises permission_revoked and goes degraded when the camera track ends", async () => {
    const { stream, track } = fakeStream();
    const s = setup();
    await startEngine(s, stream);
    track.readyState = "ended";
    track.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.flags.map((f) => f.type)).toEqual(["permission_revoked"]);
    expect(s.flags[0].detail?.label).toBe("track ended");
    expect(s.statuses.at(-1)?.state).toBe("degraded");
    s.engine.stop();
  });

  it("takes a snapshot every snapshotIntervalSeconds", async () => {
    const onSnapshot = vi.fn();
    const s = setup({ onSnapshot });
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(onSnapshot.mock.calls.filter((c) => c[0] === "interval")).toHaveLength(2);
    const upload = vi.mocked(s.transport.uploadSnapshot).mock.calls[0][0];
    expect(upload).toMatchObject({ batchId: "batch-1", sessionId: "sess-1" });
    s.engine.stop();
  });
});
