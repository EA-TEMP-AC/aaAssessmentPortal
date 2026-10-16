import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";
import { BATCH_ID, callsTo, PAPER_ID, stubFetch } from "../test/examFixtures";

const BATCH_NAME = "ELE/Q0001 Field Technician, 2026-10-15 to 2026-10-17";

function available(overrides: Record<string, unknown> = {}) {
  return {
    batchId: BATCH_ID,
    batchName: BATCH_NAME,
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

const attempt = (status: string, remainingSeconds: number | null = null) => ({
  id: "a1",
  status,
  startedAt: "2026-10-15T04:00:00.000Z",
  deadline: "2026-10-15T04:30:00.000Z",
  remainingSeconds,
});

function stubList(items: unknown[]) {
  return stubFetch(() => jsonResponse(200, { items }));
}

const MIXED = [
  available({ paperId: "p1", paperName: "Paper one" }),
  available({
    paperId: "p2",
    paperName: "Paper two",
    attempt: attempt("in_progress", 754),
  }),
  available({
    paperId: "p3",
    paperName: "Paper three",
    attempt: attempt("submitted"),
    startable: { ok: false, reason: "ATTEMPT_CLOSED" },
  }),
  available({
    paperId: "p4",
    paperName: "Paper four",
    attempt: attempt("timed_out"),
    startable: { ok: false, reason: "ATTEMPT_CLOSED" },
  }),
  available({
    paperId: "p5",
    paperName: "Paper five",
    batchName: "Second batch",
    startable: { ok: false, reason: "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW" },
  }),
];

function renderDashboard() {
  setSession(sessionFor("candidate"));
  return renderApp("/exam");
}

const card = (name: string) => within(screen.getByRole("heading", { name, level: 3 }).closest("li") as HTMLElement);

beforeEach(() => {
  Object.defineProperty(window, "screen", {
    value: { availWidth: 1440, availHeight: 860 },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearSession();
});

it("has Upcoming, Ongoing and Completed tabs with counts, and puts each assessment in the right one", async () => {
  const user = userEvent.setup();
  stubList(MIXED);
  renderDashboard();

  const upcoming = await screen.findByRole("tab", { name: "Upcoming (2)" });
  expect(upcoming).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Ongoing (1)" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Completed (2)" })).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Paper one", "Paper five"]);

  await user.click(screen.getByRole("tab", { name: "Ongoing (1)" }));
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Paper two"]);

  await user.click(screen.getByRole("tab", { name: "Completed (2)" }));
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Paper three", "Paper four"]);
});

it("shows paper, batch, dates, time window and duration on each card, with one button per state", async () => {
  const user = userEvent.setup();
  stubList(MIXED);
  renderDashboard();
  await screen.findByRole("heading", { name: "Paper one", level: 3 });

  const one = card("Paper one");
  expect(one.getByText(BATCH_NAME)).toBeInTheDocument();
  expect(one.getByText("15 Oct 2026")).toBeInTheDocument();
  expect(one.getByText("17 Oct 2026")).toBeInTheDocument();
  expect(one.getByText("All day, Indian time")).toBeInTheDocument();
  expect(one.getByText("30 minutes")).toBeInTheDocument();
  expect(one.getByText("English")).toBeInTheDocument();
  expect(one.getByRole("button", { name: "Start exam Paper one" })).toBeEnabled();
  expect(one.getAllByRole("button")).toHaveLength(1);

  const five = card("Paper five");
  const fiveButton = five.getByRole("button", { name: "Start exam Paper five" });
  expect(fiveButton).toBeDisabled();
  expect(fiveButton).toHaveAccessibleDescription(/Not available now: today is outside the assessment dates/);

  await user.click(screen.getByRole("tab", { name: /Ongoing/ }));
  const two = card("Paper two");
  expect(two.getByText(/About 13 minutes left/)).toBeInTheDocument();
  expect(two.getByRole("button", { name: "Resume Paper two" })).toBeEnabled();

  await user.click(screen.getByRole("tab", { name: /Completed/ }));
  expect(card("Paper three").getByText("Submitted.")).toBeInTheDocument();
  expect(card("Paper three").getByRole("button", { name: "Completed Paper three" })).toBeDisabled();
  expect(card("Paper four").getByText(/Timed out/)).toBeInTheDocument();
  expect(card("Paper four").getByRole("button", { name: "Completed Paper four" })).toBeDisabled();
});

it("searches by paper or batch name and says when nothing matches", async () => {
  const user = userEvent.setup();
  stubList(MIXED);
  renderDashboard();
  await screen.findByRole("heading", { name: "Paper one", level: 3 });

  await user.type(screen.getByRole("searchbox", { name: "Search assessments" }), "second batch");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Paper five"]);
  expect(screen.getByRole("tab", { name: "Upcoming (1)" })).toBeInTheDocument();

  await user.clear(screen.getByRole("searchbox", { name: "Search assessments" }));
  await user.type(screen.getByRole("searchbox", { name: "Search assessments" }), "zzz");
  expect(screen.getByText("No assessments match your search.")).toBeInTheDocument();
});

it("switches between grid and list", async () => {
  const user = userEvent.setup();
  stubList(MIXED);
  renderDashboard();
  await screen.findByRole("heading", { name: "Paper one", level: 3 });
  const grid = screen.getByRole("button", { name: "Grid view" });
  const list = screen.getByRole("button", { name: "List view" });
  expect(grid).toHaveAttribute("aria-pressed", "true");
  expect(list).toHaveAttribute("aria-pressed", "false");
  const cards = () => screen.getByRole("heading", { name: "Paper one", level: 3 }).closest("ul") as HTMLElement;
  expect(cards()).toHaveClass("exam-cards-grid");
  await user.click(list);
  expect(list).toHaveAttribute("aria-pressed", "true");
  expect(cards()).toHaveClass("exam-cards-list");
});

it("moves between tabs with the arrow keys", async () => {
  const user = userEvent.setup();
  stubList(MIXED);
  renderDashboard();
  const first = await screen.findByRole("tab", { name: /Upcoming/ });
  first.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: /Ongoing/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: /Ongoing/ })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: /Completed/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: /Upcoming/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: /Upcoming/ })).toBeVisible();
});

it("shows loading, then a message for each empty tab", async () => {
  const user = userEvent.setup();
  stubList([]);
  renderDashboard();
  expect(screen.getByText("Loading your assessments…")).toBeInTheDocument();
  expect(await screen.findByText("No upcoming assessments right now.")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: /Ongoing/ }));
  expect(screen.getByText("No exam is in progress.")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: /Completed/ }));
  expect(screen.getByText("No completed assessments yet.")).toBeInTheDocument();
});

it("shows an error in the open tab with a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  stubFetch(() =>
    fail ? jsonResponse(500, { error: { code: "INTERNAL", message: "Server error" } }) : jsonResponse(200, { items: [] }),
  );
  renderDashboard();
  await user.click(await screen.findByRole("tab", { name: /Completed/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No completed assessments yet.")).toBeInTheDocument();
});

it("opens the exam in a new, screen-sized window with no toolbar, straight from the click", async () => {
  const user = userEvent.setup();
  const mock = stubList(MIXED);
  const child = { closed: false, moveTo: vi.fn(), resizeTo: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(child as unknown as Window);
  renderDashboard();

  await user.click(await screen.findByRole("button", { name: "Start exam Paper one" }));
  expect(open).toHaveBeenCalledTimes(1);
  const [url, , features] = open.mock.calls[0];
  expect(url).toBe(`/exam/window/${BATCH_ID}/p1`);
  expect(features).toContain("width=1440");
  expect(features).toContain("height=860");
  expect(features).toContain("left=0");
  expect(features).toContain("top=0");
  expect(features).toContain("toolbar=no");
  expect(features).toContain("location=no");
  expect(features).not.toContain("fullscreen");
  expect(child.moveTo).toHaveBeenCalledWith(0, 0);
  expect(child.resizeTo).toHaveBeenCalledWith(1440, 860);
  expect(screen.getByRole("status")).toHaveTextContent("Paper one is open in another window");
  // The click does not start the attempt: that happens in the exam window after the checks.
  expect(callsTo(mock, "/attempts/start", "POST")).toHaveLength(0);
});

it("opens the same window for Resume", async () => {
  const user = userEvent.setup();
  stubList(MIXED);
  const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as unknown as Window);
  renderDashboard();
  await user.click(await screen.findByRole("tab", { name: /Ongoing/ }));
  await user.click(screen.getByRole("button", { name: "Resume Paper two" }));
  expect(open.mock.calls[0][0]).toBe(`/exam/window/${BATCH_ID}/p2`);
});

it("says so when the pop-up is blocked and lets the candidate try again", async () => {
  const user = userEvent.setup();
  stubList(MIXED);
  const open = vi.spyOn(window, "open").mockReturnValueOnce(null);
  renderDashboard();

  await user.click(await screen.findByRole("button", { name: "Start exam Paper one" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/browser blocked the exam window/);
  expect(alert).toHaveTextContent(/Allow pop-ups/);
  expect(screen.queryByText(/is open in another window/)).not.toBeInTheDocument();

  open.mockReturnValue({ closed: false } as unknown as Window);
  await user.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(open).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Paper one is open in another window");
});

it("reads the list again when the exam window closes", async () => {
  const user = userEvent.setup();
  const mock = stubList(MIXED);
  const child = { closed: false };
  vi.spyOn(window, "open").mockReturnValue(child as unknown as Window);
  renderDashboard();
  await user.click(await screen.findByRole("button", { name: "Start exam Paper one" }));
  expect(callsTo(mock, "/attempts/available")).toHaveLength(1);
  child.closed = true;
  await screen.findByRole("tab", { name: /Upcoming/ });
  await vi.waitFor(() => expect(callsTo(mock, "/attempts/available")).toHaveLength(2), { timeout: 4000 });
  expect(screen.queryByText(/is open in another window/)).not.toBeInTheDocument();
});

it("is only open to candidates", async () => {
  stubList([]);
  setSession(sessionFor("assessor"));
  renderApp("/exam");
  expect(screen.queryByRole("heading", { name: "Exam" })).not.toBeInTheDocument();
});
