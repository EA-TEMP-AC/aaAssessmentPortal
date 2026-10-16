import { vi } from "vitest";
import type { FaceCheckOptions } from "../exam/PrecheckScreen";
import { FakeFaceMatcher, type CameraDeps } from "../proctoring/face";

/** A still the fake matcher accepts. close() is a spy so tests can check frames are released. */
export function fakeBitmap(): ImageBitmap {
  return { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;
}

export function fakeCameraDeps(): CameraDeps {
  return { grabFrame: vi.fn(async () => fakeBitmap()), sleep: vi.fn(async () => {}) };
}

/** jsdom videos never have a frame; this makes every video look ready (640x480). */
export function makeVideosReady() {
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
}

/** Camera-check options that use a scripted matcher and no canvas. */
export function fakeFaceChecks(
  matcher: FakeFaceMatcher = new FakeFaceMatcher(),
  extra: Partial<FaceCheckOptions> = {},
): FaceCheckOptions & { matcher: FakeFaceMatcher } {
  return {
    matcher,
    createMatcher: () => matcher,
    deps: fakeCameraDeps(),
    toJpeg: async (frame) => new Blob([`jpeg-${frame.width}`], { type: "image/jpeg" }),
    ...extra,
  };
}
