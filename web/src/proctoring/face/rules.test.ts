import { describe, expect, it } from "vitest";
import { faceConfig } from "./config";
import {
  evaluateIdentity,
  idCheckOutcome,
  ID_MESSAGES,
  INITIAL_IDENTITY_STATE,
  wouldRaiseOnNextMismatch,
  type IdentityState,
} from "./rules";
import type { CompareResult, FaceFlag } from "./types";

const config = faceConfig();
const MISMATCH: CompareResult = { state: "mismatch", distance: 0.81234 };
const MATCH: CompareResult = { state: "match", distance: 0.3 };

/** Feeds one sample per second from t=0 and returns every flag raised. */
function run(samples: CompareResult[], start: IdentityState = INITIAL_IDENTITY_STATE, stepMs = 1000) {
  let state = start;
  const flags: FaceFlag[] = [];
  samples.forEach((sample, i) => {
    const step = evaluateIdentity(sample, state, config, i * stepMs);
    state = step.state;
    if (step.flag) flags.push(step.flag);
  });
  return { state, flags };
}

describe("evaluateIdentity", () => {
  it("never flags on a single mismatched frame", () => {
    const step = evaluateIdentity(MISMATCH, INITIAL_IDENTITY_STATE, config, 0);
    expect(step.flag).toBeNull();
    expect(step.state.streak).toBe(1);
  });

  it("needs 3 consecutive mismatches held for 4 seconds", () => {
    // t=0..3: count reached at t=2 but only 3 s held at t=3.
    expect(run([MISMATCH, MISMATCH, MISMATCH, MISMATCH]).flags).toEqual([]);
    const { flags } = run([MISMATCH, MISMATCH, MISMATCH, MISMATCH, MISMATCH]);
    expect(flags).toEqual([{ type: "face_mismatch", at: 4000, detail: { samples: 5, distance: 0.812 } }]);
  });

  it("needs the sample count even when the time has passed", () => {
    const strict = faceConfig({ mismatchSamples: 3, mismatchHoldMs: 4000 });
    let s = evaluateIdentity(MISMATCH, INITIAL_IDENTITY_STATE, strict, 0).state;
    const step = evaluateIdentity(MISMATCH, s, { ...strict, maxSampleGapMs: 10_000 }, 5000);
    expect(step.flag).toBeNull();
    s = step.state;
    expect(evaluateIdentity(MISMATCH, s, { ...strict, maxSampleGapMs: 10_000 }, 6000).flag?.type).toBe("face_mismatch");
  });

  it("resets the count on a match", () => {
    const { state, flags } = run([MISMATCH, MISMATCH, MISMATCH, MATCH, MISMATCH, MISMATCH, MISMATCH, MISMATCH]);
    expect(flags).toEqual([]);
    expect(state.streak).toBe(4);
  });

  it("does not count or reset on no_face, multiple_faces or unknown", () => {
    const other: CompareResult[] = [{ state: "no_face" }, { state: "multiple_faces" }, { state: "unknown" }];
    for (const sample of other) {
      const before: IdentityState = { streak: 2, runStartedAt: 0, lastMismatchAt: 1000, lastFlagAt: null };
      const step = evaluateIdentity(sample, before, config, 2000);
      expect(step.flag).toBeNull();
      expect(step.state).toEqual(before);
    }
    // Only no_face for a long time: never a flag.
    expect(run(Array(30).fill({ state: "no_face" })).flags).toEqual([]);
  });

  it("starts a new run after a gap longer than maxSampleGapMs", () => {
    const before: IdentityState = { streak: 4, runStartedAt: 0, lastMismatchAt: 3000, lastFlagAt: null };
    const step = evaluateIdentity(MISMATCH, before, config, 3000 + config.maxSampleGapMs + 1);
    expect(step.flag).toBeNull();
    expect(step.state.streak).toBe(1);
  });

  it("respects the cooldown between flags and needs a fresh run after one", () => {
    const { state, flags } = run(Array(20).fill(MISMATCH));
    expect(flags).toHaveLength(1);
    expect(state.lastFlagAt).toBe(4000);
    // Still mismatching after the cooldown: the next flag comes once a new run is long enough.
    const later = run(Array(80).fill(MISMATCH)).flags.map((f) => f.at);
    expect(later).toEqual([4000, 64000]);
  });

  it("returns new state objects and leaves the input alone", () => {
    const before = { ...INITIAL_IDENTITY_STATE };
    evaluateIdentity(MISMATCH, before, config, 0);
    expect(before).toEqual(INITIAL_IDENTITY_STATE);
  });

  it("omits a missing distance from the flag", () => {
    const { flags } = run(Array(5).fill({ state: "mismatch" }));
    expect(flags[0].detail).toEqual({ samples: 5 });
  });

  it("wouldRaiseOnNextMismatch says when the next mismatch flags", () => {
    const s: IdentityState = { streak: 4, runStartedAt: 0, lastMismatchAt: 3000, lastFlagAt: null };
    expect(wouldRaiseOnNextMismatch(s, config, 4000)).toBe(true);
    expect(wouldRaiseOnNextMismatch(s, config, 3500)).toBe(false);
    expect(wouldRaiseOnNextMismatch(INITIAL_IDENTITY_STATE, config, 0)).toBe(false);
  });
});

describe("idCheckOutcome", () => {
  it("match raises nothing", () => {
    expect(idCheckOutcome({ result: "match", distance: 0.4 }, 10)).toEqual({
      flag: null,
      message: ID_MESSAGES.match,
      needsManualReview: false,
      canRetry: false,
    });
  });

  it("mismatch raises id_mismatch once with the distance", () => {
    const outcome = idCheckOutcome({ result: "mismatch", distance: 0.7777 }, 10);
    expect(outcome.flag).toEqual({ type: "id_mismatch", at: 10, detail: { samples: 1, distance: 0.778 } });
    expect(outcome.canRetry).toBe(false);
  });

  it("an unreadable card is not a mismatch: message, manual review, retry", () => {
    const outcome = idCheckOutcome({ result: "id_no_face" }, 10);
    expect(outcome.flag).toBeNull();
    expect(outcome.needsManualReview).toBe(true);
    expect(outcome.canRetry).toBe(true);
    expect(outcome.message).toMatch(/flat.*closer.*focus/);
  });

  it("a missing selfie is not a mismatch", () => {
    const outcome = idCheckOutcome({ result: "selfie_no_face" }, 10);
    expect(outcome.flag).toBeNull();
    expect(outcome.needsManualReview).toBe(true);
  });
});
