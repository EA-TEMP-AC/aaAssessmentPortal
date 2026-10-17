import { DEFAULT_SUSTAINED_SECONDS } from "./config";

/**
 * Plain words for a flag, drawn on the flag photo (X-07). The server builds its own copy of the
 * reason (server/src/modules/proctoring/flag-reason.js) so a reviewer can compare the two.
 */

export const FLAG_NAMES: Record<string, string> = {
  tab_hidden: "Tab hidden",
  fullscreen_exit: "Left full screen",
  window_blur: "Window lost focus",
  permission_revoked: "Camera permission removed",
  object_detected: "Object detected",
  face_not_present: "No face in view",
  multiple_faces: "More than one face",
  person_detected: "Another person detected",
  phone_detected: "Phone detected",
  camera_blocked: "Camera blocked",
  camera_frozen: "Camera frozen",
  face_mismatch: "Face differs from the selfie",
  id_mismatch: "ID card photo differs from the selfie",
  id_unreadable: "ID card photo not readable",
  looking_away: "Looking away from the screen",
  voice_detected: "Voice heard",
  screen_share_stopped: "Screen sharing stopped",
  recording_failed: "Video recording failed",
};

/** Used when the server config has no severity for a type. Same values as compliance.js. */
export const DEFAULT_SEVERITY: Record<string, string> = {
  tab_hidden: "low",
  fullscreen_exit: "low",
  window_blur: "low",
  permission_revoked: "low",
  object_detected: "low",
  face_not_present: "medium",
  multiple_faces: "high",
  person_detected: "high",
  phone_detected: "high",
  camera_blocked: "high",
  camera_frozen: "high",
  face_mismatch: "high",
  id_mismatch: "high",
  id_unreadable: "medium",
  looking_away: "medium",
  voice_detected: "medium",
  screen_share_stopped: "high",
  recording_failed: "medium",
};

export function flagName(type: string): string {
  return FLAG_NAMES[type] ?? type;
}

function forSeconds(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "";
  return ` for ${n} ${n === 1 ? "second" : "seconds"}`;
}

/** One line, for example "Face not visible for 2 seconds". `sustained` is the configured hold time. */
export function flagReason(type: string, sustained?: Record<string, number>): string {
  const n = sustained?.[type] ?? DEFAULT_SUSTAINED_SECONDS[type];
  switch (type) {
    case "tab_hidden":
      return "The exam tab was hidden";
    case "fullscreen_exit":
      return "Full screen was left";
    case "window_blur":
      return "The exam window lost focus";
    case "permission_revoked":
      return "Camera permission was removed or the camera stopped";
    case "object_detected":
      return `A forbidden object was in view${forSeconds(n)}`;
    case "face_not_present":
      return `Face not visible${forSeconds(n)}`;
    case "multiple_faces":
      return `More than one face in view${forSeconds(n)}`;
    case "person_detected":
      return `Another person in view${forSeconds(n)}`;
    case "phone_detected":
      return `A phone in view${forSeconds(n)}`;
    case "camera_blocked":
      return `Camera covered or too dark${forSeconds(n)}`;
    case "camera_frozen":
      return `Camera picture frozen${forSeconds(n)}`;
    case "face_mismatch":
      return "Face did not match the selfie";
    case "id_mismatch":
      return "ID card photo did not match the selfie";
    case "id_unreadable":
      return "ID card photo could not be read";
    case "looking_away":
      return `Head turned away from the screen${forSeconds(n)}`;
    case "voice_detected":
      return `Talking heard${forSeconds(n)}`;
    case "screen_share_stopped":
      return "Screen sharing was stopped during the exam";
    case "recording_failed":
      return "The exam video could not be recorded or sent";
    default:
      return type;
  }
}

export function severityLabel(severity: string): string {
  return severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : "Unknown";
}
