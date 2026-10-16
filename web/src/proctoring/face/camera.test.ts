import { describe, expect, it, vi } from "vitest";
import {
  captureIdCard,
  capturePrecheckReference,
  PRECHECK_MESSAGES,
  verifyIdAgainstReference,
  type CameraDeps,
} from "./camera";
import { faceConfig } from "./config";
import { FakeFaceMatcher } from "./fakeMatcher";

const config = faceConfig({ precheckAttempts: 3, precheckGapMs: 10 });

function readyVideo(ready = true): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { value: ready ? 4 : 0 });
  Object.defineProperty(video, "videoWidth", { value: ready ? 640 : 0 });
  Object.defineProperty(video, "videoHeight", { value: ready ? 480 : 0 });
  return video;
}

function fakeBitmap(): ImageBitmap {
  return { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;
}

function deps(): CameraDeps & { grabFrame: ReturnType<typeof vi.fn>; sleep: ReturnType<typeof vi.fn> } {
  return { grabFrame: vi.fn(async () => fakeBitmap()), sleep: vi.fn(async () => {}) };
}

describe("capturePrecheckReference", () => {
  it("returns the first frame with exactly one face and keeps it as reference", async () => {
    const d = deps();
    const matcher = new FakeFaceMatcher({
      setReference: [{ ok: false, reason: "no_face" }, { ok: true }],
    });
    const result = await capturePrecheckReference(readyVideo(), matcher, config, d);
    expect(result.ok).toBe(true);
    expect(matcher.hasReference()).toBe(true);
    expect(d.grabFrame).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    // The rejected frame is released; the kept one is returned open.
    const first = await d.grabFrame.mock.results[0].value;
    expect(first.close).toHaveBeenCalled();
  });

  it("asks for more light when no face is found", async () => {
    const matcher = new FakeFaceMatcher({ setReference: [{ ok: false, reason: "no_face" }] });
    const result = await capturePrecheckReference(readyVideo(), matcher, config, deps());
    expect(result).toEqual({ ok: false, reason: "no_face", message: PRECHECK_MESSAGES.no_face });
    expect(result.ok === false && result.message).toMatch(/more light/i);
    expect(matcher.hasReference()).toBe(false);
  });

  it("asks for one person only when several faces were seen", async () => {
    const matcher = new FakeFaceMatcher({
      setReference: [{ ok: false, reason: "multiple_faces" }, { ok: false, reason: "no_face" }],
    });
    const result = await capturePrecheckReference(readyVideo(), matcher, config, deps());
    expect(result).toMatchObject({ ok: false, reason: "multiple_faces" });
    expect(result.ok === false && result.message).toMatch(/only you/i);
  });

  it("says the camera is not ready before trying", async () => {
    const d = deps();
    const result = await capturePrecheckReference(readyVideo(false), new FakeFaceMatcher(), config, d);
    expect(result).toMatchObject({ ok: false, reason: "camera_not_ready" });
    expect(d.grabFrame).not.toHaveBeenCalled();
  });

  it("reports a model error instead of blaming the candidate", async () => {
    const matcher = new FakeFaceMatcher();
    vi.spyOn(matcher, "setReference").mockRejectedValue(new Error("webgl"));
    const result = await capturePrecheckReference(readyVideo(), matcher, config, deps());
    expect(result).toMatchObject({ ok: false, reason: "model_error" });
  });
});

describe("captureIdCard", () => {
  it("returns one still", async () => {
    const d = deps();
    const result = await captureIdCard(readyVideo(), d);
    expect(result.ok).toBe(true);
    expect(d.grabFrame).toHaveBeenCalledTimes(1);
  });

  it("fails when the camera is not ready", async () => {
    expect(await captureIdCard(readyVideo(false), deps())).toMatchObject({ ok: false, reason: "camera_not_ready" });
  });
});

describe("verifyIdAgainstReference", () => {
  const idConfig = faceConfig({ idDistanceThreshold: 0.6 });

  async function withSelfie(matcher: FakeFaceMatcher) {
    await matcher.setReference(fakeBitmap());
    return matcher;
  }

  it("match at or under the ID threshold", async () => {
    const m = await withSelfie(new FakeFaceMatcher({ compareLargest: [{ found: true, distance: 0.6 }] }));
    expect(await verifyIdAgainstReference(fakeBitmap(), m, idConfig)).toEqual({ result: "match", distance: 0.6 });
  });

  it("mismatch above the ID threshold", async () => {
    const m = await withSelfie(new FakeFaceMatcher({ compareLargest: [{ found: true, distance: 0.65 }] }));
    expect(await verifyIdAgainstReference(fakeBitmap(), m, idConfig)).toEqual({ result: "mismatch", distance: 0.65 });
  });

  it("uses idDistanceThreshold, not the live threshold", async () => {
    const m = await withSelfie(new FakeFaceMatcher({ compareLargest: [{ found: true, distance: 0.65 }] }));
    const loose = faceConfig({ distanceThreshold: 0.5, idDistanceThreshold: 0.7 });
    expect((await verifyIdAgainstReference(fakeBitmap(), m, loose)).result).toBe("match");
  });

  it("id_no_face when the card shows no face", async () => {
    const m = await withSelfie(new FakeFaceMatcher({ compareLargest: [{ found: false }] }));
    expect(await verifyIdAgainstReference(fakeBitmap(), m, idConfig)).toEqual({ result: "id_no_face" });
  });

  it("selfie_no_face when no selfie reference is held", async () => {
    expect(await verifyIdAgainstReference(fakeBitmap(), new FakeFaceMatcher(), idConfig)).toEqual({
      result: "selfie_no_face",
    });
  });
});

describe("FakeFaceMatcher flow", () => {
  it("load, reference, compare, clear", async () => {
    const matcher = new FakeFaceMatcher({
      compare: [{ state: "match", distance: 0.2 }, { state: "mismatch", distance: 0.9 }],
    });
    await matcher.load();
    expect(await matcher.compare(fakeBitmap())).toEqual({ state: "unknown" });
    expect(await matcher.setReference(fakeBitmap())).toEqual({ ok: true });
    expect(await matcher.compare(fakeBitmap())).toEqual({ state: "match", distance: 0.2 });
    expect(await matcher.compare(fakeBitmap())).toEqual({ state: "mismatch", distance: 0.9 });
    matcher.clear();
    expect(matcher.hasReference()).toBe(false);
    expect(await matcher.compare(fakeBitmap())).toEqual({ state: "unknown" });
    expect(matcher.calls).toEqual(["load", "compare", "setReference", "compare", "compare", "clear", "compare"]);
  });

  it("surfaces a load error", async () => {
    await expect(new FakeFaceMatcher({ loadError: new Error("no models") }).load()).rejects.toThrow("no models");
  });
});
