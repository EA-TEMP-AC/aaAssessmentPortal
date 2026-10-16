import type { FaceConfig } from "./config";

/** JPEG copies of the ID still and the selfie for the exam page to upload later. This file uploads nothing. */

export type JpegSource = ImageBitmap | HTMLVideoElement | HTMLCanvasElement;

export function scaledSize(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

function sourceSize(source: JpegSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  return { width: source.width, height: source.height };
}

export function toJpegBlob(
  source: JpegSource,
  config: Pick<FaceConfig, "jpegMaxWidth" | "jpegQuality">,
): Promise<Blob> {
  const size = sourceSize(source);
  const { width, height } = scaledSize(size.width, size.height, config.jpegMaxWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || width === 0 || height === 0) return Promise.reject(new Error("image unavailable"));
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))),
      "image/jpeg",
      config.jpegQuality,
    );
  });
}

export async function evidenceJpegs(
  frames: { idCard: JpegSource; selfie: JpegSource },
  config: Pick<FaceConfig, "jpegMaxWidth" | "jpegQuality">,
): Promise<{ idCard: Blob; selfie: Blob }> {
  const [idCard, selfie] = await Promise.all([toJpegBlob(frames.idCard, config), toJpegBlob(frames.selfie, config)]);
  return { idCard, selfie };
}
