import { ApiError, apiRequest } from "./client";

/**
 * Candidate side of the attempt engine (API_CONTRACT "Attempt engine (task E-03)").
 * The candidate view never carries marks, keys or scores, and this module never
 * asks for them.
 */

export type AttemptStatus = "in_progress" | "submitted" | "timed_out";

export type AttemptOption = { key: string; text: string };

export type AttemptQuestion = {
  questionId: string;
  order: number;
  type: string;
  stem: string;
  options: AttemptOption[];
  /** X-25: pictures under the question text, each with a description. */
  images?: { id: string; alt: string }[];
  answer: string | null;
};

/** B-20: what the exam page needs from the batch settings. */
export type AttemptSettings = {
  questionsMandatory: boolean;
  showMarksToCandidate: boolean;
  flagPolicy: { action: "record" | "pause"; extendOnUnlock: boolean };
  imageCapture: { intervalSeconds: number; atStartAndEnd: boolean };
  candidateInfoPopup: { enabled: boolean; fields: string[] };
  captureLocation: boolean;
};

export type AttemptMarks = {
  obtainedMarks: number;
  maxMarks: number;
  complete: boolean;
};

export const DEFAULT_ATTEMPT_SETTINGS: AttemptSettings = {
  questionsMandatory: false,
  showMarksToCandidate: false,
  flagPolicy: { action: "record", extendOnUnlock: false },
  imageCapture: { intervalSeconds: 30, atStartAndEnd: true },
  candidateInfoPopup: { enabled: false, fields: [] },
  captureLocation: false,
};

export type Attempt = {
  id: string;
  testPaperId: string;
  batchId: string;
  status: AttemptStatus;
  durationMinutes: number | null;
  startedAt: string | null;
  deadlineAt: string;
  closedAt: string | null;
  closeReason: string | null;
  serverTime: string | null;
  remainingSeconds: number | null;
  questions: AttemptQuestion[];
  /** B-20: the flag policy has paused this attempt. Answers and submit are refused until an unlock. */
  paused: boolean;
  /** B-20: true when options were shuffled, so the page labels them A, B, C by position. */
  shuffleOptions: boolean;
  settings: AttemptSettings;
  /** B-20: totals, only when the batch shows marks and the attempt is closed. */
  marks: AttemptMarks | null;
};

export type SaveAnswersResult = {
  saved: number;
  savedAt: string | null;
  deadlineAt: string | null;
  remainingSeconds: number | null;
};

export type ClosedAttempt = {
  id: string;
  status: AttemptStatus;
  closeReason: string | null;
  closedAt: string | null;
  deadlineAt: string | null;
  marks: AttemptMarks | null;
};

const STATUSES: readonly string[] = ["in_progress", "submitted", "timed_out"];

function bad(what: string): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    `${what} response was not recognised.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function status(value: unknown): AttemptStatus | null {
  return typeof value === "string" && STATUSES.includes(value)
    ? (value as AttemptStatus)
    : null;
}

/** Only the fields the candidate needs. Anything else the server sends is dropped. */
function parseQuestion(value: unknown, index: number): AttemptQuestion {
  if (!isRecord(value)) throw bad("Attempt");
  const questionId = str(value.questionId);
  const type = str(value.type);
  if (!questionId || !type) throw bad("Attempt");
  const options = Array.isArray(value.options)
    ? value.options.flatMap((option) => {
        if (!isRecord(option)) return [];
        const key = str(option.key);
        if (!key) return [];
        return [
          { key, text: typeof option.text === "string" ? option.text : "" },
        ];
      })
    : [];
  return {
    questionId,
    order: num(value.order) ?? index + 1,
    type,
    stem: typeof value.stem === "string" ? value.stem : "",
    options,
    images: Array.isArray(value.images)
      ? value.images.flatMap((image) => {
          if (!isRecord(image)) return [];
          const id = str(image.id);
          return id ? [{ id, alt: typeof image.alt === "string" ? image.alt : "" }] : [];
        })
      : [],
    answer: typeof value.answer === "string" ? value.answer : null,
  };
}

function parseMarks(value: unknown): AttemptMarks | null {
  if (!isRecord(value)) return null;
  const obtainedMarks = num(value.obtainedMarks);
  const maxMarks = num(value.maxMarks);
  if (obtainedMarks === null || maxMarks === null) return null;
  return { obtainedMarks, maxMarks, complete: value.complete === true };
}

function parseSettings(value: unknown): AttemptSettings {
  const d = DEFAULT_ATTEMPT_SETTINGS;
  if (!isRecord(value)) return { ...d };
  const image = isRecord(value.imageCapture) ? value.imageCapture : {};
  const info = isRecord(value.candidateInfoPopup)
    ? value.candidateInfoPopup
    : {};
  const policy = isRecord(value.flagPolicy) ? value.flagPolicy : {};
  return {
    questionsMandatory: value.questionsMandatory === true,
    showMarksToCandidate: value.showMarksToCandidate === true,
    flagPolicy: {
      action: policy.action === "pause" ? "pause" : "record",
      extendOnUnlock: policy.extendOnUnlock === true,
    },
    imageCapture: {
      intervalSeconds:
        num(image.intervalSeconds) ?? d.imageCapture.intervalSeconds,
      atStartAndEnd: image.atStartAndEnd !== false,
    },
    candidateInfoPopup: {
      enabled: info.enabled === true,
      fields: Array.isArray(info.fields)
        ? info.fields.filter((f): f is string => typeof f === "string")
        : [],
    },
    captureLocation: value.captureLocation === true,
  };
}

export function parseAttempt(value: unknown): Attempt {
  if (!isRecord(value)) throw bad("Attempt");
  const id = str(value.id);
  const testPaperId = str(value.testPaperId);
  const batchId = str(value.batchId);
  const attemptStatus = status(value.status);
  const deadlineAt = str(value.deadlineAt);
  if (
    !id ||
    !testPaperId ||
    !batchId ||
    !attemptStatus ||
    !deadlineAt ||
    !Array.isArray(value.questions)
  ) {
    throw bad("Attempt");
  }
  const questions = value.questions
    .map(parseQuestion)
    .sort((a, b) => a.order - b.order);
  return {
    id,
    testPaperId,
    batchId,
    status: attemptStatus,
    durationMinutes: num(value.durationMinutes),
    startedAt: str(value.startedAt),
    deadlineAt,
    closedAt: str(value.closedAt),
    closeReason: str(value.closeReason),
    serverTime: str(value.serverTime),
    remainingSeconds: num(value.remainingSeconds),
    questions,
    paused: value.paused === true,
    shuffleOptions: value.shuffleOptions === true,
    settings: parseSettings(value.settings),
    marks: parseMarks(value.marks),
  };
}

export async function startAttempt(input: {
  batchId: string;
  testPaperId: string;
}): Promise<Attempt> {
  const body = await apiRequest<unknown>("/attempts/start", {
    method: "POST",
    body: { batchId: input.batchId, testPaperId: input.testPaperId },
  });
  return parseAttempt(body);
}

export async function getAttempt(
  id: string,
  signal?: AbortSignal,
): Promise<Attempt> {
  const body = await apiRequest<unknown>(
    `/attempts/${encodeURIComponent(id)}`,
    { signal },
  );
  return parseAttempt(body);
}

export async function saveAnswers(
  id: string,
  answers: { questionId: string; answer: string | null }[],
): Promise<SaveAnswersResult> {
  const body = await apiRequest<unknown>(
    `/attempts/${encodeURIComponent(id)}/answers`,
    {
      method: "PUT",
      body: { answers },
    },
  );
  if (!isRecord(body)) throw bad("Save");
  return {
    saved: num(body.saved) ?? 0,
    savedAt: str(body.savedAt),
    deadlineAt: str(body.deadlineAt),
    remainingSeconds: num(body.remainingSeconds),
  };
}

export async function submitAttempt(id: string): Promise<ClosedAttempt> {
  const body = await apiRequest<unknown>(
    `/attempts/${encodeURIComponent(id)}/submit`,
    { method: "POST" },
  );
  if (!isRecord(body)) throw bad("Submit");
  const closedStatus = status(body.status);
  if (!closedStatus) throw bad("Submit");
  return {
    id: str(body.id) ?? id,
    status: closedStatus,
    closeReason: str(body.closeReason),
    closedAt: str(body.closedAt),
    deadlineAt: str(body.deadlineAt),
    marks: parseMarks(body.marks),
  };
}

/** Test paper ids are Mongo object ids. Checked before a start call so a typo gets a plain message. */
export function isPaperCode(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value.trim());
}
