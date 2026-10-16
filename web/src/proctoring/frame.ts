import { PROCTOR_THRESHOLDS, type ProctorThresholds } from "./config";
import { renderFlagPhoto, type BannerInput, type PhotoCanvas } from "./banner";
import { toGray } from "./rules";

/**
 * Canvas helpers. Frames are read into memory only, to measure brightness and change and
 * to make a snapshot JPEG; video is never recorded. Both return null when the browser has
 * no 2D canvas (for example jsdom in tests).
 */

export type FrameSampler = (video: HTMLVideoElement) => Uint8ClampedArray | null;
/**
 * With a banner (X-07, flag photos) the JPEG carries the banner strip and is at most
 * `flagPhotoMaxBytes`; the banner may still be resolving (the location), the frame is copied first.
 */
export type SnapshotTaker = (video: HTMLVideoElement, banner?: BannerInput | Promise<BannerInput>) => Promise<Blob | null>;

export function createFrameSampler(thresholds: ProctorThresholds = PROCTOR_THRESHOLDS): {
  sample: FrameSampler;
  release: () => void;
} {
  let canvas: HTMLCanvasElement | null = document.createElement("canvas");
  canvas.width = thresholds.sampleWidth;
  canvas.height = thresholds.sampleHeight;
  return {
    sample(video) {
      if (!canvas || video.readyState < 2) return null;
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d", { willReadFrequently: true });
      } catch {
        return null;
      }
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return toGray(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    },
    release() {
      if (canvas) canvas.width = canvas.height = 0;
      canvas = null;
    },
  };
}

/** JPEG at most `snapshotMaxWidth` wide, quality `snapshotQuality`. */
export function createSnapshotTaker(thresholds: ProctorThresholds = PROCTOR_THRESHOLDS): SnapshotTaker {
  return (video, banner) => {
    if (banner) return takeFlagPhoto(video, banner, thresholds);
    return new Promise((resolve) => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return resolve(null);
      const scale = Math.min(1, thresholds.snapshotMaxWidth / width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d");
      } catch {
        ctx = null;
      }
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          canvas.width = canvas.height = 0;
          resolve(blob);
        },
        "image/jpeg",
        thresholds.snapshotQuality,
      );
    });
  };
}

/** The flag photo: the frame at the same size limit as a snapshot, plus the banner. */
async function takeFlagPhoto(
  video: HTMLVideoElement,
  banner: BannerInput | Promise<BannerInput>,
  thresholds: ProctorThresholds,
): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, thresholds.snapshotMaxWidth / width);
  try {
    return await renderFlagPhoto(
      () => document.createElement("canvas") as unknown as PhotoCanvas,
      { image: video, width: Math.round(width * scale), height: Math.round(height * scale) },
      banner,
      thresholds.flagPhotoMaxBytes,
    );
  } catch {
    return null;
  }
}

export type DetectionFrame = HTMLVideoElement | ImageBitmap;

/**
 * Makes the small copy of the video frame the detector reads: at most `detectionMaxWidth` wide.
 * When the browser cannot (no 2D canvas, no createImageBitmap, video size not known yet) the
 * video itself is returned, so detection still runs, only slower.
 */
export function createDetectionFramer(thresholds: ProctorThresholds = PROCTOR_THRESHOLDS): {
  make: (video: HTMLVideoElement) => Promise<DetectionFrame>;
  release: () => void;
} {
  let canvas: HTMLCanvasElement | null = null;
  return {
    async make(video) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height || typeof createImageBitmap !== "function") return video;
      try {
        const scale = Math.min(1, thresholds.detectionMaxWidth / width);
        canvas ??= document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return video;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return await createImageBitmap(canvas);
      } catch {
        return video;
      }
    },
    release() {
      if (canvas) canvas.width = canvas.height = 0;
      canvas = null;
    },
  };
}
