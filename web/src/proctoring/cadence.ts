import type { Detection, Detector } from "./types";

/**
 * Runs the light model on every call and the heavy one only every `objectIntervalMs`. Between
 * runs the last object result is reused, so the rules see a steady picture and a phone that
 * stays in view keeps counting. If the heavy model throws, nothing is reused and the call fails
 * like any other detection error.
 */
export function withObjectCadence(
  detectFaces: Detector["detect"],
  detectObjects: Detector["detect"],
  objectIntervalMs: number,
  now: () => number = () => performance.now(),
): Pick<Detector, "detect"> {
  let lastObjects: Detection[] = [];
  let lastRun: number | null = null;
  return {
    async detect(frame) {
      const faces = await detectFaces(frame);
      const at = now();
      if (lastRun === null || at - lastRun >= objectIntervalMs) {
        lastObjects = await detectObjects(frame);
        lastRun = at;
      }
      return [...faces, ...lastObjects];
    },
  };
}
