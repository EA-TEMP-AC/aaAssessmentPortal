import { describe, expect, it, vi } from "vitest";
import { faceConfig } from "./config";
import { FaceApiMatcher, type FaceApiDeps } from "./faceApiMatcher";

// The real model needs WebGL and a camera, which jsdom does not have. This stands in for the
// library so the matcher's own logic (counts, threshold, largest face, clear) is tested.

type Face = { box: { width: number; height: number }; descriptor: number[] };

function fakeLib(frames: Face[][]) {
  const queue = [...frames];
  const loadFromUri = vi.fn(async () => {});
  const detectAllFaces = vi.fn(() => ({
    withFaceLandmarks: () => ({
      withFaceDescriptors: async () =>
        (queue.shift() ?? []).map((f) => ({ detection: { box: f.box }, descriptor: Float32Array.from(f.descriptor) })),
    }),
  }));
  const lib = {
    tf: { ready: async () => {} },
    nets: {
      tinyFaceDetector: { loadFromUri },
      faceLandmark68TinyNet: { loadFromUri },
      faceRecognitionNet: { loadFromUri },
    },
    TinyFaceDetectorOptions: class {
      constructor(readonly options: unknown) {}
    },
    detectAllFaces,
    euclideanDistance: (a: Float32Array, b: Float32Array) =>
      Math.sqrt(Array.from(a).reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0)),
  };
  const deps: Partial<FaceApiDeps> = {
    loadLib: async () => lib as unknown as Awaited<ReturnType<FaceApiDeps["loadLib"]>>,
    toCanvas: () => document.createElement("canvas"),
  };
  return { lib, deps, loadFromUri, detectAllFaces };
}

const face = (descriptor: number[], size = 100): Face => ({ box: { width: size, height: size }, descriptor });
const frame = () => document.createElement("video");
const config = faceConfig({ modelUrl: "/models/face", distanceThreshold: 0.6 });

describe("FaceApiMatcher", () => {
  it("loads the three models from the local folder, once", async () => {
    const { deps, loadFromUri } = fakeLib([]);
    const matcher = new FaceApiMatcher(config, deps);
    await Promise.all([matcher.load(), matcher.load()]);
    expect(loadFromUri).toHaveBeenCalledTimes(3);
    expect(loadFromUri).toHaveBeenCalledWith("/models/face");
  });

  it("needs exactly one face for the reference", async () => {
    const { deps } = fakeLib([[], [face([0, 0]), face([1, 1])], [face([0, 0])]]);
    const matcher = new FaceApiMatcher(config, deps);
    await matcher.load();
    expect(await matcher.setReference(frame())).toEqual({ ok: false, reason: "no_face" });
    expect(await matcher.setReference(frame())).toEqual({ ok: false, reason: "multiple_faces" });
    expect(matcher.hasReference()).toBe(false);
    expect(await matcher.setReference(frame())).toEqual({ ok: true });
    expect(matcher.hasReference()).toBe(true);
  });

  it("compares with the threshold and reports face counts", async () => {
    const { deps } = fakeLib([[face([0, 0])], [face([0.3, 0.4])], [face([0.6, 0.8])], [], [face([0, 0]), face([0, 0])]]);
    const matcher = new FaceApiMatcher(config, deps);
    await matcher.load();
    await matcher.setReference(frame());
    expect(await matcher.compare(frame())).toEqual({ state: "match", distance: expect.closeTo(0.5, 6) });
    expect(await matcher.compare(frame())).toMatchObject({ state: "mismatch" });
    expect(await matcher.compare(frame())).toEqual({ state: "no_face" });
    expect(await matcher.compare(frame())).toEqual({ state: "multiple_faces" });
  });

  it("is unknown before load, before a reference, and on a model error", async () => {
    const { deps, detectAllFaces } = fakeLib([[face([0, 0])]]);
    const matcher = new FaceApiMatcher(config, deps);
    expect(await matcher.compare(frame())).toEqual({ state: "unknown" });
    await matcher.load();
    expect(await matcher.compare(frame())).toEqual({ state: "unknown" });
    await matcher.setReference(frame());
    detectAllFaces.mockImplementationOnce(() => {
      throw new Error("webgl lost");
    });
    expect(await matcher.compare(frame())).toEqual({ state: "unknown" });
  });

  it("uses the largest face on the ID card", async () => {
    const { deps, detectAllFaces } = fakeLib([[face([0, 0])], [face([0, 1], 40), face([0.3, 0.4], 120)], []]);
    const matcher = new FaceApiMatcher(config, deps);
    await matcher.load();
    await matcher.setReference(frame());
    expect(await matcher.compareLargest(frame())).toEqual({ found: true, distance: expect.closeTo(0.5, 6) });
    expect(await matcher.compareLargest(frame())).toEqual({ found: false });
    const idOptions = (detectAllFaces.mock.calls[1] as unknown[])[1] as { options: { inputSize: number } };
    expect(idOptions.options.inputSize).toBe(config.idDetectorInputSize);
  });

  it("clear() wipes the reference and does not expose it", async () => {
    const { deps } = fakeLib([[face([0.1, 0.2])], [face([0.1, 0.2])]]);
    const matcher = new FaceApiMatcher(config, deps);
    await matcher.load();
    await matcher.setReference(frame());
    expect(JSON.stringify(matcher)).toBe("{}");
    expect(Object.keys(matcher)).toEqual([]);
    matcher.clear();
    expect(matcher.hasReference()).toBe(false);
    expect(await matcher.compare(frame())).toEqual({ state: "unknown" });
  });

  it("converts an ImageBitmap to a canvas for the library", async () => {
    const { deps, detectAllFaces } = fakeLib([[face([0, 0])]]);
    const toCanvas = vi.fn(() => document.createElement("canvas"));
    const matcher = new FaceApiMatcher(config, { ...deps, toCanvas });
    await matcher.load();
    await matcher.setReference({ width: 10, height: 10 } as ImageBitmap);
    expect(toCanvas).toHaveBeenCalledTimes(1);
    expect((detectAllFaces.mock.calls[0] as unknown[])[0]).toBeInstanceOf(HTMLCanvasElement);
  });
});
