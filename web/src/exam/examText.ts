import { ApiError, errorMessage } from "../api/client";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ne: "Nepali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ur: "Urdu",
};

export function languageName(value: string | null): string {
  if (!value) return "Not recorded";
  return LANGUAGE_NAMES[value.trim().toLowerCase()] ?? value;
}

/** Plain words for the reasons GET /attempts/available and POST /attempts/start share. */
export function reasonText(code: string): string {
  switch (code) {
    case "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW":
      return "today is outside the assessment dates of your batch.";
    case "ATTEMPT_LANGUAGE_MISMATCH":
      return "this paper is not in the language of your batch. Tell your assessor or proctor.";
    case "ATTEMPT_CANDIDATE_ABSENT":
      return "you are marked absent for this batch. Speak to your assessor.";
    case "ATTEMPT_PAPER_UNAVAILABLE":
      return "this paper cannot be shown. Tell your assessor or proctor.";
    case "ATTEMPT_BATCH_NOT_IN_PROGRESS":
      return "this batch is not open for exams right now.";
    case "ATTEMPT_CLOSED":
      return "this exam is already closed.";
    case "ATTEMPT_TIME_UP":
      return "the time for this exam is over.";
    default:
      return "it cannot be started right now. Ask your assessor or proctor.";
  }
}

export function startErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "This paper was not found for your batch. Tell your assessor or proctor.";
    }
    if (error.code.startsWith("ATTEMPT_")) return `This exam cannot start: ${reasonText(error.code)}`;
    if (error.status === 403) return "You are not on the list of candidates for this batch.";
  }
  return errorMessage(error);
}

/** "2026-10-15" as "15 Oct 2026". Calendar days only, so no time zone shifts them. */
export function dateText(value: string | null): string {
  if (!value) return "Not recorded";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "about 12 minutes left" from a number of seconds. */
export function timeLeftText(seconds: number): string {
  if (seconds <= 0) return "No time left";
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
}
