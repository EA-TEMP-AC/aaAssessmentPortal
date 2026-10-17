import {
  INFO_FIELD_LABELS,
  INFO_FIELDS,
  INTERVAL_MAX_SECONDS,
  INTERVAL_MIN_SECONDS,
  LOCATION_ROLES,
  LOCATION_ROLE_LABELS,
  PASS_PERCENTAGE_MAX,
  PASS_PERCENTAGE_MIN,
  PAUSE_AFTER_MAX,
  PAUSE_AFTER_MIN,
  type BatchSettings,
  type BatchSettingsPatch,
  type InfoField,
  type LocationRole,
  type MarkingType,
  type PassCriteria,
  type ProctoringType,
  type UfmEvidence,
  type VideoFailureAction,
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
  recordVideo: boolean;
  videoFailureAction: VideoFailureAction;
  videoVisibleTo: LocationRole[];
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
  proctoringType: ProctoringType;
  aiEnabled: boolean;
  ufmEvidence: UfmEvidence;
  downloadSessionVideo: boolean;
  downloadFlagVideo: boolean;
  allowPracticalVideo: boolean;
  allowVivaVideo: boolean;
  assessorGeolocation: boolean;
  assessorAnnexureM: boolean;
  assessorFeedback: boolean;
  assessorIdCardCheck: boolean;
  assessorIdNameCheck: boolean;
  studentAttendance: boolean;
  studentFeedback: boolean;
  langTheory: boolean;
  langPractical: boolean;
  langViva: boolean;
  allowOjtImages: boolean;
  pauseAfterUnlock: string;
  imageEnabled: boolean;
  passCriteria: PassCriteria;
  passPercentage: string;
  practicalMarking: MarkingType;
  vivaMarking: MarkingType;
};

export type Problems = Partial<
  Record<
    | "pauseAfterFlags"
    | "pauseAfterUnlock"
    | "passPercentage"
    | "intervalSeconds"
    | "popupFields"
    | "recordVideo"
    | "videoOptions",
    string
  >
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
    recordVideo: s.recordVideo,
    videoFailureAction: s.videoFailureAction,
    videoVisibleTo: [...s.videoVisibleTo],
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
    proctoringType: s.proctoringType,
    aiEnabled: s.aiEnabled,
    ufmEvidence: s.ufmEvidence,
    downloadSessionVideo: s.downloadSessionVideo,
    downloadFlagVideo: s.downloadFlagVideo,
    allowPracticalVideo: s.allowPracticalVideo,
    allowVivaVideo: s.allowVivaVideo,
    assessorGeolocation: s.assessorGeolocation,
    assessorAnnexureM: s.assessorAnnexureM,
    assessorFeedback: s.assessorFeedback,
    assessorIdCardCheck: s.assessorIdCardCheck,
    assessorIdNameCheck: s.assessorIdNameCheck,
    studentAttendance: s.studentAttendance,
    studentFeedback: s.studentFeedback,
    langTheory: s.languages.theory,
    langPractical: s.languages.practical,
    langViva: s.languages.viva,
    allowOjtImages: s.allowOjtImages,
    pauseAfterUnlock: String(s.flagPolicy.pauseAfterUnlock),
    imageEnabled: s.imageCapture.enabled,
    passCriteria: s.passCriteria,
    passPercentage: String(s.passPercentage),
    practicalMarking: s.practicalMarking,
    vivaMarking: s.vivaMarking,
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
  const unlock = wholeNumber(draft.pauseAfterUnlock);
  if (unlock === null || unlock < PAUSE_AFTER_MIN || unlock > PAUSE_AFTER_MAX) {
    problems.pauseAfterUnlock = `Enter a whole number from ${PAUSE_AFTER_MIN} to ${PAUSE_AFTER_MAX}.`;
  }
  if (draft.passCriteria !== "qualification") {
    const pass = wholeNumber(draft.passPercentage);
    if (
      pass === null ||
      pass < PASS_PERCENTAGE_MIN ||
      pass > PASS_PERCENTAGE_MAX
    ) {
      problems.passPercentage = `Enter a whole number from ${PASS_PERCENTAGE_MIN} to ${PASS_PERCENTAGE_MAX}.`;
    }
  }
  if (draft.recordVideo && !draft.requireScreenShare) {
    problems.recordVideo = "Turn on screen sharing to record the exam video.";
  }
  if (
    !draft.recordVideo &&
    (draft.ufmEvidence === "video" ||
      draft.downloadSessionVideo ||
      draft.downloadFlagVideo)
  ) {
    problems.videoOptions =
      "Video evidence and video downloads need the exam video. Turn on Record exam video, or switch them off.";
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
    "recordVideo",
    "aiEnabled",
    "downloadSessionVideo",
    "downloadFlagVideo",
    "allowPracticalVideo",
    "allowVivaVideo",
    "assessorGeolocation",
    "assessorAnnexureM",
    "assessorFeedback",
    "assessorIdCardCheck",
    "assessorIdNameCheck",
    "studentAttendance",
    "studentFeedback",
    "allowOjtImages",
  ] as const) {
    if (draft[key] !== saved[key]) patch[key] = draft[key];
  }
  if (draft.passCriteria !== saved.passCriteria)
    patch.passCriteria = draft.passCriteria;
  const passNumber = Number(draft.passPercentage);
  if (
    draft.passCriteria !== "qualification" &&
    passNumber !== saved.passPercentage
  ) {
    patch.passPercentage = passNumber;
  }
  if (draft.practicalMarking !== saved.practicalMarking)
    patch.practicalMarking = draft.practicalMarking;
  if (draft.vivaMarking !== saved.vivaMarking)
    patch.vivaMarking = draft.vivaMarking;
  if (draft.proctoringType !== saved.proctoringType)
    patch.proctoringType = draft.proctoringType;
  if (draft.ufmEvidence !== saved.ufmEvidence)
    patch.ufmEvidence = draft.ufmEvidence;
  const languages: NonNullable<BatchSettingsPatch["languages"]> = {};
  if (draft.langTheory !== saved.languages.theory)
    languages.theory = draft.langTheory;
  if (draft.langPractical !== saved.languages.practical)
    languages.practical = draft.langPractical;
  if (draft.langViva !== saved.languages.viva) languages.viva = draft.langViva;
  if (Object.keys(languages).length > 0) patch.languages = languages;
  const viewers = LOCATION_ROLES.filter((r) =>
    draft.locationVisibleTo.includes(r),
  );
  if (viewers.join() !== saved.locationVisibleTo.join())
    patch.locationVisibleTo = viewers;
  if (draft.videoFailureAction !== saved.videoFailureAction)
    patch.videoFailureAction = draft.videoFailureAction;
  const watchers = LOCATION_ROLES.filter((r) =>
    draft.videoVisibleTo.includes(r),
  );
  if (watchers.join() !== saved.videoVisibleTo.join())
    patch.videoVisibleTo = watchers;
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
  const afterUnlock = Number(draft.pauseAfterUnlock);
  if (afterUnlock !== saved.flagPolicy.pauseAfterUnlock)
    policy.pauseAfterUnlock = afterUnlock;
  if (Object.keys(policy).length > 0) patch.flagPolicy = policy;

  const image: NonNullable<BatchSettingsPatch["imageCapture"]> = {};
  const interval = Number(draft.intervalSeconds);
  if (interval !== saved.imageCapture.intervalSeconds)
    image.intervalSeconds = interval;
  if (draft.atStartAndEnd !== saved.imageCapture.atStartAndEnd)
    image.atStartAndEnd = draft.atStartAndEnd;
  if (draft.imageEnabled !== saved.imageCapture.enabled)
    image.enabled = draft.imageEnabled;
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
  flip(
    "Use papers without reviewer approval",
    saved.skipPaperApproval,
    draft.skipPaperApproval,
  );
  flip("Detect looking away", saved.detectLookingAway, draft.detectLookingAway);
  flip("Detect voice", saved.detectVoice, draft.detectVoice);
  flip(
    "Require screen sharing",
    saved.requireScreenShare,
    draft.requireScreenShare,
  );
  flip("Record exam video", saved.recordVideo, draft.recordVideo);
  if (draft.videoFailureAction !== saved.videoFailureAction) {
    lines.push(
      `If recording fails: ${draft.videoFailureAction === "require" ? "the candidate cannot start" : "the exam continues and a flag is raised"}`,
    );
  }
  const watchers = LOCATION_ROLES.filter((r) =>
    draft.videoVisibleTo.includes(r),
  );
  if (watchers.join() !== saved.videoVisibleTo.join()) {
    lines.push(
      `Who can watch the video: AA admin${watchers.map((r) => `, ${LOCATION_ROLE_LABELS[r]}`).join("")}`,
    );
  }
  if (draft.passCriteria !== saved.passCriteria) {
    const names = {
      qualification: "The qualification's own rule",
      nos_wise: "NOS wise",
      overall: "Overall",
    };
    lines.push(
      `Pass rule: ${names[saved.passCriteria]} to ${names[draft.passCriteria]}`,
    );
  }
  if (
    draft.passCriteria !== "qualification" &&
    Number(draft.passPercentage) !== saved.passPercentage
  ) {
    lines.push(
      `Pass percentage: ${saved.passPercentage} to ${draft.passPercentage}`,
    );
  }
  for (const [label, from, to] of [
    ["Practical marking", saved.practicalMarking, draft.practicalMarking],
    ["Viva marking", saved.vivaMarking, draft.vivaMarking],
  ] as const) {
    if (from !== to)
      lines.push(
        `${label}: ${from === "rubric" ? "Three levels" : "Marks"} to ${to === "rubric" ? "Three levels" : "Marks"}`,
      );
  }
  flip("Proctoring by AI", saved.aiEnabled, draft.aiEnabled);
  if (draft.proctoringType !== saved.proctoringType) {
    lines.push(
      `Proctoring type: ${draft.proctoringType === "manual" ? "Manual (a person watches, no automatic flags)" : "Automatic"}`,
    );
  }
  if (draft.ufmEvidence !== saved.ufmEvidence) {
    lines.push(
      `Evidence kept with a flag: ${draft.ufmEvidence === "video" ? "Video" : "Image"}`,
    );
  }
  flip(
    "Download of the session video",
    saved.downloadSessionVideo,
    draft.downloadSessionVideo,
  );
  flip(
    "Download of the flag video",
    saved.downloadFlagVideo,
    draft.downloadFlagVideo,
  );
  if (Number(draft.pauseAfterUnlock) !== saved.flagPolicy.pauseAfterUnlock) {
    lines.push(
      `Flags allowed after an unlock: ${saved.flagPolicy.pauseAfterUnlock} to ${draft.pauseAfterUnlock}`,
    );
  }
  flip(
    "Pictures during the exam",
    saved.imageCapture.enabled,
    draft.imageEnabled,
  );
  flip("Practical video", saved.allowPracticalVideo, draft.allowPracticalVideo);
  flip("Viva video", saved.allowVivaVideo, draft.allowVivaVideo);
  flip(
    "Assessor geolocation",
    saved.assessorGeolocation,
    draft.assessorGeolocation,
  );
  flip("Assessor Annexure M", saved.assessorAnnexureM, draft.assessorAnnexureM);
  flip("Assessor feedback", saved.assessorFeedback, draft.assessorFeedback);
  flip(
    "Assessor identity card check",
    saved.assessorIdCardCheck,
    draft.assessorIdCardCheck,
  );
  flip(
    "Assessor name check",
    saved.assessorIdNameCheck,
    draft.assessorIdNameCheck,
  );
  flip("Student attendance", saved.studentAttendance, draft.studentAttendance);
  flip("Student feedback", saved.studentFeedback, draft.studentFeedback);
  flip(
    "Theory test in more than one language",
    saved.languages.theory,
    draft.langTheory,
  );
  flip(
    "Practical test in more than one language",
    saved.languages.practical,
    draft.langPractical,
  );
  flip(
    "Viva test in more than one language",
    saved.languages.viva,
    draft.langViva,
  );
  flip("OJT pictures", saved.allowOjtImages, draft.allowOjtImages);
  const viewers = LOCATION_ROLES.filter((r) =>
    draft.locationVisibleTo.includes(r),
  );
  if (viewers.join() !== saved.locationVisibleTo.join()) {
    lines.push(
      `Who can see the location: AA admin${viewers.map((r) => `, ${LOCATION_ROLE_LABELS[r]}`).join("")}`,
    );
  }
  return lines;
}
