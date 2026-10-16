import type { Detection, Detector } from "./types";

export type DetectorFactory = () => Promise<Detector>;

/**
 * For tests and the demo without a model. Returns the queued frames in order and then
 * keeps returning the last one.
 */
export class FakeDetector implements Detector {
  private frames: Detection[][];
  calls = 0;
  closed = false;

  constructor(frames: Detection[][] = [[]]) {
    this.frames = frames.length > 0 ? frames : [[]];
  }

  setFrames(frames: Detection[][]) {
    this.frames = frames.length > 0 ? frames : [[]];
    this.calls = 0;
  }

  async detect(): Promise<Detection[]> {
    const frame = this.frames[Math.min(this.calls, this.frames.length - 1)];
    this.calls += 1;
    return frame;
  }

  close() {
    this.closed = true;
  }
}
