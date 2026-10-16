import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, setSession } from "../api/session";
import { createQueryClient } from "../queryClient";
import { callsTo, stubFetch } from "../test/examFixtures";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { AnswerSheetPage } from "./AnswerSheetPage";
import { BatchReportsSection } from "./batches/BatchReportsSection";
import { ProctoringReportPage } from "./ProctoringReportPage";

const ATTEMPT = "a".repeat(24);
const BATCH = "b".repeat(24);

beforeEach(() => {
  setSession(sessionFor("aa_admin"));
});
afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

function shell(path: string, pattern: string, element: JSX.Element) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sheetBody = {
  id: ATTEMPT,
  batchId: BATCH,
  status: "submitted",
  candidateName: "Asha Devi",
  startedAt: "2026-10-16T04:00:00.000Z",
  closedAt: "2026-10-16T04:30:00.000Z",
  scores: { maxMarks: 2, obtainedMarks: 1, complete: true },
  itemPage: 1,
  itemPageSize: 50,
  itemTotal: 2,
  questions: [
    {
      questionId: "q1",
      order: 1,
      type: "mcq",
      nosId: "NOS-1",
      marks: 1,
      stem: "Which is a conductor?",
      options: [
        { key: "A", text: "Copper" },
        { key: "B", text: "Rubber" },
      ],
      answer: "A",
      correctAnswer: "A",
      awardedMarks: 1,
      scoreStatus: "scored",
      answeredAt: "2026-10-16T04:01:05.000Z",
      secondsSpent: 65,
    },
    {
      questionId: "q2",
      order: 2,
      type: "mcq",
      nosId: "NOS-1",
      marks: 1,
      stem: "Which is an insulator?",
      options: [
        { key: "A", text: "Copper" },
        { key: "B", text: "Rubber" },
      ],
      answer: null,
      correctAnswer: "B",
      awardedMarks: 0,
      scoreStatus: "scored",
      answeredAt: null,
      secondsSpent: null,
    },
  ],
};

it("shows the answer sheet with the answer, marks and time per question", async () => {
  stubFetch(() => jsonResponse(200, sheetBody));
  shell(
    `/attempts/${ATTEMPT}/sheet`,
    "/attempts/:attemptId/sheet",
    <AnswerSheetPage />,
  );
  expect(await screen.findByText("Asha Devi")).toBeInTheDocument();
  expect(screen.getAllByText("A. Copper", { selector: "dd" })).toHaveLength(2);
  expect(screen.getByText("1 min 05 s")).toBeInTheDocument();
  expect(screen.getAllByText("Not answered").length).toBeGreaterThan(0);
  expect(screen.getByText("1 of 2")).toBeInTheDocument();
});

it("tells the reader when the answer sheet cannot be loaded", async () => {
  stubFetch(() =>
    jsonResponse(403, { error: { code: "FORBIDDEN", message: "Not allowed" } }),
  );
  shell(
    `/attempts/${ATTEMPT}/sheet`,
    "/attempts/:attemptId/sheet",
    <AnswerSheetPage />,
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("lists the attempts of a batch with a link to each answer sheet", async () => {
  const mock = stubFetch(() =>
    jsonResponse(200, {
      items: [
        {
          id: ATTEMPT,
          candidateName: "Asha Devi",
          status: "submitted",
          startedAt: "2026-10-16T04:00:00.000Z",
          closedAt: null,
          obtainedMarks: 1,
          maxMarks: 2,
          scoringComplete: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    }),
  );
  shell(`/b/${BATCH}`, "/b/:id", <BatchReportsSection batchId={BATCH} />);
  expect(await screen.findByText("Asha Devi")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
    "href",
    `/attempts/${ATTEMPT}/sheet`,
  );
  expect(callsTo(mock, "/attempts")).toHaveLength(1);
});

it("downloads the marks file when asked", async () => {
  const createUrl = vi.fn(() => "blob:marks");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke }),
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const mock = stubFetch((u) =>
    u.pathname.endsWith("marks.xlsx")
      ? new Response(new Blob(["x"]), { status: 200 })
      : jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 100 }),
  );
  const user = userEvent.setup();
  shell(`/b/${BATCH}`, "/b/:id", <BatchReportsSection batchId={BATCH} />);
  await user.click(
    await screen.findByRole("button", { name: "Download marks (Excel)" }),
  );
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(callsTo(mock, "/marks.xlsx")).toHaveLength(1);
  click.mockRestore();
});

it("shows the proctoring report with the flag counts and a print button", async () => {
  stubFetch((u) => {
    if (u.pathname.includes("/proctoring/sessions/")) {
      return jsonResponse(200, {
        id: "s".repeat(24),
        attemptId: ATTEMPT,
        batchId: BATCH,
        candidateId: "c".repeat(24),
        candidateName: "Asha Devi",
        status: "ended",
        startedAt: "2026-10-16T04:00:00.000Z",
        lastSeenAt: "2026-10-16T04:30:00.000Z",
        flagCounts: { low: 0, medium: 1, high: 1 },
        unreviewedCount: 1,
        warningCount: 0,
        invalidationRecommended: false,
        paused: false,
        warnings: [],
        lock: null,
        flags: [
          {
            id: "f".repeat(24),
            type: "phone_detected",
            severity: "high",
            capturedAt: "2026-10-16T04:10:00.000Z",
            evidenceId: null,
            detail: null,
            sustainedSeconds: null,
            locationStatus: "not_shared",
            review: null,
          },
        ],
      });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  shell(
    `/proctoring/report/${"s".repeat(24)}`,
    "/proctoring/report/:sessionId",
    <ProctoringReportPage />,
  );
  expect(await screen.findByText("Asha Devi")).toBeInTheDocument();
  expect(screen.getByText("1 high, 1 medium, 0 low")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /Phone detected/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Print or save as PDF" }),
  ).toBeInTheDocument();
});
