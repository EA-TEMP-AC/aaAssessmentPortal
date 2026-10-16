export type {
  CompareResult,
  CompareState,
  FaceFlag,
  FaceFlagType,
  FaceFrame,
  FaceMatcher,
  IdFaceMatcher,
  LargestFaceResult,
  ReferenceResult,
} from "./types";
export { DEFAULT_FACE_CONFIG, faceConfig, type FaceConfig } from "./config";
export {
  evaluateIdentity,
  idCheckOutcome,
  ID_MESSAGES,
  INITIAL_IDENTITY_STATE,
  wouldRaiseOnNextMismatch,
  type IdCheckOutcome,
  type IdCheckResult,
  type IdentityState,
  type IdentityStep,
} from "./rules";
export {
  captureIdCard,
  capturePrecheckReference,
  PRECHECK_MESSAGES,
  verifyIdAgainstReference,
  type CameraDeps,
  type CaptureResult,
} from "./camera";
export { evidenceJpegs, scaledSize, toJpegBlob } from "./jpeg";
export { FaceApiMatcher } from "./faceApiMatcher";
export { FakeFaceMatcher } from "./fakeMatcher";
