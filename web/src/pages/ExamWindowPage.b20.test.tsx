import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { createQueryClient } from "../queryClient";
import { jsonResponse, sessionFor } from "../test/fixtures";
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
import { ExamWindowPage } from "./ExamWindowPage";

// B-20: the candidate pop-up before the exam starts, and marks on the finished screen
// (moved to the exam window by X-08).

const PATH = `/exam/window/${BATCH_ID}/${PAPER_ID}`;

const available = {
  batchId: BATCH_ID,
  batchName: "ELE/Q0001 Field Technician, 2026-10-15 to 2026-10-17",
  paperId: PAPER_ID,
  paperCode: "0000AA",
  paperName: "Paper 0000AA",
  language: "en",
  questionCount: 2,
  durationMinutes: 30,
  attempt: null,
  startable: { ok: true },
};

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  makeVideosReady();
});

function renderPage() {
  setSession(sessionFor("candidate"));
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter
        initialEntries={[PATH]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/exam/window/:batchId/:paperId"
            element={
              <ExamWindowPage
                frameCheck={{
                  sample: () => frame(150),
                  attempts: 2,
                  intervalMs: 1,
                }}
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
  await user.click(
    screen.getByRole("button", { name: "Next: photo ID and photo" }),
  );
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  await screen.findByText(/look alike/);
  await user.click(
    screen.getByRole("checkbox", { name: /proctoring notice/i }),
  );
  await user.click(screen.getByRole("button", { name: "Start exam" }));
}

type Popup = { enabled: boolean; fields: string[]; submitted: boolean };

function server(
  popup: Popup | Response,
  extra: (u: URL, init?: RequestInit) => Response | undefined = () => undefined,
) {
  return stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    const custom = extra(u, init);
    if (custom) return custom;
    if (u.pathname.endsWith("/attempts/available"))
      return jsonResponse(200, { items: [available] });
    if (u.pathname.endsWith("/health"))
      return jsonResponse(200, { status: "ok" });
    if (u.pathname.endsWith("/candidate-info/mine")) {
      return popup instanceof Response
        ? popup
        : jsonResponse(200, { batchId: BATCH_ID, ...popup });
    }
    if (u.pathname.endsWith("/candidate-info") && method === "PUT") {
      return jsonResponse(200, {
        batchId: BATCH_ID,
        submitted: true,
        fields: [],
      });
    }
    if (u.pathname.endsWith("/attempts/start"))
      return jsonResponse(201, attemptBody());
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") {
      return jsonResponse(201, { id: "ps1", status: "active", config: {} });
    }
    return jsonResponse(204);
  });
}

const PRIVATE = { email: "Asha.Devi@example.com", fatherName: "Ramesh Devi" };

it("asks for the chosen details after the camera check and before the exam clock starts", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const mock = server({
    enabled: true,
    fields: ["email", "gender"],
    submitted: false,
  });
  renderPage();
  await passPrecheck(user);

  const heading = await screen.findByRole("heading", { name: "Your details" });
  expect(heading).toHaveFocus();
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);
  expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  expect(screen.getByLabelText("Gender")).toBeInTheDocument();
  expect(screen.queryByLabelText("Father's name")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();
  expect(
    screen.getByText(
      /Never enter an Aadhaar, PAN, voter id or passport number/,
    ),
  ).toBeInTheDocument();

  // Nothing filled in, then a bad email: the page says what is wrong and sends nothing.
  await user.click(
    screen.getByRole("button", { name: "Save and start the exam" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Email address: Enter your email address.");
  expect(alert).toHaveTextContent("Gender: Enter your gender.");
  await user.type(screen.getByLabelText("Email address"), "not-an-email");
  await user.selectOptions(screen.getByLabelText("Gender"), "female");
  await user.click(
    screen.getByRole("button", { name: "Save and start the exam" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter a valid email address.",
  );
  expect(callsTo(mock, "/candidate-info", "PUT")).toHaveLength(0);

  await user.clear(screen.getByLabelText("Email address"));
  await user.type(screen.getByLabelText("Email address"), PRIVATE.email);
  await user.click(
    screen.getByRole("button", { name: "Save and start the exam" }),
  );

  expect(
    await screen.findByRole("heading", { name: "Question 1 of 2" }),
  ).toBeInTheDocument();
  expect(bodyOf(callsTo(mock, "/candidate-info", "PUT")[0])).toEqual({
    email: PRIVATE.email,
    gender: "female",
  });
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(1);
  // The details are not kept on the page once the exam is open.
  expect(document.body).not.toHaveTextContent(PRIVATE.email);
});

it("skips the pop-up when it is off or the candidate already answered", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  server({ enabled: true, fields: ["email"], submitted: true });
  renderPage();
  await passPrecheck(user);
  expect(
    await screen.findByRole("heading", { name: "Question 1 of 2" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Your details" }),
  ).not.toBeInTheDocument();
});

it("lets the candidate go back from the pop-up; the camera is turned off and no attempt starts", async () => {
  const user = userEvent.setup();
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const mock = server({
    enabled: true,
    fields: ["fatherName"],
    submitted: false,
  });
  renderPage();
  await passPrecheck(user);
  await screen.findByRole("heading", { name: "Your details" });
  await user.click(screen.getByRole("button", { name: "Go back" }));
  expect(
    await screen.findByRole("button", { name: "Check camera" }),
  ).toBeInTheDocument();
  expect(track.stop).toHaveBeenCalled();
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);
});

it("does not start the exam when the server cannot say whether details are needed", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const mock = server(
    jsonResponse(500, { error: { code: "INTERNAL", message: "Server error" } }),
  );
  renderPage();
  await passPrecheck(user);
  expect(
    await screen.findByText(
      /Could not check whether the exam needs more details/,
    ),
  ).toBeInTheDocument();
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);
});

it("shows the server's refusal when the details are not accepted, and does not start", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  const mock = server(
    { enabled: true, fields: ["fatherName"], submitted: false },
    (u, init) =>
      u.pathname.endsWith("/candidate-info") && init?.method === "PUT"
        ? jsonResponse(400, {
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed",
            },
          })
        : undefined,
  );
  renderPage();
  await passPrecheck(user);
  await user.type(
    await screen.findByLabelText("Father's name"),
    PRIVATE.fatherName,
  );
  await user.click(
    screen.getByRole("button", { name: "Save and start the exam" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Some details were not accepted",
  );
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);
  expect(screen.getByLabelText("Father's name")).toHaveValue(
    PRIVATE.fatherName,
  );
});

it("shows the candidate's total on the finished screen only when the batch shows marks", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  server({ enabled: false, fields: [], submitted: false }, (u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/attempts/start")) {
      return jsonResponse(
        201,
        attemptBody({ settings: { showMarksToCandidate: true } }),
      );
    }
    if (u.pathname.endsWith("/submit")) {
      return jsonResponse(200, {
        id: ATTEMPT_ID,
        status: "submitted",
        closeReason: "submit",
        closedAt: "t",
        deadlineAt: "t",
      });
    }
    if (u.pathname.endsWith(`/attempts/${ATTEMPT_ID}`) && method === "GET") {
      return jsonResponse(
        200,
        attemptBody({
          status: "submitted",
          settings: { showMarksToCandidate: true },
          marks: { obtainedMarks: 3, maxMarks: 4, complete: false },
        }),
      );
    }
    return undefined;
  });
  renderPage();
  await passPrecheck(user);
  await screen.findByRole("heading", { name: "Question 1 of 2" });
  await user.click(screen.getByRole("button", { name: "Submit exam" }));
  await user.click(screen.getByRole("button", { name: "Submit now" }));

  expect(
    await screen.findByRole("heading", { name: "Exam submitted" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText(/Your marks: 3 out of 4\./)).toBeInTheDocument(),
  );
  expect(screen.getByText(/still to be marked by hand/)).toBeInTheDocument();
});
