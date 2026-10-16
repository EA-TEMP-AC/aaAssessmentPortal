import type { CompareResult, FaceFrame, IdFaceMatcher, LargestFaceResult, ReferenceResult } from "./types";

/**
 * Scripted matcher for tests and for wiring the engine without a model. Each call takes the
 * next scripted result; when a script runs out the last entry repeats.
 */
export class FakeFaceMatcher implements IdFaceMatcher {
  loaded = false;
  readonly calls: string[] = [];
  lastFrame: FaceFrame | null = null;
  #reference = false;

  constructor(
    private readonly script: {
      setReference?: ReferenceResult[];
      compare?: CompareResult[];
      compareLargest?: LargestFaceResult[];
      loadError?: Error;
    } = {},
  ) {}

  async load(): Promise<void> {
    this.calls.push("load");
    if (this.script.loadError) throw this.script.loadError;
    this.loaded = true;
  }

  hasReference(): boolean {
    return this.#reference;
  }

  async setReference(frame: FaceFrame): Promise<ReferenceResult> {
    this.calls.push("setReference");
    this.lastFrame = frame;
    const result = next(this.script.setReference, { ok: true });
    if (result.ok) this.#reference = true;
    return result;
  }

  async compare(frame: FaceFrame): Promise<CompareResult> {
    this.calls.push("compare");
    this.lastFrame = frame;
    if (!this.#reference) return { state: "unknown" };
    return next(this.script.compare, { state: "match", distance: 0.3 });
  }

  async compareLargest(frame: FaceFrame): Promise<LargestFaceResult> {
    this.calls.push("compareLargest");
    this.lastFrame = frame;
    if (!this.#reference) return { found: false };
    return next(this.script.compareLargest, { found: true, distance: 0.4 });
  }

  clear(): void {
    this.calls.push("clear");
    this.#reference = false;
  }
}

function next<T>(list: T[] | undefined, fallback: T): T {
  if (!list || list.length === 0) return fallback;
  return list.length > 1 ? (list.shift() as T) : list[0];
}
