import type { Detection, Detector } from "./types";

/**
 * MediaPipe Tasks Vision (Apache-2.0): Face Detector (BlazeFace short range) and Object
 * Detector (EfficientDet-Lite0, COCO labels). Every file is served from /mediapipe/ in this
 * app; nothing is fetched from a CDN at run time. See web/public/mediapipe/README.md.
 *
 * The library is imported only when this runs, so tests and pages that never start the
 * engine do not load it.
 */

const BASE = `${import.meta.env.BASE_URL ?? "/"}mediapipe`.replace(/\/{2,}/g, "/");
export const MEDIAPIPE_PATHS = {
  wasm: `${BASE}/wasm`,
  faceModel: `${BASE}/models/blaze_face_short_range.tflite`,
  objectModel: `${BASE}/models/efficientdet_lite0.tflite`,
};

type Box = { categories: { categoryName?: string; score: number }[] };

/** Map the object detector's COCO label to our kinds. */
export function kindForLabel(label: string): Detection["kind"] {
  if (label === "person") return "person";
  if (label === "cell phone") return "phone";
  return "object";
}

export async function createMediaPipeDetector(): Promise<Detector> {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_PATHS.wasm);

  const create = async (delegate: "GPU" | "CPU") =>
    Promise.all([
      vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE_PATHS.faceModel, delegate },
        runningMode: "VIDEO",
        // Low cut-offs here; the rules apply the real ones from PROCTOR_THRESHOLDS.
        minDetectionConfidence: 0.3,
      }),
      vision.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE_PATHS.objectModel, delegate },
        runningMode: "VIDEO",
        scoreThreshold: 0.3,
        maxResults: 10,
      }),
    ]);

  let face: Awaited<ReturnType<typeof create>>[0];
  let objects: Awaited<ReturnType<typeof create>>[1];
  try {
    [face, objects] = await create("GPU");
  } catch {
    [face, objects] = await create("CPU");
  }

  let lastTimestamp = 0;

  return {
    async detect(frame) {
      // VIDEO mode needs a strictly increasing timestamp.
      const timestamp = Math.max(performance.now(), lastTimestamp + 1);
      lastTimestamp = timestamp;
      const out: Detection[] = [];
      for (const box of face.detectForVideo(frame, timestamp).detections as Box[]) {
        out.push({ kind: "face", label: "face", confidence: box.categories[0]?.score ?? 0 });
      }
      for (const box of objects.detectForVideo(frame, timestamp).detections as Box[]) {
        const top = box.categories[0];
        if (!top) continue;
        const label = top.categoryName ?? "object";
        out.push({ kind: kindForLabel(label), label, confidence: top.score });
      }
      return out;
    },
    close() {
      face.close();
      objects.close();
    },
  };
}
