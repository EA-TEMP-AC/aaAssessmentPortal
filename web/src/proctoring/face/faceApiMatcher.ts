import type { FaceConfig } from "./config";
import type { CompareResult, FaceFrame, IdFaceMatcher, LargestFaceResult, ReferenceResult } from "./types";

type FaceApi = typeof import("@vladmandic/face-api");

type Box = { width: number; height: number };
type Described = { detection: { box: Box }; descriptor: Float32Array };

export type FaceApiDeps = {
  /** Loaded on demand so the model code is not in the main bundle. */
  loadLib: () => Promise<FaceApi>;
  /** face-api takes canvas, video or image, not ImageBitmap. */
  toCanvas: (bitmap: ImageBitmap) => HTMLCanvasElement;
};

function bitmapToCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

const DEFAULT_DEPS: FaceApiDeps = {
  loadLib: () => import("@vladmandic/face-api"),
  toCanvas: bitmapToCanvas,
};

/**
 * @vladmandic/face-api: tiny face detector, tiny 68-point landmarks, 128-number descriptor.
 * The reference descriptor lives in a private field: not serialisable, never stored or sent.
 */
export class FaceApiMatcher implements IdFaceMatcher {
  #api: FaceApi | null = null;
  #loading: Promise<void> | null = null;
  #reference: Float32Array | null = null;
  readonly #config: FaceConfig;
  readonly #deps: FaceApiDeps;

  constructor(config: FaceConfig, deps: Partial<FaceApiDeps> = {}) {
    this.#config = config;
    this.#deps = { ...DEFAULT_DEPS, ...deps };
  }

  load(): Promise<void> {
    if (!this.#loading) {
      this.#loading = (async () => {
        const api = await this.#deps.loadLib();
        // The bundled tfjs has ready() at run time; the shipped types leave it out.
        await (api.tf as unknown as { ready?: () => Promise<void> }).ready?.();
        const url = this.#config.modelUrl;
        await Promise.all([
          api.nets.tinyFaceDetector.loadFromUri(url),
          api.nets.faceLandmark68TinyNet.loadFromUri(url),
          api.nets.faceRecognitionNet.loadFromUri(url),
        ]);
        this.#api = api;
      })().catch((err) => {
        this.#loading = null;
        throw err;
      });
    }
    return this.#loading;
  }

  hasReference(): boolean {
    return this.#reference !== null;
  }

  async setReference(frame: FaceFrame): Promise<ReferenceResult> {
    const faces = await this.#describe(frame, this.#config.detectorInputSize);
    if (faces.length === 0) return { ok: false, reason: "no_face" };
    if (faces.length > 1) return { ok: false, reason: "multiple_faces" };
    this.clear();
    this.#reference = Float32Array.from(faces[0].descriptor);
    return { ok: true };
  }

  async compare(frame: FaceFrame): Promise<CompareResult> {
    if (!this.#reference || !this.#api) return { state: "unknown" };
    let faces: Described[];
    try {
      faces = await this.#describe(frame, this.#config.detectorInputSize);
    } catch {
      return { state: "unknown" };
    }
    if (faces.length === 0) return { state: "no_face" };
    if (faces.length > 1) return { state: "multiple_faces" };
    const distance = this.#api.euclideanDistance(this.#reference, faces[0].descriptor);
    return { state: distance <= this.#config.distanceThreshold ? "match" : "mismatch", distance };
  }

  async compareLargest(frame: FaceFrame): Promise<LargestFaceResult> {
    if (!this.#reference || !this.#api) return { found: false };
    const faces = await this.#describe(frame, this.#config.idDetectorInputSize);
    if (faces.length === 0) return { found: false };
    const area = (f: Described) => f.detection.box.width * f.detection.box.height;
    const largest = faces.reduce((a, b) => (area(b) > area(a) ? b : a));
    return { found: true, distance: this.#api.euclideanDistance(this.#reference, largest.descriptor) };
  }

  clear(): void {
    this.#reference?.fill(0);
    this.#reference = null;
  }

  async #describe(frame: FaceFrame, inputSize: number): Promise<Described[]> {
    const api = this.#api;
    if (!api) throw new Error("face model not loaded");
    const input = frame instanceof HTMLVideoElement ? frame : this.#deps.toCanvas(frame);
    const options = new api.TinyFaceDetectorOptions({
      inputSize,
      scoreThreshold: this.#config.detectorScoreThreshold,
    });
    const results = await api.detectAllFaces(input, options).withFaceLandmarks(true).withFaceDescriptors();
    return results as unknown as Described[];
  }
}
