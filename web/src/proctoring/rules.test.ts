import { describe, expect, it } from "vitest";
import { PROCTOR_THRESHOLDS } from "./config";
import {
  createRulesState,
  evaluateEvent,
  evaluateFrame,
  findConditions,
  frameStats,
  toGray,
  type FrameInput,
  type RulesState,
} from "./rules";
import type { Detection, ProctorConfig, RaisedFlag } from "./types";

const config: ProctorConfig = {
  snapshotIntervalSeconds: 60,
  detectionIntervalMs: 500,
  flagCooldownSeconds: 10,
  sustainedSeconds: {
    face_not_present: 5,
    multiple_faces: 0,
    person_detected: 0,
    phone_detected: 0,
    object_detected: 0,
    camera_blocked: 3,
    camera_frozen: 4,
  },
};

const face = (confidence = 0.9): Detection => ({ kind: "face", label: "face", confidence });
const person = (confidence = 0.9): Detection => ({ kind: "person", label: "person", confidence });
const object = (label: string, confidence = 0.9): Detection => ({
  kind: label === "cell phone" ? "phone" : "object",
  label,
  confidence,
});

const frame = (detections: Detection[] | null, extra: Partial<FrameInput> = {}): FrameInput => ({
  detections,
  brightness: 120,
  identical: false,
  ...extra,
});

/** Runs frames every `stepMs` from t=0 on a fake clock and collects every flag. */
function play(frames: FrameInput[], stepMs = 1000, cfg = config, start: RulesState = createRulesState()) {
  let state = start;
  const flags: RaisedFlag[] = [];
  frames.forEach((input, i) => {
    const result = evaluateFrame(state, input, i * stepMs, cfg);
    state = result.state;
    flags.push(...result.flags);
  });
  return { state, flags };
}

const types = (flags: RaisedFlag[]) => flags.map((f) => `${f.type}@${f.at}`);

describe("face_not_present", () => {
  it("waits for the sustained time before raising", () => {
    const { flags } = play(Array.from({ length: 6 }, () => frame([])));
    expect(types(flags)).toEqual(["face_not_present@5000"]);
  });

  it("resets the timer when a face comes back", () => {
    const frames = [frame([]), frame([]), frame([]), frame([]), frame([face()]), frame([]), frame([]), frame([])];
    expect(play(frames).flags).toEqual([]);
  });

  it("ignores a face below the confidence cut-off", () => {
    const low = face(PROCTOR_THRESHOLDS.confidence.face - 0.01);
    const { flags } = play(Array.from({ length: 6 }, () => frame([low])));
    expect(types(flags)).toEqual(["face_not_present@5000"]);
  });

  it("raises again only after the cooldown while the face stays away", () => {
    const { flags } = play(Array.from({ length: 21 }, () => frame([])));
    expect(types(flags)).toEqual(["face_not_present@5000", "face_not_present@15000"]);
  });

  it("does nothing while the model is not loaded", () => {
    const { flags } = play(Array.from({ length: 10 }, () => frame(null)));
    expect(flags).toEqual([]);
  });
});

describe("faces, persons, phones and objects", () => {
  it("raises multiple_faces for two faces with a small detail", () => {
    const { flags } = play([frame([face(0.8), face(0.66)])]);
    expect(flags).toEqual([
      { type: "multiple_faces", at: 0, detail: { label: "face", count: 2, confidence: 0.8 } },
    ]);
  });

  it("does not flag one person (the candidate) but flags a second", () => {
    expect(play([frame([face(), person()])]).flags).toEqual([]);
    expect(types(play([frame([face(), person(), person(0.7)])]).flags)).toEqual(["person_detected@0"]);
  });

  it("raises phone_detected for a cell phone", () => {
    const { flags } = play([frame([face(), object("cell phone", 0.55)])]);
    expect(flags).toEqual([
      { type: "phone_detected", at: 0, detail: { label: "cell phone", count: 1, confidence: 0.55 } },
    ]);
  });

  it("raises object_detected for a book, laptop or tv and names the strongest", () => {
    const { flags } = play([frame([face(), object("book", 0.6), object("tv", 0.8)])]);
    expect(flags).toEqual([
      { type: "object_detected", at: 0, detail: { label: "tv", count: 2, confidence: 0.8 } },
    ]);
  });

  it("ignores objects not on the list and low-confidence ones", () => {
    const { flags } = play([frame([face(), object("cup"), object("book", 0.2)])]);
    expect(flags).toEqual([]);
  });

  it("respects a sustained time for object rules too", () => {
    const cfg = { ...config, sustainedSeconds: { ...config.sustainedSeconds, phone_detected: 2 } };
    const phone = frame([face(), object("cell phone")]);
    expect(types(play([phone, phone, phone], 1000, cfg).flags)).toEqual(["phone_detected@2000"]);
    expect(play([phone, frame([face()]), phone], 1000, cfg).flags).toEqual([]);
  });
});

describe("camera_blocked and camera_frozen", () => {
  it("raises camera_blocked when the frame stays dark", () => {
    const dark = frame([face()], { brightness: 5 });
    expect(types(play([dark, dark, dark, dark]).flags)).toEqual(["camera_blocked@3000"]);
  });

  it("does not report a dark frame as frozen or as a missing face", () => {
    const dark = frame([], { brightness: 2, identical: true });
    const flagged = play(Array.from({ length: 8 }, () => dark)).flags.map((f) => f.type);
    expect(flagged).toEqual(["camera_blocked"]);
  });

  it("raises camera_frozen when frames stay identical", () => {
    const still = frame([face()], { identical: true });
    expect(types(play(Array.from({ length: 5 }, () => still)).flags)).toEqual(["camera_frozen@4000"]);
  });

  it("resets camera_frozen when the picture changes", () => {
    const still = frame([face()], { identical: true });
    const frames = [still, still, still, frame([face()]), still, still, still];
    expect(play(frames).flags).toEqual([]);
  });

  it("still checks brightness and freeze while degraded", () => {
    const dark = frame(null, { brightness: 1 });
    expect(types(play([dark, dark, dark, dark]).flags)).toEqual(["camera_blocked@3000"]);
  });

  it("uses default sustained seconds when the server config leaves a type out", () => {
    const cfg = { ...config, sustainedSeconds: {} };
    const dark = frame([face()], { brightness: 1 });
    // DEFAULT_SUSTAINED_SECONDS.camera_blocked is 3.
    expect(types(play([dark, dark, dark, dark], 1000, cfg).flags)).toEqual(["camera_blocked@3000"]);
  });
});

describe("evaluateEvent (browser events)", () => {
  it("raises at once and then waits for the cooldown", () => {
    let state = createRulesState();
    const seen: number[] = [];
    for (const at of [0, 4000, 9999, 10000, 15000, 20000]) {
      const r = evaluateEvent(state, "tab_hidden", at, config);
      state = r.state;
      if (r.flag) seen.push(r.flag.at);
    }
    expect(seen).toEqual([0, 10000, 20000]);
  });

  it("keeps cooldowns separate per flag type", () => {
    let state = createRulesState();
    const a = evaluateEvent(state, "tab_hidden", 0, config);
    state = a.state;
    const b = evaluateEvent(state, "window_blur", 100, config);
    expect(a.flag?.type).toBe("tab_hidden");
    expect(b.flag?.type).toBe("window_blur");
  });

  it("does not change the state it was given", () => {
    const state = createRulesState();
    evaluateEvent(state, "tab_hidden", 0, config);
    evaluateFrame(state, frame([]), 0, config);
    expect(state).toEqual({ since: {}, lastRaised: {} });
  });
});

describe("findConditions", () => {
  it("returns no active condition for a normal frame", () => {
    const result = findConditions(frame([face(), person()]));
    expect(Object.values(result).some((c) => c.active)).toBe(false);
  });
});

describe("frameStats and toGray", () => {
  it("measures brightness and compares with the previous frame", () => {
    const a = new Uint8ClampedArray([10, 20, 30, 40]);
    expect(frameStats(a, null)).toEqual({ brightness: 25, identical: null });
    expect(frameStats(a, new Uint8ClampedArray([10, 20, 30, 40])).identical).toBe(true);
    expect(frameStats(a, new Uint8ClampedArray([12, 22, 32, 42])).identical).toBe(false);
  });

  it("turns RGBA into grey", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(toGray(rgba))).toEqual([255, 0]);
  });
});

describe("looking_away and voice_detected (X-14)", () => {
  const cfg: ProctorConfig = {
    ...config,
    sustainedSeconds: { ...config.sustainedSeconds, looking_away: 6, voice_detected: 4 },
  };
  const turned = (headTurn: number): Detection => ({ kind: "face", label: "face", confidence: 0.9, headTurn });

  it("a face turned away raises looking_away only after the hold time", () => {
    let state = createRulesState();
    let r = evaluateFrame(state, frame([turned(0.7)]), 0, cfg);
    expect(r.flags).toEqual([]);
    state = r.state;
    r = evaluateFrame(state, frame([turned(-0.7)]), 5999, cfg);
    expect(r.flags).toEqual([]);
    r = evaluateFrame(r.state, frame([turned(0.7)]), 6000, cfg);
    expect(r.flags.map((f) => f.type)).toEqual(["looking_away"]);
  });

  it("turning back resets the timer", () => {
    let r = evaluateFrame(createRulesState(), frame([turned(0.7)]), 0, cfg);
    r = evaluateFrame(r.state, frame([turned(0.1)]), 4000, cfg);
    r = evaluateFrame(r.state, frame([turned(0.7)]), 5000, cfg);
    r = evaluateFrame(r.state, frame([turned(0.7)]), 9000, cfg);
    expect(r.flags).toEqual([]);
  });

  it("a face with no landmarks, two faces, or no model never counts as looking away", () => {
    expect(findConditions(frame([face()])).looking_away.active).toBe(false);
    expect(findConditions(frame([turned(0.9), turned(0.9)])).looking_away.active).toBe(false);
    expect(findConditions(frame(null)).looking_away.active).toBe(false);
  });

  it("loud talking raises voice_detected after its hold time, even with no model", () => {
    let r = evaluateFrame(createRulesState(), frame(null, { voiceLevel: 0.2 }), 0, cfg);
    expect(r.flags).toEqual([]);
    r = evaluateFrame(r.state, frame(null, { voiceLevel: 0.2 }), 4000, cfg);
    expect(r.flags.map((f) => f.type)).toEqual(["voice_detected"]);
  });

  it("no microphone, or a quiet room, never raises voice_detected", () => {
    expect(findConditions(frame([face()])).voice_detected.active).toBe(false);
    expect(findConditions(frame([face()], { voiceLevel: null })).voice_detected.active).toBe(false);
    expect(findConditions(frame([face()], { voiceLevel: 0 })).voice_detected.active).toBe(false);
  });
});
