import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { attempt, callsTo, fakeStream, stubFetch } from "../test/examFixtures";
import { ExamScreen } from "./ExamScreen";
import { installProctorEngine, type ProctorEngine, type ProctorFlagType, type ProctorStatus } from "./proctorBridge";

// X-05: flag notice, camera chip and preview, question palette and controls.

const SESSION = {
  id: "ps1",
  status: "active",
  config: { snapshotIntervalSeconds: 60, detectionIntervalMs: 800, flagCooldownSeconds: 20, sustainedSeconds: {} },
};

function server(warnings: unknown[] = []) {
  return stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/answers") && method === "PUT") {
      return jsonResponse(200, { saved: 1, savedAt: new Date().toISOString(), deadlineAt: null, remainingSeconds: 100 });
    }
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") return jsonResponse(201, SESSION);
    if (u.pathname.endsWith("/heartbeat")) return jsonResponse(204);
    if (u.pathname.endsWith("/warnings")) return jsonResponse(200, { items: warnings });
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });
}

/** An engine that reports `status` (nothing for "starting") and lets the test raise flags. */
function fakeEngine(status: ProctorStatus | null = { state: "running" }) {
  const engine: ProctorEngine = {
    start: vi.fn(async (o) => {
      if (status) o.onStatus(status);
    }),
    stop: vi.fn(),
  };
  installProctorEngine(() => engine);
  return engine;
}

async function raise(engine: ProctorEngine, type: ProctorFlagType) {
  const start = vi.mocked(engine.start);
  await waitFor(() => expect(start).toHaveBeenCalled());
  act(() => start.mock.calls[0][0].onFlag?.({ type }));
}

const stream = () => fakeStream().stream;

afterEach(() => {
  installProctorEngine(null);
  vi.useRealTimers();
});

it("shows a calm centred notice when a flag is raised, one at a time, and merges repeats", async () => {
  const user = userEvent.setup();
  const engine = fakeEngine();
  server();
  render(<ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />);

  await raise(engine, "tab_hidden");
  const notice = await screen.findByRole("alertdialog");
  expect(notice).toHaveTextContent("Please keep this exam tab open and in front while you work.");
  expect(notice).not.toHaveTextContent(/cheat|severity|high|medium|low/i);
  expect(within(notice).getByRole("button", { name: "OK" })).toHaveFocus();

  // A repeat inside the cooldown merges; a different type waits its turn.
  await raise(engine, "tab_hidden");
  await raise(engine, "phone_detected");
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);

  // The timer keeps running and the answer can be changed behind the notice.
  expect(screen.getAllByText(/Time left/).length).toBeGreaterThan(0);
  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  expect(screen.getByRole("radio", { name: /Pliers/ })).toBeChecked();

  await user.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("A phone may be in view. Please keep phones out of sight.");
  await user.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

  // The same type again, still inside the cooldown: nothing new is shown.
  await raise(engine, "tab_hidden");
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

it("keeps the proctor warning dialog and shows it before a flag notice", async () => {
  const engine = fakeEngine();
  server([{ id: "w1", message: "Please sit upright.", createdAt: null }]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />);
  await raise(engine, "tab_hidden");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.getByRole("alertdialog", { name: "Warning from the proctor" })).toBeInTheDocument();
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "I understand" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Please keep this exam tab open");
});

it("shows the camera chip as Camera on, Checking or Camera problem with the reason", async () => {
  server();
  fakeEngine(null);
  const first = render(<ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />);
  expect(await screen.findByText("Checking")).toBeInTheDocument();
  first.unmount();

  fakeEngine();
  const second = render(<ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />);
  expect(await screen.findByText("Camera on")).toBeInTheDocument();
  second.unmount();

  fakeEngine({ state: "degraded", message: "The camera stopped sending video." });
  render(<ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />);
  expect(await screen.findByText("Camera problem")).toBeInTheDocument();
  expect(screen.getByText("The camera stopped sending video.")).toBeInTheDocument();
});

it("shows the candidate's own camera in a small mirrored window", () => {
  server();
  const s = stream();
  render(<ExamScreen attempt={attempt()} stream={s} onFinished={() => {}} />);
  const view = screen.getByLabelText("Your camera, shown as a mirror") as HTMLVideoElement;
  expect(view.tagName).toBe("VIDEO");
  expect(view).toHaveAttribute("width", "160");
  expect(view).toHaveAttribute("height", "120");
  expect(view).toHaveClass("exam-self-view");
  expect(view.srcObject).toBe(s);
});

it("shows the question palette with a legend and counts that follow marks and skips", async () => {
  const user = userEvent.setup();
  server();
  render(<ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} autosaveDebounceMs={50} />);
  const nav = screen.getByRole("navigation", { name: "Questions" });
  expect(within(nav).getByRole("list", { name: "Legend" })).toHaveTextContent(/Attempted.*Not attempted.*Review.*Skipped/);
  expect(within(nav).getByText("Attempted 1, Not attempted 1, Review 0, Skipped 0")).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Mark for review" }));
  expect(within(nav).getByRole("button", { name: "Question 1, not attempted, marked for review" })).toBeInTheDocument();
  expect(within(nav).getByText("Attempted 1, Not attempted 1, Review 1, Skipped 0")).toBeInTheDocument();

  // Leaving question 1 without an answer makes it skipped; answering it later clears that.
  await user.click(screen.getByRole("button", { name: "Save and Next" }));
  expect(
    within(nav).getByRole("button", { name: "Question 1, not attempted, marked for review, skipped" }),
  ).toBeInTheDocument();
  expect(within(nav).getByText("Attempted 1, Not attempted 1, Review 1, Skipped 1")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Previous" }));
  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  expect(within(nav).getByText("Attempted 2, Not attempted 0, Review 1, Skipped 0")).toBeInTheDocument();
});

it("saves and moves on, resets an answer, and changes the text size", async () => {
  const user = userEvent.setup();
  const mock = server();
  render(<ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} autosaveDebounceMs={5000} />);

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await user.click(screen.getByRole("button", { name: "Save and Next" }));
  // Save and Next sends what is waiting without waiting for the pause.
  expect(callsTo(mock, "/answers", "PUT")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Question 2 of 2" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByLabelText("Your answer")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();

  const article = screen.getByRole("heading", { name: "Question 2 of 2" }).closest("article") as HTMLElement;
  expect(article).toHaveStyle({ fontSize: "100%" });
  expect(screen.getByRole("button", { name: "Smaller text" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Larger text" }));
  expect(article).toHaveStyle({ fontSize: "115%" });
  await user.click(screen.getByRole("button", { name: "Smaller text" }));
  expect(article).toHaveStyle({ fontSize: "100%" });
});
