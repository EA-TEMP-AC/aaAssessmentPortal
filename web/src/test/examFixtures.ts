import { vi } from "vitest";
import { parseAttempt, type Attempt } from "../api/attempts";

export const PAPER_ID = "6700000000000000000000aa";
export const BATCH_ID = "6700000000000000000000bb";
export const ATTEMPT_ID = "6700000000000000000000cc";

export function fakeStream() {
  const track = { kind: "video", stop: vi.fn(), addEventListener: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  };
  return { stream: stream as unknown as MediaStream, track };
}

/** Bright grey pixels, or black ones. */
export function frame(luma: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(32 * 24 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = luma;
    data[i + 1] = luma;
    data[i + 2] = luma;
    data[i + 3] = 255;
  }
  return data;
}

export function attemptBody(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: ATTEMPT_ID,
    testPaperId: PAPER_ID,
    batchId: BATCH_ID,
    status: "in_progress",
    durationMinutes: 30,
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + 30 * 60 * 1000).toISOString(),
    closedAt: null,
    closeReason: null,
    serverTime: new Date(now).toISOString(),
    remainingSeconds: 1800,
    totalMarks: 4,
    questions: [
      {
        questionId: "q1",
        order: 1,
        type: "mcq",
        marks: 1,
        stem: "Which tool cuts wire?",
        options: [
          { key: "A", text: "Pliers" },
          { key: "B", text: "Hammer" },
        ],
        answer: null,
      },
      {
        questionId: "q2",
        order: 2,
        type: "short_answer",
        marks: 3,
        stem: "Describe earthing.",
        options: [],
        answer: "Saved before",
      },
    ],
    ...overrides,
  };
}

export function attempt(overrides: Record<string, unknown> = {}): Attempt {
  return parseAttempt(attemptBody(overrides));
}

export function url(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

type Handler = (u: URL, init?: RequestInit) => Response | Promise<Response>;

export function stubFetch(handler: Handler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(url(input), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function callsTo(mock: ReturnType<typeof stubFetch>, suffix: string, method = "GET") {
  return mock.mock.calls.filter(
    (call) => url(call[0]).pathname.endsWith(suffix) && (call[1]?.method ?? "GET") === method,
  );
}

export function bodyOf(call: unknown[]): unknown {
  const init = call[1] as RequestInit | undefined;
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}
