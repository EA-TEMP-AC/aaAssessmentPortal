import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, getSnapshot, setSession } from "../api/session";
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
import { ExamWindowGate, ExamWindowPage } from "./ExamWindowPage";

function available(overrides: Record<string, unknown> = {}) {
  return {
    batchId: BATCH_ID,
    batchName: "ELE/Q0001 Field Technician, 2026-10-15 to 2026-10-17",
    assessmentStartDate: "2026-10-15",
    assessmentEndDate: "2026-10-17",
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

const PATH = `/exam/window/${BATCH_ID}/${PAPER_ID}`;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  makeVideosReady();
});

afterEach(() => {
  Object.defineProperty(window, "opener", { value: null, configurable: true });
  clearSession();
});

function renderWindow() {
  setSession(sessionFor("candidate"));
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[PATH]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route
            path="/exam/window/:batchId/:paperId"
            element={
              <ExamWindowPage
                frameCheck={{ sample: () => frame(150), attempts: 2, intervalMs: 1 }}
                faceChecks={fakeFaceChecks()}
                autosaveDebounceMs={20}
              />
            }
          />
          <Route path="/exam" element={<h1>Dashboard</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function passPrecheck(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Check camera" }));
  await screen.findByText("The camera works.");
  await screen.findByText(/Connected to the exam server/);
  await user.click(screen.getByRole("button", { name: "Next: photo ID and photo" }));
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  await screen.findByText(/look alike/);
  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  await user.click(screen.getByRole("button", { name: "Start exam" }));
}

function openerWithBridge(refreshExams = vi.fn()) {
  const opener = {
    closed: false,
    __ncvetExamBridge: { getSession: () => getSnapshot(), pushSession: vi.fn(), refreshExams },
  };
  Object.defineProperty(window, "opener", { value: opener, configurable: true });
  return { opener, refreshExams };
}

function routes(fullscreen = vi.fn(async () => {})) {
  Object.defineProperty(document.documentElement, "requestFullscreen", { value: fullscreen, configurable: true });
  return stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, { items: [available()] });
    if (u.pathname.endsWith("/health")) return jsonResponse(200, { status: "ok" });
    if (u.pathname.endsWith("/candidate-info/mine")) {
      return jsonResponse(200, { enabled: false, submitted: false, fields: [] });
    }
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(201, attemptBody());
    if (u.pathname.endsWith("/answers")) {
      return jsonResponse(200, { saved: 1, savedAt: "t", deadlineAt: null, remainingSeconds: 10 });
    }
    if (u.pathname.endsWith("/submit")) {
      return jsonResponse(200, { id: ATTEMPT_ID, status: "submitted", closeReason: "submit", closedAt: "t", deadlineAt: "t" });
    }
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") {
      return jsonResponse(201, { id: "ps1", status: "active", config: {} });
    }
    return jsonResponse(204);
  });
}

it("runs the whole flow in the window without asking for full screen, then closes and refreshes the dashboard", async () => {
  const user = userEvent.setup();
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const fullscreen = vi.fn(async () => {});
  const mock = routes(fullscreen);
  const { refreshExams } = openerWithBridge();
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  renderWindow();

  expect(await screen.findByRole("heading", { name: "Before you start: Paper 0000AA" })).toHaveFocus();
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Close this window" })).toBeInTheDocument();

  await passPrecheck(user);
  expect(await screen.findByRole("heading", { name: "Question 1 of 2" })).toBeInTheDocument();
  expect(bodyOf(callsTo(mock, "/attempts/start", "POST")[0])).toEqual({ batchId: BATCH_ID, testPaperId: PAPER_ID });
  expect(fullscreen).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Return to full screen" })).not.toBeInTheDocument();
  expect(track.stop).not.toHaveBeenCalled();

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(screen.getByRole("button", { name: "Submit now" }));

  expect(await screen.findByRole("heading", { name: "Exam submitted" })).toHaveFocus();
  expect(track.stop).toHaveBeenCalled();
  expect(screen.queryByText(/score|marks/i)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close window and refresh dashboard" }));
  expect(refreshExams).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});

it("says so when the browser will not close the window", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, { items: [available()] });
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(200, attemptBody({ status: "submitted" }));
    return jsonResponse(200, { status: "ok" });
  });
  openerWithBridge();
  vi.spyOn(window, "close").mockImplementation(() => {});
  renderWindow();
  await passPrecheck(user);
  expect(await screen.findByRole("heading", { name: "This exam is closed" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close window and refresh dashboard" }));
  expect(await screen.findByText(/did not close this window/)).toBeInTheDocument();
});

it("goes back to the dashboard route when it was not opened from the dashboard", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, { items: [available()] });
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(200, attemptBody({ status: "submitted" }));
    return jsonResponse(200, { status: "ok" });
  });
  renderWindow();
  await passPrecheck(user);
  await user.click(await screen.findByRole("button", { name: "Back to my exams" }));
  expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
});

it("resumes an in-progress attempt through the same two-step check", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const mock = stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/attempts/available")) {
      return jsonResponse(200, {
        items: [available({ attempt: { id: ATTEMPT_ID, status: "in_progress", startedAt: "t", deadline: "t", remainingSeconds: 600 } })],
      });
    }
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(200, attemptBody());
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") {
      return jsonResponse(201, { id: "ps1", status: "active", config: {} });
    }
    return jsonResponse(200, { status: "ok" });
  });
  renderWindow();
  await passPrecheck(user);
  expect(await screen.findByRole("heading", { name: "Question 1 of 2" })).toBeInTheDocument();
  expect(bodyOf(callsTo(mock, "/attempts/start", "POST")[0])).toEqual({ batchId: BATCH_ID, testPaperId: PAPER_ID });
});

it("shows a start error on the photo tab", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/attempts/available")) return jsonResponse(200, { items: [available()] });
    if (u.pathname.endsWith("/attempts/start")) {
      return jsonResponse(409, { error: { code: "ATTEMPT_CANDIDATE_ABSENT", message: "absent" } });
    }
    return jsonResponse(200, { status: "ok" });
  });
  renderWindow();
  await passPrecheck(user);
  expect(await screen.findByText(/This exam cannot start: you are marked absent/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start exam" })).toBeEnabled();
});

it("explains an exam that cannot be started and one that is not on the list", async () => {
  stubFetch((u) => {
    if (u.pathname.endsWith("/attempts/available")) {
      return jsonResponse(200, {
        items: [available({ startable: { ok: false, reason: "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW" } })],
      });
    }
    return jsonResponse(200, { status: "ok" });
  });
  renderWindow();
  expect(await screen.findByRole("heading", { name: "This exam cannot be started" })).toHaveFocus();
  expect(screen.getByRole("alert")).toHaveTextContent(/today is outside the assessment dates/);
  expect(screen.getByRole("button", { name: "Back to my exams" })).toBeInTheDocument();
});

it("shows a load error with a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  stubFetch(() =>
    fail
      ? jsonResponse(500, { error: { code: "INTERNAL", message: "Server error" } })
      : jsonResponse(200, { items: [] }),
  );
  renderWindow();
  expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Exam not found" })).toBeInTheDocument();
});

it("stands alone on its route: no sidebar, no admin links, and candidates only", async () => {
  stubFetch((u) =>
    u.pathname.endsWith("/attempts/available")
      ? jsonResponse(200, { items: [available()] })
      : jsonResponse(200, { status: "ok" }),
  );
  setSession(sessionFor("candidate"));
  const view = renderApp(PATH);
  expect(await screen.findByRole("heading", { name: "Before you start: Paper 0000AA" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  view.unmount();

  clearSession();
  setSession(sessionFor("assessor"));
  renderApp(PATH);
  await waitFor(() => expect(screen.queryByRole("heading", { name: /Before you start/ })).not.toBeInTheDocument());
});

it("takes the session from the window that opened it, and passes later changes on", async () => {
  stubFetch((u) =>
    u.pathname.endsWith("/attempts/available")
      ? jsonResponse(200, { items: [available()] })
      : jsonResponse(200, { status: "ok" }),
  );
  const session = sessionFor("candidate");
  const pushSession = vi.fn();
  Object.defineProperty(window, "opener", {
    value: { closed: false, __ncvetExamBridge: { getSession: () => session, pushSession } },
    configurable: true,
  });
  clearSession();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/x"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<ExamWindowGate />}>
            <Route path="/x" element={<p>inside</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("inside")).toBeInTheDocument();
  expect(getSnapshot()?.accessToken).toBe(session.accessToken);
  setSession({ ...session, accessToken: "newer-token" });
  expect(pushSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "newer-token" }));
});
