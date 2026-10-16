/**
 * Face checks (P-03): 1:1 only. "Are these two photos the same person?" There is no
 * database of people and no government record is used. See docs/FACE_MATCH.md.
 */

export type FaceFrame = HTMLVideoElement | ImageBitmap;

export type ReferenceResult = { ok: true } | { ok: false; reason: "no_face" | "multiple_faces" };

export type CompareState = "match" | "mismatch" | "no_face" | "multiple_faces" | "unknown";

export type CompareResult = { state: CompareState; distance?: number };

/**
 * A replaceable 1:1 matcher (face-api today; a vendor or a better model later).
 * The reference is held in memory only. It is never written to storage, sent to the
 * server, logged or put in a flag. clear() wipes it.
 */
export interface FaceMatcher {
  load(): Promise<void>;
  setReference(frame: FaceFrame): Promise<ReferenceResult>;
  compare(frame: FaceFrame): Promise<CompareResult>;
  clear(): void;
}

/** Largest face in a frame against the reference. Used for the ID card photo. */
export type LargestFaceResult = { found: false } | { found: true; distance: number };

/** A matcher that can also read the largest face on an ID card. */
export interface IdFaceMatcher extends FaceMatcher {
  hasReference(): boolean;
  compareLargest(frame: FaceFrame): Promise<LargestFaceResult>;
}

/** Flag types raised by this module. The engine's flag list adds them at wiring time. */
export type FaceFlagType = "face_mismatch" | "id_mismatch";

/** What the rules decided to raise. No image, no descriptor, no name. */
export type FaceFlag = {
  type: FaceFlagType;
  at: number;
  detail: { samples: number; distance?: number };
};
