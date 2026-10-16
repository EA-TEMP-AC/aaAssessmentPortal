import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import {
  attempt,
  bodyOf,
  callsTo,
  fakeStream,
  stubFetch,
} from "../test/examFixtures";
import { ExamScreen, PAUSE_POLL_MS } from "./ExamScreen";
import { installProctorEngine } from "./proctorBridge";

// B-20: pause from the flag policy, mandatory questions, shuffled option labels.

const SESSION = {
  id: "ps1",
  status: "active",
  config: {
    snapshotIntervalSeconds: 60,
    detectionIntervalMs: 800,
    flagCooldownSeconds: 20,
    sustainedSeconds: {},
  },
};
const PAUSED_ERROR = {
  error: {
    code: "ATTEMPT_PAUSED",
    message: "Your test is paused. Please contact your proctor.",
  },
};
const PAUSED_TEXT = "Your test is paused. Please contact your proctor.";

type Routes = {
  answers?: () => Response;
  submit?: () => Response;
  heartbeat?: () => Response;
  attempt?: () => Response;
};

function server(routes: Routes = {}) {
  return stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/answers") && method === "PUT") {
      return (
        routes.answers?.() ??
        jsonResponse(200, {
          saved: 1,
          savedAt: new Date().toISOString(),
          deadlineAt: null,
          remainingSeconds: 100,
        })
      );
    }
    if (u.pathname.endsWith("/submit") && method === "POST") {
      return (
        routes.submit?.() ??
        jsonResponse(200, {
          id: "a",
          status: "submitted",
          closeReason: "submit",
          closedAt: "t",
          deadlineAt: "t",
        })
      );
    }
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST")
      return jsonResponse(201, SESSION);
    if (u.pathname.endsWith("/heartbeat"))
      return routes.heartbeat?.() ?? jsonResponse(200, { paused: false });
    if (u.pathname.endsWith("/warnings"))
      return jsonResponse(200, { items: [] });
    if (
      /\/attempts\/[^/]+$/.test(u.pathname) &&
      method === "GET" &&
      routes.attempt
    )
      return routes.attempt();
    return jsonResponse(404, {
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });
}

const stream = () => fakeStream().stream;

afterEach(() => {
  installProctorEngine(null);
  vi.useRealTimers();
});

it("shows the paused message and blocks answering when the attempt is already paused", async () => {
  server();
  render(
    <ExamScreen
      attempt={attempt({ paused: true })}
      stream={stream()}
      onFinished={() => {}}
    />,
  );

  const dialog = await screen.findByRole("alertdialog", {
    name: "Test paused",
  });
  expect(dialog).toHaveTextContent(PAUSED_TEXT);
  expect(dialog).toHaveTextContent("Your saved answers are safe");
  expect(
    within(dialog).getByRole("heading", { name: "Test paused" }),
  ).toHaveFocus();
  expect(screen.getByRole("radio", { name: /Pliers/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save and Next" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Submit exam" })).toBeDisabled();
  // The clock keeps showing.
  expect(screen.getAllByText(/Time left/).length).toBeGreaterThan(0);
});

it("pauses when the server refuses an answer save, keeps the answer, and resends it after the unlock", async () => {
  const user = userEvent.setup();
  let paused = true;
  const mock = server({
    answers: () =>
      paused
        ? jsonResponse(409, PAUSED_ERROR)
        : jsonResponse(200, { saved: 1, savedAt: "t" }),
    heartbeat: () => jsonResponse(200, { paused }),
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(
    <ExamScreen
      attempt={attempt()}
      stream={stream()}
      onFinished={() => {}}
      autosaveDebounceMs={20}
    />,
  );

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "Test paused",
  });
  expect(dialog).toHaveTextContent(PAUSED_TEXT);
  expect(callsTo(mock, "/answers", "PUT")).toHaveLength(1);

  // The proctor unlocks; the next heartbeat tells the page.
  paused = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("alertdialog", { name: "Test paused" }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(callsTo(mock, "/answers", "PUT")).toHaveLength(2));
  expect(bodyOf(callsTo(mock, "/answers", "PUT")[1])).toEqual({
    answers: [{ questionId: "q1", answer: "A" }],
  });
  expect(screen.getByRole("radio", { name: /Pliers/ })).toBeChecked();
  expect(screen.getByRole("radio", { name: /Pliers/ })).toBeEnabled();
});

it("pauses when the heartbeat says so, and notices an unlock by asking the server", async () => {
  let heartbeatPaused = true;
  let attemptPaused = true;
  server({
    heartbeat: () => jsonResponse(200, { paused: heartbeatPaused }),
    attempt: () =>
      jsonResponse(200, { ...attemptBodyFor(), paused: attemptPaused }),
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(
    <ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(
    await screen.findByRole("alertdialog", { name: "Test paused" }),
  ).toBeInTheDocument();

  // The heartbeat would also clear it; here only the poll of the attempt sees the unlock.
  heartbeatPaused = true;
  attemptPaused = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAUSE_POLL_MS + 100);
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("alertdialog", { name: "Test paused" }),
    ).not.toBeInTheDocument(),
  );
});

it("ends the exam when the attempt closed while it was paused", async () => {
  const onFinished = vi.fn();
  server({
    attempt: () =>
      jsonResponse(200, {
        ...attemptBodyFor(),
        paused: false,
        status: "timed_out",
      }),
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(
    <ExamScreen
      attempt={attempt({ paused: true })}
      stream={stream()}
      onFinished={onFinished}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAUSE_POLL_MS + 100);
  });
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith("timed_out"));
});

it("shows the paused message when a submit is refused as paused", async () => {
  const user = userEvent.setup();
  server({ submit: () => jsonResponse(409, PAUSED_ERROR) });
  render(
    <ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />,
  );
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(screen.getByRole("button", { name: "Submit now" }));
  expect(
    await screen.findByRole("alertdialog", { name: "Test paused" }),
  ).toHaveTextContent(PAUSED_TEXT);
  expect(
    screen.queryByRole("dialog", { name: "Submit your exam?" }),
  ).not.toBeInTheDocument();
});

it("blocks submit while a question is unanswered when the batch makes every question mandatory", async () => {
  const user = userEvent.setup();
  const mock = server();
  render(
    <ExamScreen
      attempt={attempt({ settings: { questionsMandatory: true } })}
      stream={stream()}
      onFinished={() => {}}
      autosaveDebounceMs={20}
    />,
  );
  expect(
    screen.getByText("You must answer every question before you can submit."),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Submit your exam?",
  });
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "You must answer every question before you submit. 1 question is not answered.",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Submit now" }),
  ).not.toBeInTheDocument();

  await user.click(
    within(dialog).getByRole("button", {
      name: "Go to the first unanswered question",
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Question 1 of 2" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(await screen.findByRole("button", { name: "Submit now" }));
  await waitFor(() => expect(callsTo(mock, "/submit", "POST")).toHaveLength(1));
});

it("shows the server's mandatory-question refusal in the dialog", async () => {
  const user = userEvent.setup();
  server({
    submit: () =>
      jsonResponse(409, {
        error: {
          code: "ATTEMPT_UNANSWERED_QUESTIONS",
          message: "Every question must be answered before you submit",
          details: { unansweredCount: 1 },
        },
      }),
  });
  render(
    <ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />,
  );
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(screen.getByRole("button", { name: "Submit now" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Every question must be answered before you submit",
  );
  expect(screen.getByRole("button", { name: "Submit now" })).toBeEnabled();
});

it("does not block submit by default", async () => {
  const user = userEvent.setup();
  server();
  render(
    <ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />,
  );
  expect(
    screen.queryByText(/must answer every question/),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  expect(screen.getByRole("button", { name: "Submit now" })).toBeEnabled();
});

it("labels shuffled options A, B, C by position and still sends the option key", async () => {
  const user = userEvent.setup();
  const mock = server();
  render(
    <ExamScreen
      attempt={attempt({
        shuffleOptions: true,
        questions: [
          {
            questionId: "q1",
            order: 1,
            type: "mcq",
            stem: "Which tool cuts wire?",
            options: [
              { key: "B", text: "Hammer" },
              { key: "A", text: "Pliers" },
            ],
            answer: null,
          },
        ],
      })}
      stream={stream()}
      onFinished={() => {}}
      autosaveDebounceMs={20}
    />,
  );
  const first = screen.getByRole("radio", { name: /Hammer/ });
  expect(first.closest("label")).toHaveTextContent("A. Hammer");
  expect(
    screen.getByRole("radio", { name: /Pliers/ }).closest("label"),
  ).toHaveTextContent("B. Pliers");

  await user.click(screen.getByRole("radio", { name: /Pliers/ }));
  await waitFor(() => expect(callsTo(mock, "/answers", "PUT")).toHaveLength(1));
  expect(bodyOf(callsTo(mock, "/answers", "PUT")[0])).toEqual({
    answers: [{ questionId: "q1", answer: "A" }],
  });
});

it("keeps the option keys as labels when options are not shuffled", () => {
  server();
  render(
    <ExamScreen attempt={attempt()} stream={stream()} onFinished={() => {}} />,
  );
  expect(
    screen.getByRole("radio", { name: /Pliers/ }).closest("label"),
  ).toHaveTextContent("A. Pliers");
});

/** The attempt as GET /attempts/:id returns it. */
function attemptBodyFor() {
  const now = Date.now();
  return {
    id: "6700000000000000000000cc",
    testPaperId: "6700000000000000000000aa",
    batchId: "6700000000000000000000bb",
    status: "in_progress",
    deadlineAt: new Date(now + 1_800_000).toISOString(),
    serverTime: new Date(now).toISOString(),
    questions: [
      {
        questionId: "q1",
        order: 1,
        type: "mcq",
        stem: "x",
        options: [{ key: "A", text: "Pliers" }],
        answer: null,
      },
    ],
  };
}
