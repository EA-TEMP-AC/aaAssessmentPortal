import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { createQueryClient } from "../queryClient";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";
import { batchRecord } from "../test/batchFixtures";
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
import { ExamPage } from "./ExamPage";

function batch() {
  return batchRecord({ id: BATCH_ID, status: "in_progress" });
}

function list(items: unknown[]) {
  return { page: 1, pageSize: 100, total: items.length, items };
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

function renderPage() {
  setSession(sessionFor("candidate"));
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ExamPage frameCheck={{ sample: () => frame(150), attempts: 2, intervalMs: 1 }} autosaveDebounceMs={20} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("lists the candidate's in-progress batches", async () => {
  const mock = stubFetch(() => jsonResponse(200, list([batch()])));
  setSession(sessionFor("candidate"));
  renderApp("/exam");
  expect(await screen.findByRole("heading", { name: `Batch ${BATCH_ID}` })).toBeInTheDocument();
  expect(screen.getByText("Electronics")).toBeInTheDocument();
  const query = new URL(String(callsTo(mock, "/batches")[0][0]), "http://localhost").searchParams;
  expect(query.get("status")).toBe("in_progress");
});

it("shows loading, then an empty state", async () => {
  stubFetch(() => jsonResponse(200, list([])));
  setSession(sessionFor("candidate"));
  renderApp("/exam");
  expect(screen.getByText("Loading your batches…")).toBeInTheDocument();
  expect(await screen.findByText(/no batches in progress/)).toBeInTheDocument();
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
  expect(await screen.findByText(/no batches in progress/)).toBeInTheDocument();
});

it("is only open to candidates", async () => {
  stubFetch(() => jsonResponse(200, list([])));
  setSession(sessionFor("assessor"));
  renderApp("/exam");
  expect(screen.queryByRole("heading", { name: "Exam" })).not.toBeInTheDocument();
});

it("checks the paper code before going on", async () => {
  const user = userEvent.setup();
  stubFetch(() => jsonResponse(200, list([batch()])));
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Continue to the camera check" }));
  expect(screen.getByText(/Enter the 24-character paper code/)).toBeInTheDocument();
  expect(screen.getByLabelText("Paper code")).toHaveAttribute("aria-invalid", "true");
});

it("runs the whole flow: pre-check, start, answer, submit, finished", async () => {
  const user = userEvent.setup();
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const mock = stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/batches")) return jsonResponse(200, list([batch()]));
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

  await user.type(await screen.findByLabelText("Paper code"), PAPER_ID.toUpperCase());
  await user.click(screen.getByRole("button", { name: "Continue to the camera check" }));
  expect(screen.getByRole("heading", { name: `Before you start: Batch ${BATCH_ID}` })).toHaveFocus();
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("Camera check passed.");
  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  await user.click(screen.getByRole("button", { name: "Start exam" }));

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

it("shows a start error on the pre-check screen and lets the candidate go back", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/batches")) return jsonResponse(200, list([batch()]));
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    return jsonResponse(200, { status: "ok" });
  });
  renderPage();

  await user.type(await screen.findByLabelText("Paper code"), PAPER_ID);
  await user.click(screen.getByRole("button", { name: "Continue to the camera check" }));
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("Camera check passed.");
  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  await user.click(screen.getByRole("button", { name: "Start exam" }));

  expect(await screen.findByText(/paper code was not found/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start exam" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Back to my exams" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Exam" })).toBeInTheDocument());
});

it("goes straight to the finished screen for an attempt that is already closed", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  stubFetch((u) => {
    if (u.pathname.endsWith("/batches")) return jsonResponse(200, list([batch()]));
    if (u.pathname.endsWith("/attempts/start")) return jsonResponse(200, attemptBody({ status: "submitted" }));
    return jsonResponse(200, { status: "ok" });
  });
  renderPage();
  await user.type(await screen.findByLabelText("Paper code"), PAPER_ID);
  await user.click(screen.getByRole("button", { name: "Continue to the camera check" }));
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("Camera check passed.");
  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  await user.click(screen.getByRole("button", { name: "Start exam" }));
  expect(await screen.findByRole("heading", { name: "This exam is closed" })).toBeInTheDocument();
});
