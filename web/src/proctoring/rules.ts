import { DEFAULT_SUSTAINED_SECONDS, PROCTOR_THRESHOLDS, type ProctorThresholds } from "./config";
import type { Detection, FlagDetail, ProctorConfig, ProctorFlagType, RaisedFlag } from "./types";

/**
 * Pure rules. No timers, no DOM: the caller passes the time (`now`, in ms) and what was seen,
 * and gets back the next state and the flags to raise. State is never mutated.
 */

/** Conditions that must hold for a while before they raise a flag. */
type FrameRule = Extract<
  ProctorFlagType,
  | "face_not_present"
  | "multiple_faces"
  | "person_detected"
  | "phone_detected"
  | "object_detected"
  | "camera_blocked"
  | "camera_frozen"
  | "looking_away"
  | "voice_detected"
>;

const FRAME_RULES: readonly FrameRule[] = [
  "face_not_present",
  "multiple_faces",
  "person_detected",
  "phone_detected",
  "object_detected",
  "camera_blocked",
  "camera_frozen",
  "looking_away",
  "voice_detected",
];

const MODEL_RULES: ReadonlySet<FrameRule> = new Set([
  "face_not_present",
  "multiple_faces",
  "person_detected",
  "phone_detected",
  "object_detected",
  "looking_away",
]);

export type RulesState = {
  /** When each condition started holding without a break, or null. */
  since: Partial<Record<FrameRule, number | null>>;
  /** When each flag type was last raised. */
  lastRaised: Partial<Record<ProctorFlagType, number>>;
};

export type FrameInput = {
  /** Model output, or null when no model is loaded (degraded). Model rules then do nothing. */
  detections: Detection[] | null;
  /** Mean brightness 0 to 255, or null when the frame could not be read. */
  brightness: number | null;
  /** True when this frame matches the previous one; null when unknown. */
  identical: boolean | null;
  /** X-14: microphone loudness 0 to 1 with the room's quiet level taken out; null when there is no microphone. */
  voiceLevel?: number | null;
};

export function createRulesState(): RulesState {
  return { since: {}, lastRaised: {} };
}

export function sustainedMs(config: ProctorConfig, type: ProctorFlagType): number {
  const seconds = config.sustainedSeconds[type] ?? DEFAULT_SUSTAINED_SECONDS[type] ?? 0;
  return Math.max(0, seconds) * 1000;
}

function cooldownAllows(state: RulesState, type: ProctorFlagType, now: number, config: ProctorConfig): boolean {
  const last = state.lastRaised[type];
  return last === undefined || now - last >= Math.max(0, config.flagCooldownSeconds) * 1000;
}

/**
 * For events that are instant (tab hidden, window blur, fullscreen exit, camera track ended).
 * Only the cooldown applies.
 */
export function evaluateEvent(
  state: RulesState,
  type: ProctorFlagType,
  now: number,
  config: ProctorConfig,
  detail?: FlagDetail,
): { state: RulesState; flag: RaisedFlag | null } {
  if (!cooldownAllows(state, type, now, config)) return { state, flag: null };
  return {
    state: { ...state, lastRaised: { ...state.lastRaised, [type]: now } },
    flag: detail ? { type, at: now, detail } : { type, at: now },
  };
}

type Finding = { active: boolean; detail?: FlagDetail };

function strongest(items: Detection[]): number {
  return items.reduce((best, d) => Math.max(best, d.confidence), 0);
}

function finding(items: Detection[], label: string): Finding {
  if (items.length === 0) return { active: false };
  return {
    active: true,
    detail: { label, count: items.length, confidence: round(strongest(items)) },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** What each condition looks like in this one frame, without timing. */
export function findConditions(
  input: FrameInput,
  thresholds: ProctorThresholds = PROCTOR_THRESHOLDS,
): Record<FrameRule, Finding> {
  const result = {} as Record<FrameRule, Finding>;
  const dark = input.brightness !== null && input.brightness < thresholds.darkBrightness;

  result.camera_blocked = dark
    ? { active: true, detail: { label: "dark frame", count: 1, confidence: 1 } }
    : { active: false };
  // A black frame is also an unchanged frame; report it as blocked, not frozen.
  result.camera_frozen =
    input.identical === true && !dark
      ? { active: true, detail: { label: "unchanged frame", count: 1, confidence: 1 } }
      : { active: false };

  // X-14: talking is read from the microphone, so it works even when no model is loaded.
  const heard = input.voiceLevel ?? null;
  result.voice_detected =
    heard !== null && heard >= thresholds.voiceLevel
      ? { active: true, detail: { label: "voice", count: 1, confidence: round(Math.min(1, heard)) } }
      : { active: false };

  const all = input.detections;
  if (all === null) {
    for (const rule of MODEL_RULES) result[rule] = { active: false };
    return result;
  }

  const c = thresholds.confidence;
  const faces = all.filter((d) => d.kind === "face" && d.confidence >= c.face);
  const persons = all.filter((d) => d.kind === "person" && d.confidence >= c.person);
  const phones = all.filter(
    (d) =>
      (d.kind === "phone" || thresholds.phoneLabels.includes(d.label)) && d.confidence >= c.phone,
  );
  const objects = all.filter(
    (d) => d.kind === "object" && thresholds.objectLabels.includes(d.label) && d.confidence >= c.object,
  );

  result.face_not_present =
    faces.length === 0 && !dark
      ? { active: true, detail: { label: "no face", count: 0, confidence: 0 } }
      : { active: false };
  result.multiple_faces = faces.length >= 2 ? finding(faces, "face") : { active: false };
  // X-14: exactly one face, turned well to the side. Two faces is multiple_faces, none is face_not_present.
  const turn = faces.length === 1 ? faces[0].headTurn : undefined;
  result.looking_away =
    turn !== undefined && Math.abs(turn) >= thresholds.lookAwayTurn
      ? { active: true, detail: { label: "head turned", count: 1, confidence: round(Math.min(1, Math.abs(turn))) } }
      : { active: false };
  // The candidate is one person; a second one is the flag.
  result.person_detected = persons.length >= 2 ? finding(persons, "person") : { active: false };
  result.phone_detected = finding(phones, "cell phone");
  result.object_detected =
    objects.length > 0 ? finding(objects, objects.reduce((a, b) => (b.confidence > a.confidence ? b : a)).label) : { active: false };
  return result;
}

/**
 * One detection cycle. A condition raises its flag once it has held for its sustained time,
 * and again only after the cooldown. A frame where it does not hold resets its timer.
 */
export function evaluateFrame(
  state: RulesState,
  input: FrameInput,
  now: number,
  config: ProctorConfig,
  thresholds: ProctorThresholds = PROCTOR_THRESHOLDS,
): { state: RulesState; flags: RaisedFlag[] } {
  const conditions = findConditions(input, thresholds);
  const since: RulesState["since"] = { ...state.since };
  let next: RulesState = { ...state, since };
  const flags: RaisedFlag[] = [];

  for (const rule of FRAME_RULES) {
    const { active, detail } = conditions[rule];
    if (!active || config.disabledFlags?.includes(rule)) {
      since[rule] = null;
      continue;
    }
    const started = since[rule] ?? now;
    since[rule] = started;
    if (now - started < sustainedMs(config, rule)) continue;
    const raised = evaluateEvent(next, rule, now, config, detail);
    next = { ...raised.state, since };
    if (raised.flag) flags.push(raised.flag);
  }
  return { state: next, flags };
}

/** Mean brightness and the change from the previous grey sample. Both 0 to 255. */
export function frameStats(
  gray: Uint8ClampedArray | Uint8Array,
  previous: Uint8ClampedArray | Uint8Array | null,
  thresholds: ProctorThresholds = PROCTOR_THRESHOLDS,
): { brightness: number; identical: boolean | null } {
  if (gray.length === 0) return { brightness: 0, identical: null };
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) sum += gray[i];
  const brightness = sum / gray.length;
  if (!previous || previous.length !== gray.length) return { brightness, identical: null };
  let diff = 0;
  for (let i = 0; i < gray.length; i += 1) diff += Math.abs(gray[i] - previous[i]);
  return { brightness, identical: diff / gray.length < thresholds.frozenDifference };
}

/** RGBA pixels to one grey byte per pixel (Rec. 601 luma). */
export function toGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(Math.floor(rgba.length / 4));
  for (let i = 0, j = 0; j < out.length; i += 4, j += 1) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}
