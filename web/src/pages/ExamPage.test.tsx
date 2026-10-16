import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { createQueryClient } from "../queryClient";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";
import {
  attemptBody,
  ATTEMPT_ID,
  BATCH_ID,
  bodyOf,
  callsTo,
  fakeStream,
  frame,
  PAPER_ID,
  stubFetch,
} from "../test/examFixtures";
import { fakeFaceChecks, makeVideosReady } from "../test/faceFixtures";
import { ExamPage } from "./ExamPage";

const BATCH_NAME = "ELE/Q0001 Field Technician, 2026-10-15 to 2026-10-17";

function available(overrides: Record<string, unknown> = {}) {
  return {
    batchId: BATCH_ID,
    batchName: BATCH_NAME,
    paperId: PAPER_ID,
    paperCode: "0000AA",
    paperName: "Paper 0000AA",
    language: "en",
    questionCount: 2,
    durationMinutes: 30,
    attempt: null,
    startable: { ok: true },
    ...overrides,
  };
}

function list(items: unknown[]) {
  return { items };
}

const openAttempt = (id: string, status: string) => ({ id, status, startedAt: "t", deadline: "t" });

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  makeVideosReady();
});

function renderPage() {
  setSession(sessionFor("candidate"));
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ExamPage
          frameCheck={{ sample: () => frame(150), attempts: 2, intervalMs: 1 }}
          faceChecks={fakeFaceChecks()}
          autosaveDebounceMs={20}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function passPrecheck(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("Camera check passed.");
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  await screen.findByText(/look alike/);
  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  await user.click(screen.getByRole("button", { name: "Start exam" }));
}

it("lists the available assessments grouped by batch", async () => {
  const mock = stubFetch(() =>
    jsonResponse(
      200,
      list([
        available(),
        available({ paperId: "6700000000000000000000ab", paperName: "Paper 0000AB", durationMinutes: 45 }),
        available({
          batchId: "6700000000000000000000bc",
          batchName: "Second batch",
          paperId: "6700000000000000000000ac",
          paperName: "Paper 0000AC",
        }),
      ]),
    ),
  );
  setSession(sessionFor("candidate"));
  renderApp("/exam");
  const first = await screen.findByRole("heading", { name: BATCH_NAME, level: 2 });
  const group = within(first.closest("li") as HTMLElement);
  expect(group.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Paper 0000AA",
    "Paper 0000AB",
  ]);
  expect(group.getAllByText("English")).toHaveLength(2);
  expect(group.getByText("45 minutes")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Second batch", level: 2 })).toBeInTheDocument();
  expect(screen.queryByLabelText("Paper code")).not.toBeInTheDocument();
  expect(callsTo(mock, "/attempts/available")).toHaveLength(1);
});

it("shows each state in words with the right button", async () => {
  stubFetch(() =>
    jsonResponse(
      200,
      list([
        available({ paperId: "p1", paperName: "Paper one" }),
        available({ paperId: "p2", paperName: "Paper two", attempt: openAttempt("a2", "in_progress") }),
        available({
          paperId: "p3",
          paperName: "Paper three",
          attempt: openAttempt("a3", "submitted"),
          startable: { ok: false, reason: "ATTEMPT_CLOSED" },
        }),
        available({
          paperId: "p4",
          paperName: "Paper four",
          attempt: openAttempt("a4", "timed_out"),
          startable: { ok: false, reason: "ATTEMPT_CLOSED" },
        }),
        available({
          paperId: "p5",
          paperName: "Paper five",
          startable: { ok: false, reason: "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW" },
        }),
        available({
          paperId: "p6",
          paperName: "Paper six",
          startable: { ok: false, reason: "ATTEMPT_LANGUAGE_MISMATCH" },
        }),
      ]),
    ),
  );
  renderPage();
  const row = async (name: string) =>
    within((await screen.findByRole("heading", { name, level: 3 })).closest("li") as HTMLElement);

  const one = await row("Paper one");
  expect(one.getByText("Not started")).toBeInTheDocument();
  expect(one.getByRole("button", { name: "Start Paper one" })).toBeEnabled();

  const two = await row("Paper two");
  expect(two.getByText("In progress")).toBeInTheDocument();
  expect(two.getByRole("button", { name: "Resume Paper two" })).toBeEnabled();

  const three = await row("Paper three");
  expect(three.getByText("Submitted")).toBeInTheDocument();
  expect(three.getByRole("button", { name: "Start Paper three" })).toBeDisabled();

  const four = await row("Paper four");
  expect(four.getByText("Timed out")).toBeInTheDocument();
  expect(four.getByRole("button", { name: "Start Paper four" })).toBeDisabled();

  const five = await row("Paper five");
  expect(five.getByText(/Not available now: today is outside the assessment dates/)).toBeInTheDocument();
  const fiveButton = five.getByRole("button", { name: "Start Paper five" });
  expect(fiveButton).toBeDisabled();
  expect(fiveButton).toHaveAccessibleDescription(/Not available now: today is outside the assessment dates/);

  const six = await row("Paper six");
  expect(six.getByText(/Not available now: this paper is not in the language of your batch/)).toBeInTheDocument();
  expect(six.getByRole("button", { name: "Start Paper six" })).toBeDisabled();
});

it("shows loading, then an empty state", async () => {
  stubFetch(() => jsonResponse(200, list([])));
  setSession(sessionFor("candidate"));
  renderApp("/exam");
  expect(screen.getByText("Loading your assessments…")).toBeInTheDocument();
  expect(await screen.findByText("No assessments are available to you right now")).toBeInTheDocument();
});

it("shows an error with a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  stubFetch(() =>
    fail ? jsonResponse(500, { error: { code: "INTERNAL", message: "Server error" } }) : jsonResponse(200, list([])),
  );
  setSession(sessionFor("candidate"));
  renderApp("/exam");
  expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No assessments are available to you right now")).toBeInTheDocument();
});

it("is only open to candidates", async () => {
  stubFetch(() => jsonResponse(200, list([])));
  setSession(sessionFor("assessor"));
  renderApp("/exam");
  expect(screen.queryByRole("heading", { name: "Exam" })).not.toBeInTheDocument();
});

it("runs the whole flow: pre-check, start, answer, submit, finished", async () => {
  const user = userEvent.setup();
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const mock = stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, list([available()]));
    if (u.pathname.endsWith("/health")) return jsonResponse(200, { status: "ok" });
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(201, attemptBody());
    if (u.pathname.endsWith("/answers")) return jsonResponse(200, { saved: 1, savedAt: "t", deadlineAt: null, remainingSeconds: 10 });
    if (u.pathname.endsWith("/submit")) {
      return jsonResponse(200, { id: ATTEMPT_ID, status: "submitted", closeReason: "submit", closedAt: "t", deadlineAt: "t" });
    }
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") {
      return jsonResponse(201, { id: "ps1", status: "active", config: {} });
    }
    return jsonResponse(204);
  });
  renderPage();

  await user.click(await screen.findByRole("button", { name: "Start Paper 0000AA" }));
  expect(screen.getByRole("heading", { name: "Before you start: Paper 0000AA" })).toHaveFocus();
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);

  await passPrecheck(user);

  expect(await screen.findByRole("heading", { name: "Question 1 of 2" })).toBeInTheDocument();
  expect(bodyOf(callsTo(mock, "/attempts/start", "POST")[0])).toEqual({ batchId: BATCH_ID, testPaperId: PAPER_ID });
  expect(track.stop).not.toHaveBeenCalled();

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(screen.getByRole("button", { name: "Submit now" }));

  expect(await screen.findByRole("heading", { name: "Exam submitted" })).toHaveFocus();
  expect(track.stop).toHaveBeenCalled();
  expect(screen.queryByText(/score|marks/i)).not.toBeInTheDocument();
});

it("resumes an in-progress attempt through the same camera check", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const mock = stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/attempts/available")) {
      return jsonResponse(200, list([available({ attempt: openAttempt(ATTEMPT_ID, "in_progress") })]));
    }
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(200, attemptBody());
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") {
      return jsonResponse(201, { id: "ps1", status: "active", config: {} });
    }
    return jsonResponse(200, { status: "ok" });
  });
  renderPage();

  await user.click(await screen.findByRole("button", { name: "Resume Paper 0000AA" }));
  expect(screen.getByRole("heading", { name: "Before you start: Paper 0000AA" })).toHaveFocus();
  await passPrecheck(user);
  expect(await screen.findByRole("heading", { name: "Question 1 of 2" })).toBeInTheDocument();
  expect(bodyOf(callsTo(mock, "/attempts/start", "POST")[0])).toEqual({ batchId: BATCH_ID, testPaperId: PAPER_ID });
});

it("shows a start error on the pre-check screen and lets the candidate go back", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, list([available()]));
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    return jsonResponse(200, { status: "ok" });
  });
  renderPage();

  await user.click(await screen.findByRole("button", { name: "Start Paper 0000AA" }));
  await passPrecheck(user);

  expect(await screen.findByText(/paper was not found for your batch/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start exam" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Back to my exams" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Exam" })).toBeInTheDocument());
});

it("explains a start refused by a rule in plain words", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, list([available()]));
    if (u.pathname.endsWith("/attempts/start")) {
      return jsonResponse(409, { error: { code: "ATTEMPT_CANDIDATE_ABSENT", message: "absent" } });
    }
    return jsonResponse(200, { status: "ok" });
  });
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Start Paper 0000AA" }));
  await passPrecheck(user);
  expect(await screen.findByText(/This exam cannot start: you are marked absent/)).toBeInTheDocument();
});

it("goes straight to the finished screen for an attempt that is already closed", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, list([available()]));
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(200, attemptBody({ status: "submitted" }));
    return jsonResponse(200, { status: "ok" });
  });
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Start Paper 0000AA" }));
  await passPrecheck(user);
  expect(await screen.findByRole("heading", { name: "This exam is closed" })).toBeInTheDocument();
});
