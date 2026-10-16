import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { attempt, ATTEMPT_ID, BATCH_ID, bodyOf, callsTo, fakeStream, stubFetch } from "../test/examFixtures";
import { ExamScreen } from "./ExamScreen";
import { installProctorEngine, type ProctorEngine } from "./proctorBridge";

const SESSION = {
  id: "ps1",
  status: "active",
  config: { snapshotIntervalSeconds: 60, detectionIntervalMs: 800, flagCooldownSeconds: 20, sustainedSeconds: { camera_blocked: 4 } },
};

type Overrides = {
  save?: () => Response;
  session?: () => Response;
  warnings?: () => Response;
  submit?: () => Response;
};

function server(overrides: Overrides = {}) {
  return stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/answers") && method === "PUT") {
      return overrides.save?.() ?? jsonResponse(200, { saved: 1, savedAt: new Date().toISOString(), deadlineAt: null, remainingSeconds: 100 });
    }
    if (u.pathname.endsWith("/submit")) {
      return overrides.submit?.() ?? jsonResponse(200, { id: ATTEMPT_ID, status: "submitted", closeReason: "submit", closedAt: "x", deadlineAt: "y" });
    }
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") return overrides.session?.() ?? jsonResponse(201, SESSION);
    if (u.pathname.endsWith("/heartbeat")) return jsonResponse(204);
    if (u.pathname.endsWith("/warnings")) return overrides.warnings?.() ?? jsonResponse(200, { items: [] });
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });
}

function fakeEngine() {
  const engine: ProctorEngine = {
    start: vi.fn(async (o) => o.onStatus({ state: "running" })),
    stop: vi.fn(),
  };
  installProctorEngine(() => engine);
  return engine;
}

afterEach(() => {
  installProctorEngine(null);
  vi.useRealTimers();
  delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
});

it("shows one question at a time with a navigator and never shows marks", async () => {
  const user = userEvent.setup();
  server();
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={() => {}} />);

  expect(screen.getByRole("heading", { name: "Question 1 of 2" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Pliers/ })).toBeInTheDocument();
  expect(screen.queryByText(/\d+ marks?\b|marks:/i)).not.toBeInTheDocument();

  const nav = screen.getByRole("navigation", { name: "Questions" });
  expect(within(nav).getByRole("button", { name: "Question 1, not attempted" })).toHaveAttribute("aria-current", "step");
  await user.click(within(nav).getByRole("button", { name: "Question 2, attempted" }));
  expect(screen.getByRole("heading", { name: "Question 2 of 2" })).toHaveFocus();
  expect(screen.getByLabelText("Your answer")).toHaveValue("Saved before");
});

it("autosaves after a pause, shows saving and saved, and retries after an error", async () => {
  const user = userEvent.setup();
  let fail = true;
  const mock = server({
    save: () =>
      fail
        ? jsonResponse(500, { error: { code: "INTERNAL", message: "Server error" } })
        : jsonResponse(200, { saved: 1, savedAt: "2026-10-16T05:00:00.000Z", deadlineAt: null, remainingSeconds: 100 }),
  });
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={() => {}} autosaveDebounceMs={300} />);

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await user.click(screen.getByRole("radio", { name: /Hammer/ }));
  expect(await screen.findByText("Not saved")).toBeInTheDocument();
  // Two quick changes made one request with the last value.
  expect(callsTo(mock, "/answers", "PUT")).toHaveLength(1);
  expect(bodyOf(callsTo(mock, "/answers", "PUT")[0])).toEqual({ answers: [{ questionId: "q1", answer: "B" }] });

  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry saving" }));
  expect(await screen.findByText("All answers saved")).toBeInTheDocument();
  expect(bodyOf(callsTo(mock, "/answers", "PUT")[1])).toEqual({ answers: [{ questionId: "q1", answer: "B" }] });

  await user.click(screen.getByRole("button", { name: "Save and Next" }));
  await user.clear(screen.getByLabelText("Your answer"));
  await waitFor(() => expect(callsTo(mock, "/answers", "PUT")).toHaveLength(3));
  expect(bodyOf(callsTo(mock, "/answers", "PUT")[2])).toEqual({ answers: [{ questionId: "q2", answer: null }] });
});

it("ends the exam when the server says the time is up", async () => {
  const user = userEvent.setup();
  const onFinished = vi.fn();
  server({ save: () => jsonResponse(409, { error: { code: "ATTEMPT_TIME_UP", message: "Time is up" } }) });
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={onFinished} autosaveDebounceMs={10} />);
  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith("timed_out"));
});

it("counts down from the server deadline and announces 5 minutes, 1 minute and time up", async () => {
  vi.useFakeTimers();
  const engine = fakeEngine();
  const onFinished = vi.fn();
  const mock = server();
  const now = Date.now();
  // The device clock is 10 minutes behind the server; the server clock wins.
  const serverNow = now + 10 * 60 * 1000;
  const a = attempt({
    serverTime: new Date(serverNow).toISOString(),
    deadlineAt: new Date(serverNow + 302 * 1000).toISOString(),
  });
  render(<ExamScreen attempt={a} stream={fakeStream().stream} onFinished={onFinished} />);

  expect(screen.getByRole("timer", { hidden: true })).toHaveTextContent("Time left 05:02");
  const live = document.querySelector('[aria-live="polite"]');
  expect(live).toHaveTextContent("");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(live).toHaveTextContent("5 minutes left.");
  expect(screen.getByText(/Less than 5 minutes left/)).toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(239 * 1000);
  });
  expect(live).toHaveTextContent("1 minute left.");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61 * 1000);
  });
  expect(onFinished).toHaveBeenCalledWith("timed_out");
  expect(engine.stop).toHaveBeenCalled();
  // A timeout is left to the server; the page does not submit for the candidate.
  expect(callsTo(mock, "/submit", "POST")).toHaveLength(0);
});

it("asks for confirmation, saves, then submits and stops proctoring", async () => {
  const user = userEvent.setup();
  const engine = fakeEngine();
  const onFinished = vi.fn();
  const mock = server();
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={onFinished} autosaveDebounceMs={5000} />);

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  const dialog = screen.getByRole("dialog", { name: "Submit your exam?" });
  expect(dialog).toHaveTextContent("You have answered 2 of 2 questions.");

  await user.click(within(dialog).getByRole("button", { name: "Go back to the exam" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(callsTo(mock, "/submit", "POST")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(screen.getByRole("button", { name: "Submit now" }));
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith("submitted"));
  // The waiting answer went up before the submit.
  const order = mock.mock.calls.map((call) => String(call[0]));
  expect(order.findIndex((u) => u.endsWith("/answers"))).toBeLessThan(order.findIndex((u) => u.endsWith("/submit")));
  expect(engine.stop).toHaveBeenCalled();
});

it("does not submit while answers are unsaved", async () => {
  const user = userEvent.setup();
  const onFinished = vi.fn();
  const mock = server({ save: () => jsonResponse(500, { error: { code: "INTERNAL", message: "Server error" } }) });
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={onFinished} autosaveDebounceMs={5000} />);
  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(screen.getByRole("button", { name: "Submit now" }));
  expect(await screen.findByText(/Some answers are not saved yet/)).toBeInTheDocument();
  expect(callsTo(mock, "/submit", "POST")).toHaveLength(0);
  expect(onFinished).not.toHaveBeenCalled();
});

it("starts the engine with the session, sends heartbeats and shows each new warning once", async () => {
  vi.useFakeTimers();
  const engine = fakeEngine();
  const { stream } = fakeStream();
  let rows: unknown[] = [];
  const mock = server({ warnings: () => jsonResponse(200, { items: rows }) });
  render(<ExamScreen attempt={attempt()} stream={stream} onFinished={() => {}} />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(bodyOf(callsTo(mock, "/proctoring/sessions", "POST")[0])).toEqual({ attemptId: ATTEMPT_ID });
  expect(engine.start).toHaveBeenCalledWith(
    expect.objectContaining({ stream, sessionId: "ps1", attemptId: ATTEMPT_ID, batchId: BATCH_ID, config: SESSION.config }),
  );
  expect(screen.getByText("Camera on")).toBeInTheDocument();

  rows = [{ id: "w1", message: "Please keep your face in view of the camera.", createdAt: null }];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(callsTo(mock, "/ps1/heartbeat", "POST")).toHaveLength(1);
  expect(callsTo(mock, "/ps1/warnings")).toHaveLength(1);
  const alert = screen.getByRole("alertdialog", { name: "Warning from the proctor" });
  expect(alert).toHaveTextContent("Please keep your face in view of the camera.");

  fireEvent.click(within(alert).getByRole("button", { name: "I understand" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(callsTo(mock, "/ps1/warnings")).toHaveLength(2);
  // The same warning is not shown again.
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

it("keeps the exam going with a visible notice when no proctoring session can be created", async () => {
  const user = userEvent.setup();
  const engine = fakeEngine();
  server({ session: () => jsonResponse(503, { error: { code: "UNAVAILABLE", message: "Down" } }) });
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={() => {}} />);
  expect(await screen.findByText("Proctoring unavailable.")).toBeInTheDocument();
  expect(engine.start).not.toHaveBeenCalled();
  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  expect(screen.getByRole("radio", { name: /Pliers/ })).toBeChecked();
});

it("shows the no-op engine as limited when no real engine is installed", async () => {
  server();
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={() => {}} />);
  expect(await screen.findByText("Camera problem")).toBeInTheDocument();
  expect(screen.getByText("Proctoring engine not installed")).toBeInTheDocument();
});

it("does not ask for full screen in the exam window by default (X-08)", async () => {
  Object.defineProperty(document.documentElement, "requestFullscreen", { value: vi.fn(async () => {}), configurable: true });
  server();
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={() => {}} />);
  expect(screen.queryByRole("button", { name: "Return to full screen" })).not.toBeInTheDocument();
});

it("asks the candidate to return to full screen after leaving it when full screen is required", async () => {
  const user = userEvent.setup();
  const request = vi.fn(async () => {});
  Object.defineProperty(document.documentElement, "requestFullscreen", { value: request, configurable: true });
  server();
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} onFinished={() => {}} requireFullscreen />);
  const notice = screen.getByRole("alert");
  expect(notice).toHaveTextContent(/You left full screen/);
  await user.click(within(notice).getByRole("button", { name: "Return to full screen" }));
  expect(request).toHaveBeenCalled();
});
