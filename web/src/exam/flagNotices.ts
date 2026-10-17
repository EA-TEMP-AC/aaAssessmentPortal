import type { ProctorFlagType } from "./proctorBridge";

/**
 * What the candidate sees when the engine raises a flag (X-05). One calm sentence per type: it
 * says what to do, never what was suspected, and never shows a severity. Kept in memory only.
 */
export const FLAG_NOTICE_TEXT: Record<ProctorFlagType, string> = {
  tab_hidden: "Please keep this exam tab open and in front while you work.",
  window_blur: "Please keep this exam window in front while you work.",
  fullscreen_exit: "Please return to full screen.",
  permission_revoked: "Your camera stopped sending video. Please check that it is connected and allowed.",
  object_detected: "Please keep your desk clear of other items.",
  face_not_present: "We could not see your face. Please sit facing the camera.",
  multiple_faces: "More than one face is in view. Please make sure only you are in front of the camera.",
  person_detected: "Another person may be in view. Please make sure only you are in front of the camera.",
  phone_detected: "A phone may be in view. Please keep phones out of sight.",
  camera_blocked: "Your camera view is dark or covered. Please uncover it and check the light.",
  camera_frozen: "Your camera picture seems stuck. Please check your camera.",
  face_mismatch: "Please face the camera in good light.",
  id_mismatch: "Your ID card photo could not be checked. You can carry on with the exam.",
  id_unreadable: "Your ID card photo could not be read. You can carry on with the exam.",
  looking_away: "Please keep your face towards the screen while you work.",
  voice_detected: "Please stay quiet during the exam.",
  screen_share_stopped: "Screen sharing has stopped. A flag has been recorded; please tell your proctor.",
};

export type NoticeState = {
  /** Types waiting to be shown; the first is on screen. */
  queue: ProctorFlagType[];
  /** When each type was last accepted (ms), to merge repeats inside the cooldown. */
  accepted: Partial<Record<ProctorFlagType, number>>;
};

export const NO_NOTICES: NoticeState = { queue: [], accepted: {} };

/** Adds a notice unless the same type is already waiting or was accepted inside the cooldown. */
export function addNotice(state: NoticeState, type: ProctorFlagType, nowMs: number, cooldownMs: number): NoticeState {
  if (state.queue.includes(type)) return state;
  const last = state.accepted[type];
  if (last !== undefined && nowMs - last < cooldownMs) return state;
  return { queue: [...state.queue, type], accepted: { ...state.accepted, [type]: nowMs } };
}

export function dismissNotice(state: NoticeState): NoticeState {
  return state.queue.length === 0 ? state : { ...state, queue: state.queue.slice(1) };
}
