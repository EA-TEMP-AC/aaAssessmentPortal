import {
  INFO_FIELD_LABELS,
  INFO_FIELDS,
  INTERVAL_MAX_SECONDS,
  INTERVAL_MIN_SECONDS,
  LOCATION_ROLES,
  LOCATION_ROLE_LABELS,
  PAUSE_AFTER_MAX,
  PAUSE_AFTER_MIN,
  type BatchSettings,
  type BatchSettingsPatch,
  type InfoField,
  type LocationRole,
} from "../../api/batchSettings";

/** The form's working copy of the batch settings, and the rules around it (task B-20). */

export type Draft = {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showMarksToCandidate: boolean;
  marksAfterValidation: boolean;
  questionsMandatory: boolean;
  extendOnUnlock: boolean;
  locationVisibleTo: LocationRole[];
  action: "record" | "pause";
  pauseAfterFlags: string;
  countMedium: boolean;
  intervalSeconds: string;
  atStartAndEnd: boolean;
  popupEnabled: boolean;
  popupFields: InfoField[];
  captureLocation: boolean;
  skipPaperApproval: boolean;
  detectLookingAway: boolean;
  detectVoice: boolean;
  requireScreenShare: boolean;
};

export type Problems = Partial<
  Record<"pauseAfterFlags" | "intervalSeconds" | "popupFields", string>
>;

export function toDraft(s: BatchSettings): Draft {
  return {
    shuffleQuestions: s.shuffleQuestions,
    shuffleOptions: s.shuffleOptions,
    showMarksToCandidate: s.showMarksToCandidate,
    marksAfterValidation: s.marksAfterValidation,
    questionsMandatory: s.questionsMandatory,
    extendOnUnlock: s.flagPolicy.extendOnUnlock,
    locationVisibleTo: [...s.locationVisibleTo],
    action: s.flagPolicy.action,
    pauseAfterFlags: String(s.flagPolicy.pauseAfterFlags),
    countMedium: s.flagPolicy.countSeverities.includes("medium"),
    intervalSeconds: String(s.imageCapture.intervalSeconds),
    atStartAndEnd: s.imageCapture.atStartAndEnd,
    popupEnabled: s.candidateInfoPopup.enabled,
    popupFields: [...s.candidateInfoPopup.fields],
    captureLocation: s.captureLocation,
    skipPaperApproval: s.skipPaperApproval,
    detectLookingAway: s.detectLookingAway,
    detectVoice: s.detectVoice,
    requireScreenShare: s.requireScreenShare,
  };
}

function wholeNumber(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** Same limits as the server. The server checks again. */
export function validateDraft(draft: Draft): Problems {
  const problems: Problems = {};
  const after = wholeNumber(draft.pauseAfterFlags);
  if (after === null || after < PAUSE_AFTER_MIN || after > PAUSE_AFTER_MAX) {
    problems.pauseAfterFlags = `Enter a whole number from ${PAUSE_AFTER_MIN} to ${PAUSE_AFTER_MAX}.`;
  }
  const interval = wholeNumber(draft.intervalSeconds);
  if (
    interval === null ||
    interval < INTERVAL_MIN_SECONDS ||
    interval > INTERVAL_MAX_SECONDS
  ) {
    problems.intervalSeconds = `Enter a whole number of seconds from ${INTERVAL_MIN_SECONDS} to ${INTERVAL_MAX_SECONDS}.`;
  }
  if (draft.popupEnabled && draft.popupFields.length === 0) {
    problems.popupFields = "Choose at least one field, or turn the pop-up off.";
  }
  return problems;
}

/** Only what differs from the saved settings, in the shape PATCH takes. */
export function buildPatch(
  saved: BatchSettings,
  draft: Draft,
): BatchSettingsPatch {
  const patch: BatchSettingsPatch = {};
  for (const key of [
    "shuffleQuestions",
    "shuffleOptions",
    "showMarksToCandidate",
    "marksAfterValidation",
    "questionsMandatory",
    "captureLocation",
    "skipPaperApproval",
    "detectLookingAway",
    "detectVoice",
    "requireScreenShare",
  ] as const) {
    if (draft[key] !== saved[key]) patch[key] = draft[key];
  }
  const viewers = LOCATION_ROLES.filter((r) => draft.locationVisibleTo.includes(r));
  if (viewers.join() !== saved.locationVisibleTo.join()) patch.locationVisibleTo = viewers;
  const policy: NonNullable<BatchSettingsPatch["flagPolicy"]> = {};
  if (draft.action !== saved.flagPolicy.action) policy.action = draft.action;
  const after = Number(draft.pauseAfterFlags);
  if (after !== saved.flagPolicy.pauseAfterFlags)
    policy.pauseAfterFlags = after;
  const severities: ("medium" | "high")[] = draft.countMedium
    ? ["medium", "high"]
    : ["high"];
  if (severities.join() !== saved.flagPolicy.countSeverities.join())
    policy.countSeverities = severities;
  if (draft.extendOnUnlock !== saved.flagPolicy.extendOnUnlock)
    policy.extendOnUnlock = draft.extendOnUnlock;
  if (Object.keys(policy).length > 0) patch.flagPolicy = policy;

  const image: NonNullable<BatchSettingsPatch["imageCapture"]> = {};
  const interval = Number(draft.intervalSeconds);
  if (interval !== saved.imageCapture.intervalSeconds)
    image.intervalSeconds = interval;
  if (draft.atStartAndEnd !== saved.imageCapture.atStartAndEnd)
    image.atStartAndEnd = draft.atStartAndEnd;
  if (Object.keys(image).length > 0) patch.imageCapture = image;

  const popup: NonNullable<BatchSettingsPatch["candidateInfoPopup"]> = {};
  if (draft.popupEnabled !== saved.candidateInfoPopup.enabled)
    popup.enabled = draft.popupEnabled;
  const fields = INFO_FIELDS.filter((f) => draft.popupFields.includes(f));
  if (fields.join() !== saved.candidateInfoPopup.fields.join())
    popup.fields = fields;
  if (Object.keys(popup).length > 0) patch.candidateInfoPopup = popup;
  return patch;
}

const yesNo = (value: boolean) => (value ? "On" : "Off");

/** The lines the confirmation shows: what changes, in plain words. */
export function describeChanges(saved: BatchSettings, draft: Draft): string[] {
  const lines: string[] = [];
  const flip = (label: string, from: boolean, to: boolean) => {
    if (from !== to) lines.push(`${label}: ${yesNo(from)} to ${yesNo(to)}`);
  };
  flip("Shuffle the questions", saved.shuffleQuestions, draft.shuffleQuestions);
  flip(
    "Shuffle the answer options",
    saved.shuffleOptions,
    draft.shuffleOptions,
  );
  flip(
    "Show marks to the candidate",
    saved.showMarksToCandidate,
    draft.showMarksToCandidate,
  );
  flip(
    "Marks only after the result is validated",
    saved.marksAfterValidation,
    draft.marksAfterValidation,
  );
  flip(
    "Every question must be answered",
    saved.questionsMandatory,
    draft.questionsMandatory,
  );
  if (draft.action !== saved.flagPolicy.action) {
    lines.push(
      `When a flag is raised: ${saved.flagPolicy.action === "pause" ? "Pause the exam" : "Record only"} to ${draft.action === "pause" ? "Pause the exam" : "Record only"}`,
    );
  }
  if (Number(draft.pauseAfterFlags) !== saved.flagPolicy.pauseAfterFlags) {
    lines.push(
      `Pause after: ${saved.flagPolicy.pauseAfterFlags} flags to ${draft.pauseAfterFlags} flags`,
    );
  }
  if (
    draft.countMedium !== saved.flagPolicy.countSeverities.includes("medium")
  ) {
    lines.push(
      `Flags that count: ${draft.countMedium ? "medium and high" : "high only"}`,
    );
  }
  flip(
    "Give back the paused time when unlocked",
    saved.flagPolicy.extendOnUnlock,
    draft.extendOnUnlock,
  );
  if (Number(draft.intervalSeconds) !== saved.imageCapture.intervalSeconds) {
    lines.push(
      `Camera image every: ${saved.imageCapture.intervalSeconds} seconds to ${draft.intervalSeconds} seconds`,
    );
  }
  flip(
    "Camera images at start and end",
    saved.imageCapture.atStartAndEnd,
    draft.atStartAndEnd,
  );
  flip(
    "Candidate pop-up",
    saved.candidateInfoPopup.enabled,
    draft.popupEnabled,
  );
  const fieldsNow = INFO_FIELDS.filter((f) => draft.popupFields.includes(f));
  if (fieldsNow.join() !== saved.candidateInfoPopup.fields.join()) {
    lines.push(
      `Pop-up fields: ${fieldsNow.length > 0 ? fieldsNow.map((f) => INFO_FIELD_LABELS[f]).join(", ") : "none"}`,
    );
  }
  flip("Capture location", saved.captureLocation, draft.captureLocation);
  flip("Use papers without reviewer approval", saved.skipPaperApproval, draft.skipPaperApproval);
  flip("Detect looking away", saved.detectLookingAway, draft.detectLookingAway);
  flip("Detect voice", saved.detectVoice, draft.detectVoice);
  flip("Require screen sharing", saved.requireScreenShare, draft.requireScreenShare);
  const viewers = LOCATION_ROLES.filter((r) => draft.locationVisibleTo.includes(r));
  if (viewers.join() !== saved.locationVisibleTo.join()) {
    lines.push(
      `Who can see the location: AA admin${viewers.map((r) => `, ${LOCATION_ROLE_LABELS[r]}`).join("")}`,
    );
  }
  return lines;
}
