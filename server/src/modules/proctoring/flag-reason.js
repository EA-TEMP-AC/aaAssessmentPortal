import { compliance } from "../../config/compliance.js";

/**
 * X-07: one plain-words line per flag type, built on the server from the type and the configured
 * hold time. The browser draws its own copy on the photo; this one is what the reviewer compares
 * it with, so a changed picture does not change the saved reason.
 */
const REASONS = {
  tab_hidden: () => "The exam tab was hidden",
  fullscreen_exit: () => "Full screen was left",
  window_blur: () => "The exam window lost focus",
  permission_revoked: () => "Camera permission was removed or the camera stopped",
  object_detected: (n) => `A forbidden object was in view${forSeconds(n)}`,
  face_not_present: (n) => `Face not visible${forSeconds(n)}`,
  multiple_faces: (n) => `More than one face in view${forSeconds(n)}`,
  person_detected: (n) => `Another person in view${forSeconds(n)}`,
  phone_detected: (n) => `A phone in view${forSeconds(n)}`,
  camera_blocked: (n) => `Camera covered or too dark${forSeconds(n)}`,
  camera_frozen: (n) => `Camera picture frozen${forSeconds(n)}`,
  face_mismatch: () => "Face did not match the selfie",
  id_mismatch: () => "ID card photo did not match the selfie",
  id_unreadable: () => "ID card photo could not be read",
  looking_away: (n) => `Head turned away from the screen${forSeconds(n)}`,
  voice_detected: (n) => `Talking heard${forSeconds(n)}`,
};

function forSeconds(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  return ` for ${n} ${n === 1 ? "second" : "seconds"}`;
}

export function flagReason(type) {
  const build = REASONS[type];
  return build ? build(compliance.PROCTOR_SUSTAINED_SECONDS[type]) : type;
}
