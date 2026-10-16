import type { FaceConfig } from "./config";
import type { CompareResult, FaceFlag } from "./types";

/**
 * Pure rules. No clock, no camera, no model: the caller passes `now` (ms) and the sample.
 */

export type IdentityState = {
  /** Mismatches in the current run. */
  streak: number;
  runStartedAt: number | null;
  lastMismatchAt: number | null;
  lastFlagAt: number | null;
};

export const INITIAL_IDENTITY_STATE: Readonly<IdentityState> = Object.freeze({
  streak: 0,
  runStartedAt: null,
  lastMismatchAt: null,
  lastFlagAt: null,
});

export type IdentityStep = { state: IdentityState; flag: FaceFlag | null };

type IdentityConfig = Pick<
  FaceConfig,
  "mismatchSamples" | "mismatchHoldMs" | "maxSampleGapMs" | "flagCooldownMs"
>;

/**
 * Same-person check during the exam. A flag needs `mismatchSamples` consecutive mismatches
 * spanning at least `mismatchHoldMs`, never a single frame. A match ends the run.
 * no_face, multiple_faces and unknown neither count nor reset (other checks handle them).
 * After a flag the run starts again, and no flag is raised inside the cooldown.
 */
export function evaluateIdentity(
  sample: CompareResult,
  state: IdentityState,
  config: IdentityConfig,
  now: number,
): IdentityStep {
  if (sample.state === "match") {
    return { state: { ...state, streak: 0, runStartedAt: null, lastMismatchAt: null }, flag: null };
  }
  if (sample.state !== "mismatch") return { state, flag: null };

  const continues =
    state.streak > 0 && state.lastMismatchAt !== null && now - state.lastMismatchAt <= config.maxSampleGapMs;
  const streak = continues ? state.streak + 1 : 1;
  const runStartedAt = continues && state.runStartedAt !== null ? state.runStartedAt : now;
  const next: IdentityState = { ...state, streak, runStartedAt, lastMismatchAt: now };

  const sustained = streak >= config.mismatchSamples && now - runStartedAt >= config.mismatchHoldMs;
  const cooling = state.lastFlagAt !== null && now - state.lastFlagAt < config.flagCooldownMs;
  if (!sustained || cooling) return { state: next, flag: null };

  return {
    state: { streak: 0, runStartedAt: null, lastMismatchAt: null, lastFlagAt: now },
    flag: { type: "face_mismatch", at: now, detail: { samples: streak, ...roundedDistance(sample.distance) } },
  };
}

/** True when the next mismatch sample would raise a flag (for the demo indicator). */
export function wouldRaiseOnNextMismatch(state: IdentityState, config: IdentityConfig, now: number): boolean {
  return evaluateIdentity({ state: "mismatch" }, state, config, now).flag !== null;
}

export type IdCheckResult =
  | { result: "match"; distance: number }
  | { result: "mismatch"; distance: number }
  | { result: "id_no_face" }
  | { result: "selfie_no_face" };

export type IdCheckOutcome = {
  /** Raised once, at the camera check. Never repeated. */
  flag: FaceFlag | null;
  /** Shown to the candidate. */
  message: string;
  /** Unreadable card or missing selfie: a proctor can resolve it by hand. Not a mismatch. */
  needsManualReview: boolean;
  canRetry: boolean;
};

export const ID_MESSAGES = {
  match: "ID card photo checked.",
  mismatch: "The ID card photo could not be matched to your selfie. A proctor will review this. You can continue.",
  id_no_face: "We could not read the photo on the card. Hold the card flat, closer to the camera, with the photo in focus.",
  selfie_no_face: "Take the selfie again first: we need one clear view of your face.",
} as const;

/** Turns an ID check result into what the exam page does. Pure. */
export function idCheckOutcome(check: IdCheckResult, now: number): IdCheckOutcome {
  switch (check.result) {
    case "match":
      return { flag: null, message: ID_MESSAGES.match, needsManualReview: false, canRetry: false };
    case "mismatch":
      return {
        flag: { type: "id_mismatch", at: now, detail: { samples: 1, ...roundedDistance(check.distance) } },
        message: ID_MESSAGES.mismatch,
        needsManualReview: false,
        canRetry: false,
      };
    case "id_no_face":
      return { flag: null, message: ID_MESSAGES.id_no_face, needsManualReview: true, canRetry: true };
    case "selfie_no_face":
      return { flag: null, message: ID_MESSAGES.selfie_no_face, needsManualReview: true, canRetry: true };
  }
}

function roundedDistance(distance: number | undefined): { distance?: number } {
  return typeof distance === "number" && Number.isFinite(distance)
    ? { distance: Math.round(distance * 1000) / 1000 }
    : {};
}
