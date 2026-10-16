import { ApiError, apiRequest } from "./client";
import {
  QUESTION_TYPES,
  type QuestionOption,
  type QuestionType,
} from "./questionBank";

/**
 * Test papers (E-01, B-18a, X-10) and the batch paper (D5). Paths and errors follow
 * API_CONTRACT.md "Test generator" and "PUT /batches/:id/test-paper". D4: aa_admin and sme
 * build and submit drafts, ab_reviewer approves or sends back with a reason.
 */

export const PAPER_STATUSES = ["draft", "submitted", "approved"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

export const PAPER_STATUS_LABELS: Record<PaperStatus, string> = {
  draft: "Draft",
  submitted: "Submitted for approval",
  approved: "Approved",
};

export const PAPER_ITEM_PAGE_SIZE = 50;

export type Quota = { nosId: string; type: QuestionType | null; count: number };
export type Shortage = {
  nosId: string;
  type: string | null;
  requested: number;
  available: number;
};

export type TestPaper = {
  id: string;
  name: string | null;
  qualificationId: string;
  status: PaperStatus;
  seed: number;
  language: string;
  quotas: Quota[];
  totalMarks: number;
  complete: boolean;
  shortages: Shortage[];
  durationMinutes: number | null;
  returnReason: string | null;
  weightProfile: { profileId: string; version: number } | null;
  itemCount: number | null;
};

export type PaperItem = {
  questionId: string;
  version: number;
  nosId: string;
  pcId: string;
  type: QuestionType;
  marks: number;
  stem?: string | null;
  options?: QuestionOption[];
  correctAnswer?: string | null;
};

export type PaperQuestionsPage = {
  items: PaperItem[];
  itemPage: number;
  itemPageSize: number;
  itemTotal: number;
};

export type PaperPage = {
  items: TestPaper[];
  total: number;
  page: number;
  pageSize: number;
};

export type GenerateInput = {
  qualificationId: string;
  language: string;
  name?: string;
  quotas: Array<{ nosId: string; type?: QuestionType; count: number }>;
  totalMarks?: number;
  durationMinutes?: number;
  seed?: number;
  allowPartial?: boolean;
  weightProfileId?: string;
};

export type WeightProfileChoice = { id: string; name: string; version: number };

function responseError(): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    "Test paper response was not recognised.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idOf(value: Record<string, unknown>): string {
  const id = typeof value._id === "string" ? value._id : value.id;
  if (typeof id !== "string" || !id) throw responseError();
  return id;
}

function questionType(value: unknown): QuestionType {
  if (
    typeof value === "string" &&
    (QUESTION_TYPES as readonly string[]).includes(value)
  )
    return value as QuestionType;
  throw responseError();
}

export function parsePaper(value: unknown): TestPaper {
  if (!isRecord(value) || !isRecord(value.rules)) throw responseError();
  const status = value.status;
  if (
    typeof status !== "string" ||
    !(PAPER_STATUSES as readonly string[]).includes(status)
  )
    throw responseError();
  if (
    typeof value.qualificationId !== "string" ||
    typeof value.seed !== "number" ||
    typeof value.totalMarks !== "number" ||
    typeof value.rules.language !== "string"
  ) {
    throw responseError();
  }
  const quotas = Array.isArray(value.rules.quotas)
    ? value.rules.quotas.flatMap((item): Quota[] =>
        isRecord(item) &&
        typeof item.nosId === "string" &&
        typeof item.count === "number"
          ? [
              {
                nosId: item.nosId,
                type:
                  typeof item.type === "string"
                    ? questionType(item.type)
                    : null,
                count: item.count,
              },
            ]
          : [],
      )
    : [];
  const shortages = Array.isArray(value.shortages)
    ? value.shortages.flatMap((item): Shortage[] =>
        isRecord(item) &&
        typeof item.nosId === "string" &&
        typeof item.requested === "number"
          ? [
              {
                nosId: item.nosId,
                type: typeof item.type === "string" ? item.type : null,
                requested: item.requested,
                available:
                  typeof item.available === "number" ? item.available : 0,
              },
            ]
          : [],
      )
    : [];
  const profile = value.weightProfile;
  return {
    id: idOf(value),
    name: typeof value.name === "string" && value.name ? value.name : null,
    qualificationId: value.qualificationId,
    status: status as PaperStatus,
    seed: value.seed,
    language: value.rules.language,
    quotas,
    totalMarks: value.totalMarks,
    complete: value.complete !== false,
    shortages,
    durationMinutes:
      typeof value.durationMinutes === "number" ? value.durationMinutes : null,
    returnReason:
      typeof value.returnReason === "string" && value.returnReason
        ? value.returnReason
        : null,
    weightProfile:
      isRecord(profile) &&
      profile.profileId != null &&
      typeof profile.version === "number"
        ? { profileId: String(profile.profileId), version: profile.version }
        : null,
    itemCount: Array.isArray(value.items) ? value.items.length : null,
  };
}

/** The name candidates and reviewers see; older papers have none (B-18a). */
export function paperTitle(
  paper: Pick<TestPaper, "name" | "language">,
  qualificationName?: string,
): string {
  if (paper.name) return paper.name;
  return `${qualificationName ?? "Test paper"} (${paper.language})`;
}

export function shortageText(shortage: Shortage): string {
  const kind = shortage.type ? ` ${shortage.type}` : "";
  return `${shortage.nosId}${kind}: needs ${shortage.requested}, the bank has ${shortage.available}`;
}

function parseItem(value: unknown): PaperItem {
  if (
    !isRecord(value) ||
    typeof value.nosId !== "string" ||
    typeof value.pcId !== "string"
  )
    throw responseError();
  const questionId = String(value.questionId ?? "");
  if (
    !questionId ||
    typeof value.version !== "number" ||
    typeof value.marks !== "number"
  )
    throw responseError();
  const item: PaperItem = {
    questionId,
    version: value.version,
    nosId: value.nosId,
    pcId: value.pcId,
    type: questionType(value.type),
    marks: value.marks,
  };
  if ("stem" in value) {
    item.stem = typeof value.stem === "string" ? value.stem : null;
    item.options = Array.isArray(value.options)
      ? value.options.flatMap((o): QuestionOption[] =>
          isRecord(o) && typeof o.key === "string" && typeof o.text === "string"
            ? [{ key: o.key, text: o.text }]
            : [],
        )
      : [];
    item.correctAnswer =
      typeof value.correctAnswer === "string" ? value.correctAnswer : null;
  }
  return item;
}

export async function listPapers(
  query: {
    qualificationId?: string;
    status?: string;
    page: number;
    pageSize?: number;
  },
  signal?: AbortSignal,
): Promise<PaperPage> {
  const params = new URLSearchParams();
  if (query.qualificationId)
    params.set("qualificationId", query.qualificationId);
  if (query.status) params.set("status", query.status);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize ?? 20));
  const body = await apiRequest<unknown>(`/tests?${params.toString()}`, {
    signal,
  });
  if (!isRecord(body) || !Array.isArray(body.items)) throw responseError();
  const { total, page, pageSize } = body;
  if (
    typeof total !== "number" ||
    typeof page !== "number" ||
    typeof pageSize !== "number"
  )
    throw responseError();
  return { items: body.items.map(parsePaper), total, page, pageSize };
}

/** Ids and counts only; no question text. */
export async function getPaper(
  id: string,
  signal?: AbortSignal,
): Promise<TestPaper> {
  return parsePaper(await apiRequest<unknown>(`/tests/${id}`, { signal }));
}

/** Question text and answers, 50 a page, counted against the daily content-read cap. */
export async function getPaperQuestions(
  id: string,
  itemPage: number,
  signal?: AbortSignal,
): Promise<PaperQuestionsPage> {
  const body = await apiRequest<unknown>(
    `/tests/${id}?withQuestions=true&itemPage=${itemPage}`,
    { signal },
  );
  if (!isRecord(body) || !Array.isArray(body.items)) throw responseError();
  const itemTotal =
    typeof body.itemTotal === "number" ? body.itemTotal : body.items.length;
  return {
    items: body.items.map(parseItem),
    itemPage: typeof body.itemPage === "number" ? body.itemPage : itemPage,
    itemPageSize:
      typeof body.itemPageSize === "number"
        ? body.itemPageSize
        : PAPER_ITEM_PAGE_SIZE,
    itemTotal,
  };
}

export async function generatePaper(input: GenerateInput): Promise<TestPaper> {
  return parsePaper(
    await apiRequest<unknown>("/tests/generate", {
      method: "POST",
      body: input,
    }),
  );
}

export async function submitPaper(id: string): Promise<TestPaper> {
  return parsePaper(
    await apiRequest<unknown>(`/tests/${id}/submit`, { method: "POST" }),
  );
}

export async function approvePaper(id: string): Promise<TestPaper> {
  return parsePaper(
    await apiRequest<unknown>(`/tests/${id}/approve`, { method: "POST" }),
  );
}

export async function returnPaper(
  id: string,
  reason: string,
): Promise<TestPaper> {
  return parsePaper(
    await apiRequest<unknown>(`/tests/${id}/return`, {
      method: "POST",
      body: { reason },
    }),
  );
}

export async function listApprovedWeightProfiles(
  qualificationId: string,
  signal?: AbortSignal,
): Promise<WeightProfileChoice[]> {
  const params = new URLSearchParams({
    qualificationId,
    status: "approved",
    pageSize: "100",
  });
  const body = await apiRequest<unknown>(
    `/weight-profiles?${params.toString()}`,
    { signal },
  );
  if (!isRecord(body) || !Array.isArray(body.items)) throw responseError();
  return body.items.flatMap((item): WeightProfileChoice[] => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      typeof item.version !== "number"
    )
      return [];
    const id = item.rootProfileId ?? item._id ?? item.id;
    return typeof id === "string"
      ? [{ id, name: item.name, version: item.version }]
      : [];
  });
}

/** D5: PUT /batches/:id/test-paper. Returns nothing the page keeps; it re-reads the batch. */
export async function setBatchTestPaper(
  batchId: string,
  testPaperId: string,
): Promise<void> {
  await apiRequest<unknown>(`/batches/${batchId}/test-paper`, {
    method: "PUT",
    body: { testPaperId },
  });
}
