import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDetector } from "./detector";
import { FakeFaceMatcher, faceConfig } from "./face";
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
    framerFactory: () => ({ make: async (v: HTMLVideoElement) => v, release: vi.fn() }),
    ...extra,
  });
  const statuses: ProctorStatus[] = [];
  const setBrightness = (value: number) => {
    brightness = value;
  };
  return { engine, detector, transport, flags, snapshots, sampler, statuses, setBrightness };
}

async function startEngine(
  s: ReturnType<typeof setup>,
  stream = fakeStream().stream,
  faceMatcher?: FakeFaceMatcher,
  watchFullscreen?: boolean,
) {
  await s.engine.start({
    faceMatcher,
    watchFullscreen,
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

  it("does not raise fullscreen_exit when full screen is not watched (X-08)", async () => {
    const s = setup();
    await startEngine(s, undefined, undefined, false);
    let full: Element | null = document.body;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => full });
    document.dispatchEvent(new Event("fullscreenchange"));
    full = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.flags).toEqual([]);
    s.engine.stop();
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("sends the question on screen with a flag, and nothing when there is none (X-23)", async () => {
    let current: string | null = "q-7";
    const s = setup();
    await s.engine.start({
      stream: fakeStream().stream,
      getQuestionId: () => current,
      sessionId: "sess-1",
      attemptId: "att-1",
      batchId: "batch-1",
      config,
      onStatus: (status) => s.statuses.push(status),
    });
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.flags[0].questionId).toBe("q-7");
    current = null;
    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.flags.at(-1)?.questionId).toBeUndefined();
    s.engine.stop();
  });

  it("raises screen_share_stopped when the shared screen ends (X-21)", async () => {
    const screenTrack = new FakeTrack();
    const screenStream = { getVideoTracks: () => [screenTrack] } as unknown as MediaStream;
    const s = setup();
    await s.engine.start({
      stream: fakeStream().stream,
      screenStream,
      sessionId: "sess-1",
      attemptId: "att-1",
      batchId: "batch-1",
      config,
      onStatus: (status) => s.statuses.push(status),
    });
    screenTrack.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.flags.map((f) => f.type)).toEqual(["screen_share_stopped"]);
    s.engine.stop();
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

describe("face matcher (P-09)", () => {
  // 500 ms between cycles: three mismatches in a row that span 1 s raise the flag on the third.
  const rules = faceConfig({ mismatchSamples: 3, mismatchHoldMs: 1000, maxSampleGapMs: 3000, flagCooldownMs: 60_000 });
  const mismatch = { state: "mismatch", distance: 0.72 } as const;
  const match = { state: "match", distance: 0.3 } as const;

  async function withReference(script: ConstructorParameters<typeof FakeFaceMatcher>[0]) {
    const matcher = new FakeFaceMatcher(script);
    await matcher.setReference({} as ImageBitmap);
    return matcher;
  }

  it("raises face_mismatch only after the rules say so, with a snapshot and the server detail shape", async () => {
    const matcher = await withReference({ compare: [mismatch] });
    const s = setup({ faceConfig: rules });
    await startEngine(s, undefined, matcher);
    await vi.advanceTimersByTimeAsync(1000);
    expect(matcher.calls.filter((c) => c === "compare")).toHaveLength(2);
    expect(s.flags).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.flags).toHaveLength(1);
    const flag = s.flags[0];
    expect(flag.type).toBe("face_mismatch");
    expect(flag.detail).toEqual({ label: "distance_72", count: 3 });
    expect(flag.evidenceId).toBe("ev-1");
    expect(Object.keys(flag).sort()).toEqual(["capturedAt", "clientEventId", "detail", "evidenceId", "type"]);
    s.engine.stop();
  });

  it("does not flag a scattered mismatch, and the cooldown stops repeats", async () => {
    const scattered = await withReference({ compare: [mismatch, match, mismatch, match, mismatch, match, match] });
    const a = setup({ faceConfig: rules });
    await startEngine(a, undefined, scattered);
    await vi.advanceTimersByTimeAsync(4000);
    expect(a.flags).toEqual([]);
    a.engine.stop();

    const steady = await withReference({ compare: [mismatch] });
    const b = setup({ faceConfig: rules });
    await startEngine(b, undefined, steady);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(b.flags.filter((f) => f.type === "face_mismatch")).toHaveLength(1);
    b.engine.stop();
  });

  it("ignores frames with no face or several faces", async () => {
    const matcher = await withReference({ compare: [{ state: "no_face" }, { state: "multiple_faces" }, { state: "unknown" }] });
    const s = setup({ faceConfig: rules }, [[face]]);
    await startEngine(s, undefined, matcher);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.flags).toEqual([]);
    s.engine.stop();
  });

  it("clears the matcher on stop, once per run, and never compares afterwards", async () => {
    const matcher = await withReference({ compare: [match] });
    const s = setup({ faceConfig: rules });
    await startEngine(s, undefined, matcher);
    await vi.advanceTimersByTimeAsync(1000);
    s.engine.stop();
    expect(matcher.calls.filter((c) => c === "clear")).toHaveLength(1);
    expect(matcher.hasReference()).toBe(false);
    const before = matcher.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(matcher.calls).toHaveLength(before);
    s.engine.stop();
    expect(matcher.calls.filter((c) => c === "clear")).toHaveLength(1);
  });

  it("reports degraded when the face model fails to load and keeps every other check running", async () => {
    const matcher = new FakeFaceMatcher({ loadError: new Error("no model") });
    const s = setup({ faceConfig: rules }, [[]]);
    await s.engine.start({
      stream: fakeStream().stream,
      sessionId: "sess-1",
      attemptId: "att-1",
      batchId: "batch-1",
      config,
      faceMatcher: matcher,
      onStatus: (status) => s.statuses.push(status),
    });
    const last = s.statuses[s.statuses.length - 1];
    expect(last.state).toBe("degraded");
    expect(last.message).toMatch(/face check could not load/i);
    await vi.advanceTimersByTimeAsync(3000);
    expect(matcher.calls).not.toContain("compare");
    // Not having a face is still reported by the normal check.
    expect(s.flags.map((f) => f.type)).toEqual(["face_not_present"]);
    s.engine.stop();
    expect(matcher.calls).toContain("clear");
  });

  it("sends nothing but flag bodies and snapshots, and uses no storage or console", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const matcher = await withReference({ compare: [mismatch] });
    const s = setup({ faceConfig: rules });
    await startEngine(s, undefined, matcher);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.flags).toHaveLength(1);
    const sent = JSON.stringify(vi.mocked(s.transport.sendFlag).mock.calls);
    expect(sent).not.toMatch(/descriptor|Float32|reference/i);
    expect(setItem).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    s.engine.stop();
  });

  it("works exactly as before when no matcher is given", async () => {
    const s = setup({ faceConfig: rules });
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.flags).toEqual([]);
    expect(s.statuses.map((x) => x.state)).toEqual(["starting", "running"]);
    s.engine.stop();
  });
});

describe("speed (X-05)", () => {
  function visibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  }
  afterEach(() => visibility("visible"));

  it("gives the detector the scaled-down frame and closes it afterwards", async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const seen: unknown[] = [];
    const detector = {
      detect: async (frame: unknown) => {
        seen.push(frame);
        return [face];
      },
    };
    const release = vi.fn();
    const s = setup({
      detectorFactory: async () => detector,
      framerFactory: () => ({ make: async () => bitmap, release }),
    });
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toHaveLength(2);
    expect(seen.every((f) => f === bitmap)).toBe(true);
    expect(bitmap.close).toHaveBeenCalledTimes(2);
    s.engine.stop();
    expect(release).toHaveBeenCalled();
  });

  it("does not run detection while the tab is hidden and carries on when it is back", async () => {
    const s = setup();
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.detector.calls).toBe(2);
    visibility("hidden");
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.detector.calls).toBe(2);
    visibility("visible");
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.detector.calls).toBe(4);
    s.engine.stop();
  });

  it("uses the shorter of the server interval and 500 ms for face detection", async () => {
    const s = setup();
    await s.engine.start({
      stream: fakeStream().stream,
      sessionId: "sess-1",
      attemptId: "att-1",
      batchId: "batch-1",
      config: { ...config, detectionIntervalMs: 1000 },
      onStatus: () => {},
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.detector.calls).toBe(4);
    s.engine.stop();
  });

  it("reports how long each check took, and not the skipped ones", async () => {
    let clock = 0;
    let release: () => void = () => {};
    const slow = {
      detect: () =>
        new Promise<Detection[]>((resolve) => {
          release = () => resolve([face]);
        }),
    };
    const ms: number[] = [];
    const s = setup({
      detectorFactory: async () => slow,
      perfNow: () => clock,
      onTick: (v) => ms.push(v),
    });
    await startEngine(s);
    await vi.advanceTimersByTimeAsync(1500);
    expect(ms).toEqual([]);
    clock = 120;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(ms).toEqual([120]);
    s.engine.stop();
  });

  it("tells the page when a flag is raised", async () => {
    const s = setup({}, [[]]);
    const raised: string[] = [];
    await s.engine.start({
      stream: fakeStream().stream,
      sessionId: "sess-1",
      attemptId: "att-1",
      batchId: "batch-1",
      config,
      onStatus: () => {},
      onFlag: (flag) => raised.push(flag.type),
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(raised).toEqual(["face_not_present"]);
    s.engine.stop();
  });
});
