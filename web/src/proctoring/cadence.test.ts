import { describe, expect, it, vi } from "vitest";
import { withObjectCadence } from "./cadence";
import type { Detection } from "./types";

const face: Detection = { kind: "face", label: "face", confidence: 0.9 };
const phone: Detection = { kind: "phone", label: "cell phone", confidence: 0.8 };
const frame = {} as HTMLVideoElement;

describe("withObjectCadence", () => {
  it("runs faces every call and objects every 2 seconds, reusing the last objects between", async () => {
    let t = 0;
    const faces = vi.fn(async () => [face]);
    const objects = vi.fn(async () => [phone]);
    const d = withObjectCadence(faces, objects, 2000, () => t);

    expect(await d.detect(frame)).toEqual([face, phone]);
    for (t = 500; t < 2000; t += 500) expect(await d.detect(frame)).toEqual([face, phone]);
    expect(faces).toHaveBeenCalledTimes(4);
    expect(objects).toHaveBeenCalledTimes(1);

    t = 2000;
    await d.detect(frame);
    expect(objects).toHaveBeenCalledTimes(2);
  });

  it("shows the newest object result once the object model runs again", async () => {
    let t = 0;
    const objects = vi.fn().mockResolvedValueOnce([phone]).mockResolvedValueOnce([]);
    const d = withObjectCadence(async () => [face], objects, 2000, () => t);
    expect(await d.detect(frame)).toContainEqual(phone);
    t = 2500;
    expect(await d.detect(frame)).toEqual([face]);
  });
});
