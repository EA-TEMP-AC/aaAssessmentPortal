import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDetector } from "./detector";
import { createEngine, type EngineOptions } from "./engine";
import type { BannerInput } from "./banner";
import type { LocationProvider, PhotoLocation } from "./location";
import type { FlagBody, ProctorConfig, ProctorTransport } from "./types";

/** X-07: the flag photo gets a banner, and the flag carries the location only when allowed. */

const config: ProctorConfig = {
  snapshotIntervalSeconds: 0,
  detectionIntervalMs: 500,
  flagCooldownSeconds: 10,
  sustainedSeconds: {},
  flagSeverity: { window_blur: "low" },
};

/** One live camera track, so starting the engine raises no flag of its own. */
function liveStream() {
  const track = Object.assign(new EventTarget(), { readyState: "live" });
  return { getVideoTracks: () => [track] } as unknown as MediaStream;
}

const HERE: PhotoLocation = { latitude: 19.076123, longitude: 72.877456, accuracy: 12 };

function setup(provider: LocationProvider | null, extra: EngineOptions = {}) {
  const flags: FlagBody[] = [];
  const banners: (BannerInput | undefined)[] = [];
  const transport: ProctorTransport = {
    sendFlag: vi.fn(async (_id: string, body: FlagBody) => {
      flags.push(body);
    }),
    uploadSnapshot: vi.fn(async () => "ev-1"),
    dispose() {},
  };
  const engine = createEngine({
    detectorFactory: async () => new FakeDetector([[{ kind: "face", label: "face", confidence: 0.9 }]]),
    transport,
    samplerFactory: () => ({ sample: () => null, release: vi.fn() }),
    takeSnapshot: async (_video, banner) => {
      banners.push(banner ? await banner : undefined);
      return new Blob(["jpeg"], { type: "image/jpeg" });
    },
    isFrameReady: () => true,
    framerFactory: () => ({ make: async (v: HTMLVideoElement) => v, release: vi.fn() }),
    ...(provider ? { locationProvider: provider } : {}),
    ...extra,
  });
  return { engine, flags, banners, transport };
}

async function raiseBlur(
  s: ReturnType<typeof setup>,
  captureLocation: boolean | undefined,
  attemptId = "65a1b2c3d4e5f60718293a4b",
) {
  await s.engine.start({
    stream: liveStream(),
    sessionId: "sess-1",
    attemptId,
    batchId: "batch-1",
    config,
    captureLocation,
    onStatus: () => {},
  });
  window.dispatchEvent(new Event("blur"));
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-20T05:00:05.000Z") });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flag photo banner and location in the engine", () => {
  it("location off: the banner says Location not shared, nothing asks for a position, the flag has none", async () => {
    const get = vi.fn(async () => HERE);
    const s = setup({ get });
    await raiseBlur(s, false);
    expect(get).not.toHaveBeenCalled();
    expect(s.banners).toHaveLength(1);
    expect(s.banners[0]).toMatchObject({
      type: "window_blur",
      reason: "The exam window lost focus",
      severity: "low",
      at: Date.parse("2026-11-20T05:00:05.000Z"),
      attemptCode: "293A4B",
      location: null,
    });
    expect(s.flags).toHaveLength(1);
    expect(s.flags[0].evidenceId).toBe("ev-1");
    expect(s.flags[0].location).toBeUndefined();
    s.engine.stop();
  });

  it("location on and allowed: the banner and the flag carry the position", async () => {
    const s = setup({ get: async () => HERE });
    await raiseBlur(s, true);
    expect(s.banners[0]?.location).toEqual(HERE);
    expect(s.flags[0].location).toEqual({ latitude: 19.076123, longitude: 72.877456, accuracy: 12 });
    s.engine.stop();
  });

  it("location on but refused: no location anywhere, and the flag still goes with its photo", async () => {
    const s = setup({ get: async () => null });
    await raiseBlur(s, true);
    expect(s.banners[0]?.location).toBeNull();
    expect(s.flags).toHaveLength(1);
    expect(s.flags[0].evidenceId).toBe("ev-1");
    expect(s.flags[0].location).toBeUndefined();
    s.engine.stop();
  });

  it("a failing location lookup does not stop the flag", async () => {
    const s = setup({
      get: async () => {
        throw new Error("boom");
      },
    });
    await raiseBlur(s, true);
    expect(s.flags).toHaveLength(1);
    expect(s.flags[0].location).toBeUndefined();
    s.engine.stop();
  });

  it("leaves accuracy out when it is not known", async () => {
    const s = setup({ get: async () => ({ ...HERE, accuracy: null }) });
    await raiseBlur(s, true);
    expect(s.flags[0].location).toEqual({ latitude: 19.076123, longitude: 72.877456 });
    s.engine.stop();
  });

  it("the photo failing still saves the flag, without a photo", async () => {
    const s = setup(
      { get: async () => HERE },
      {
        takeSnapshot: async () => null,
      },
    );
    await raiseBlur(s, true);
    expect(s.flags).toHaveLength(1);
    expect(s.flags[0].evidenceId).toBeUndefined();
    // The saved location is kept even without a photo.
    expect(s.flags[0].location).toBeDefined();
    s.engine.stop();
  });

  it("an upload failure still saves the flag", async () => {
    const s = setup({ get: async () => HERE });
    (s.transport.uploadSnapshot as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    await raiseBlur(s, false);
    expect(s.flags).toHaveLength(1);
    expect(s.flags[0].evidenceId).toBeUndefined();
    s.engine.stop();
  });

  it("the interval snapshot carries no banner", async () => {
    const s = setup(null);
    await s.engine.start({
      stream: liveStream(),
      sessionId: "sess-1",
      attemptId: "att-1",
      batchId: "batch-1",
      config: { ...config, snapshotIntervalSeconds: 30 },
      onStatus: () => {},
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.banners).toEqual([undefined]);
    s.engine.stop();
  });

  it("one photo per flag: a repeat inside the cooldown has no photo and no flag", async () => {
    const s = setup({ get: async () => HERE });
    await raiseBlur(s, true);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.banners).toHaveLength(1);
    expect(s.flags).toHaveLength(1);
    s.engine.stop();
  });
});
