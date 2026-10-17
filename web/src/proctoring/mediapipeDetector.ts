import { PROCTOR_THRESHOLDS } from "./config";
import { withObjectCadence } from "./cadence";
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

type Box = {
  categories: { categoryName?: string; score: number }[];
  /** BlazeFace order: eye, eye, nose tip, mouth, ear, ear. Normalised 0 to 1. */
  keypoints?: { x: number; y: number }[];
};

/** X-14. Sideways head turn from the eyes and the nose tip: see Detection.headTurn. */
export function headTurnOf(keypoints: { x: number; y: number }[] | undefined): number | undefined {
  const [eyeA, eyeB, nose] = keypoints ?? [];
  if (!eyeA || !eyeB || !nose) return undefined;
  const span = Math.abs(eyeB.x - eyeA.x);
  if (span < 0.01) return undefined;
  return (nose.x - (eyeA.x + eyeB.x) / 2) / span;
}

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

  // VIDEO mode needs a strictly increasing timestamp, shared by both models.
  const nextTimestamp = () => {
    lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
    return lastTimestamp;
  };

  const detectFaces = async (frame: Parameters<Detector["detect"]>[0]): Promise<Detection[]> =>
    (face.detectForVideo(frame, nextTimestamp()).detections as Box[]).map((box) => ({
      kind: "face",
      label: "face",
      confidence: box.categories[0]?.score ?? 0,
      ...(headTurnOf(box.keypoints) === undefined ? {} : { headTurn: headTurnOf(box.keypoints) }),
    }));

  const detectObjects = async (frame: Parameters<Detector["detect"]>[0]): Promise<Detection[]> => {
    const out: Detection[] = [];
    for (const box of objects.detectForVideo(frame, nextTimestamp()).detections as Box[]) {
      const top = box.categories[0];
      if (!top) continue;
      const label = top.categoryName ?? "object";
      out.push({ kind: kindForLabel(label), label, confidence: top.score });
    }
    return out;
  };

  return {
    ...withObjectCadence(detectFaces, detectObjects, PROCTOR_THRESHOLDS.objectDetectionIntervalMs),
    close() {
      face.close();
      objects.close();
    },
  };
}
