import { ApiError, apiRequest } from "./client";

/**
 * X-09. The staff view of one attempt: the questions, what the candidate answered, the marks
 * and the time spent. Read-only. The key (correctAnswer) arrives only once the attempt is closed.
 */
export type SheetQuestion = {
  questionId: string;
  order: number;
  type: string;
  nosId: string;
  marks: number;
  stem: string;
  options: { key: string; text: string }[];
  answer: string | null;
  correctAnswer: string | null;
  awardedMarks: number | null;
  scoreStatus: string;
  answeredAt: string | null;
  secondsSpent: number | null;
};

export type AnswerSheet = {
  id: string;
  batchId: string;
  status: string;
  candidateName: string | null;
  startedAt: string | null;
  closedAt: string | null;
  obtainedMarks: number | null;
  maxMarks: number | null;
  scoringComplete: boolean | null;
  questions: SheetQuestion[];
  itemPage: number;
  itemPageSize: number;
  itemTotal: number;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function bad(): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    "The server sent an answer sheet this page cannot read.",
  );
}

function parseQuestion(value: unknown, index: number): SheetQuestion {
  if (!isRecord(value)) throw bad();
  const questionId = str(value.questionId);
  if (!questionId) throw bad();
  return {
    questionId,
    order: num(value.order) ?? index + 1,
    type: str(value.type) ?? "",
    nosId: str(value.nosId) ?? "",
    marks: num(value.marks) ?? 0,
    stem: typeof value.stem === "string" ? value.stem : "",
    options: Array.isArray(value.options)
      ? value.options.flatMap((o) =>
          isRecord(o) && str(o.key)
            ? [
                {
                  key: String(o.key),
                  text: typeof o.text === "string" ? o.text : "",
                },
              ]
            : [],
        )
      : [],
    answer: typeof value.answer === "string" ? value.answer : null,
    correctAnswer:
      typeof value.correctAnswer === "string" ? value.correctAnswer : null,
    awardedMarks: num(value.awardedMarks),
    scoreStatus: str(value.scoreStatus) ?? "pending",
    answeredAt: str(value.answeredAt),
    secondsSpent: num(value.secondsSpent),
  };
}

export async function getAnswerSheet(
  id: string,
  itemPage: number,
  signal?: AbortSignal,
): Promise<AnswerSheet> {
  const body = await apiRequest<unknown>(
    `/attempts/${encodeURIComponent(id)}?itemPage=${itemPage}`,
    { signal },
  );
  if (!isRecord(body) || !Array.isArray(body.questions)) throw bad();
  const scores = isRecord(body.scores) ? body.scores : null;
  return {
    id: str(body.id) ?? id,
    batchId: str(body.batchId) ?? "",
    status: str(body.status) ?? "",
    candidateName: str(body.candidateName),
    startedAt: str(body.startedAt),
    closedAt: str(body.closedAt),
    obtainedMarks: scores ? num(scores.obtainedMarks) : null,
    maxMarks: scores ? num(scores.maxMarks) : null,
    scoringComplete: scores ? scores.complete === true : null,
    questions: body.questions.map(parseQuestion),
    itemPage: num(body.itemPage) ?? itemPage,
    itemPageSize: num(body.itemPageSize) ?? body.questions.length,
    itemTotal: num(body.itemTotal) ?? body.questions.length,
  };
}

/** Whole seconds as "2 min 05 s". */
export function spentText(seconds: number | null): string {
  if (seconds === null) return "Not answered";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

export async function downloadMarksExcel(batchId: string): Promise<Blob> {
  const response = await apiRequest<Response>(
    `/reports/batches/${encodeURIComponent(batchId)}/marks.xlsx`,
    {
      raw: true,
    },
  );
  return response.blob();
}

export type AttemptRow = {
  id: string;
  candidateName: string | null;
  status: string;
  startedAt: string | null;
  closedAt: string | null;
  obtainedMarks: number | null;
  maxMarks: number | null;
  scoringComplete: boolean | null;
};

/** The attempts of one batch, for the answer sheet list. Staff roles only. */
export async function listBatchAttempts(
  batchId: string,
  signal?: AbortSignal,
): Promise<AttemptRow[]> {
  const body = await apiRequest<unknown>(
    `/attempts?batchId=${encodeURIComponent(batchId)}&pageSize=100`,
    {
      signal,
    },
  );
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad();
  return body.items.flatMap((item): AttemptRow[] => {
    if (!isRecord(item)) return [];
    const id = str(item.id);
    if (!id) return [];
    return [
      {
        id,
        candidateName: str(item.candidateName),
        status: str(item.status) ?? "",
        startedAt: str(item.startedAt),
        closedAt: str(item.closedAt),
        obtainedMarks: num(item.obtainedMarks),
        maxMarks: num(item.maxMarks),
        scoringComplete:
          typeof item.scoringComplete === "boolean"
            ? item.scoringComplete
            : null,
      },
    ];
  });
}
