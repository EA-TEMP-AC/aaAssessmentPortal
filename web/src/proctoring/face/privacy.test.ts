import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureIdCard, capturePrecheckReference, verifyIdAgainstReference } from "./camera";
import { faceConfig } from "./config";
import { FaceApiMatcher } from "./faceApiMatcher";
import { evaluateIdentity, idCheckOutcome, INITIAL_IDENTITY_STATE } from "./rules";

// A descriptor value that would be easy to spot if it leaked anywhere.
const MARKER = 0.123456789;
const DESCRIPTOR = Array.from({ length: 128 }, (_, i) => (i === 0 ? MARKER : i / 1000));

function lib() {
  return {
    tf: { ready: async () => {} },
    nets: {
      tinyFaceDetector: { loadFromUri: async () => {} },
      faceLandmark68TinyNet: { loadFromUri: async () => {} },
      faceRecognitionNet: { loadFromUri: async () => {} },
    },
    TinyFaceDetectorOptions: class {},
    detectAllFaces: () => ({
      withFaceLandmarks: () => ({
        withFaceDescriptors: async () => [
          { detection: { box: { width: 50, height: 50 } }, descriptor: Float32Array.from(DESCRIPTOR) },
        ],
      }),
    }),
    euclideanDistance: () => 0.9,
  };
}

const spies: Record<string, ReturnType<typeof vi.fn>> = {};

beforeEach(() => {
  spies.fetch = vi.fn();
  vi.stubGlobal("fetch", spies.fetch);
  spies.sendBeacon = vi.fn();
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: spies.sendBeacon });
  spies.idbOpen = vi.fn();
  vi.stubGlobal("indexedDB", { open: spies.idbOpen });
  spies.local = vi.spyOn(Storage.prototype, "setItem") as unknown as ReturnType<typeof vi.fn>;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    spies[level] = vi.spyOn(console, level) as unknown as ReturnType<typeof vi.fn>;
  }
  spies.cookie = vi.fn();
  Object.defineProperty(document, "cookie", { configurable: true, set: spies.cookie, get: () => "" });
});

afterEach(() => {
  Reflect.deleteProperty(document, "cookie");
});

it("a full camera check and live comparison never sends, stores or logs descriptor data", async () => {
  const config = faceConfig({ precheckAttempts: 1 });
  const matcher = new FaceApiMatcher(config, {
    loadLib: async () => lib() as never,
    toCanvas: () => document.createElement("canvas"),
  });
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { value: 4 });
  Object.defineProperty(video, "videoWidth", { value: 640 });
  Object.defineProperty(video, "videoHeight", { value: 480 });
  const bitmap = () => ({ width: 640, height: 480, close: () => {} }) as unknown as ImageBitmap;
  const deps = { grabFrame: async () => bitmap(), sleep: async () => {} };

  await matcher.load();
  const id = await captureIdCard(video, deps);
  const selfie = await capturePrecheckReference(video, matcher, config, deps);
  expect(selfie.ok).toBe(true);
  const check = await verifyIdAgainstReference(id.ok ? id.frame : bitmap(), matcher, config);
  const outcome = idCheckOutcome(check, 0);

  let state = INITIAL_IDENTITY_STATE;
  const flags = [outcome.flag];
  for (let t = 0; t <= 5000; t += 1000) {
    const step = evaluateIdentity(await matcher.compare(video), state, config, t);
    state = step.state;
    flags.push(step.flag);
  }
  matcher.clear();

  expect(flags.filter(Boolean).map((f) => f?.type)).toEqual(["id_mismatch", "face_mismatch"]);
  for (const [name, spy] of Object.entries(spies)) {
    expect(spy, name).not.toHaveBeenCalled();
  }
  // Flags and results carry no descriptor numbers.
  const text = JSON.stringify({ flags, check, outcome, state, matcher });
  expect(text).not.toContain(String(MARKER).slice(0, 8));
  expect(text).not.toContain("descriptor");
});
