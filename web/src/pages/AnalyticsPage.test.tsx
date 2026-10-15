import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultRange, validateRange } from "../api/analytics";
import { setSession } from "../api/session";
import type { Role } from "../routing/access";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const SUMMARY = {
  from: "2026-07-18",
  to: "2026-10-15",
  batches: { total: 4, byStatus: { allocated: 1, published: 3, cancelled: 0 } },
  publishedResults: { total: 3, onTime: 2, late: 1 },
  learnersAssessed: 7,
  passRate: 0.7143,
  slaBreaches: 2,
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    name: "Assessor One",
    code: "AS-1",
    batches: 2,
    publishedBatches: 2,
    learnersAssessed: 5,
    passed: 3,
    failed: 2,
    absent: 1,
    passRate: 0.6,
    avgTurnaroundDays: 2.25,
    slaBreaches: 1,
    ...over,
  };
}

function listBody(items: unknown[], over: Record<string, unknown> = {}) {
  return { from: "2026-07-18", to: "2026-10-15", page: 1, pageSize: 10, total: items.length, items, ...over };
}

type Handler = (url: URL) => Response | undefined;

function installFetch(handler: Handler = () => undefined) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const custom = handler(url);
    if (custom) return custom;
    if (url.pathname.endsWith("/analytics/summary")) return jsonResponse(200, SUMMARY);
    if (url.pathname.includes("/analytics/by-")) return jsonResponse(200, listBody([row()]));
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "No" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function analyticsCalls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls
    .map((call) => new URL(String(call[0]), "http://localhost"))
    .filter((url) => url.pathname.includes("/analytics/"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("defaults to the last 90 days in IST", () => {
  expect(defaultRange(new Date("2026-10-15T08:00:00Z"))).toEqual({ from: "2026-07-18", to: "2026-10-15" });
  // 20:00 UTC on the 15th is already the 16th in IST.
  expect(defaultRange(new Date("2026-10-15T20:00:00Z")).to).toBe("2026-10-16");
});

it("validates the range the way the server does", () => {
  expect(validateRange("2026-01-01", "2026-01-01")).toBeNull();
  expect(validateRange("2026-01-01", "2028-12-31")).toBeNull();
  expect(validateRange("2026-01-02", "2026-01-01")).toMatch(/on or before/);
  expect(validateRange("2026-01-01", "2029-01-01")).toMatch(/shorter than 3 years/);
  expect(validateRange("", "2026-01-01")).toMatch(/real calendar dates/);
  expect(validateRange("2026-02-30", "2026-03-01")).toMatch(/real calendar dates/);
});

it.each<Role>(["aa_admin", "mis", "ncvet_viewer", "ab_reviewer"])("opens for %s and asks the default range", async (role) => {
  const fetchMock = installFetch();
  setSession(sessionFor(role));
  renderApp("/analytics");
  expect(await screen.findByRole("heading", { name: "Analytics" })).toBeInTheDocument();
  await screen.findByText("Learners assessed");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Analytics" })).toHaveAttribute("href", "/analytics");
  const summary = analyticsCalls(fetchMock).find((u) => u.pathname.endsWith("/summary"));
  expect(summary?.searchParams.get("from")).toBe("2026-07-18");
  expect(summary?.searchParams.get("to")).toBe("2026-10-15");
});

it.each<Role>(["sme", "assessor", "proctor", "candidate", "tp"])("sends %s to Home without any request", async (role) => {
  const fetchMock = installFetch();
  setSession(sessionFor(role));
  renderApp("/analytics");
  expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Analytics" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("navigation", { name: "Primary" })).queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
  expect(analyticsCalls(fetchMock)).toHaveLength(0);
});

it("shows the summary as stat tiles", async () => {
  installFetch();
  setSession(sessionFor("aa_admin"));
  renderApp("/analytics");
  await screen.findByText("Learners assessed", { selector: "dt" });
  const tile = async (label: string) => screen.getByText(label, { selector: "dt" }).closest(".stat-tile") as HTMLElement;
  expect(within(await tile("Batches")).getByText("4")).toBeInTheDocument();
  expect(within(await tile("Batches published")).getByText("3")).toBeInTheDocument();
  expect(within(await tile("Published on time")).getByText("2")).toBeInTheDocument();
  expect(within(await tile("Published late")).getByText("1")).toBeInTheDocument();
  expect(within(await tile("Learners assessed")).getByText("7")).toBeInTheDocument();
  expect(within(await tile("Pass rate")).getByText("71.4%")).toBeInTheDocument();
  expect(within(await tile("SLA breaches")).getByText("2")).toBeInTheDocument();
});

it("refuses a backwards range and a range of 3 years before any request", async () => {
  const fetchMock = installFetch();
  setSession(sessionFor("mis"));
  renderApp("/analytics");
  await screen.findByText("Learners assessed");
  const before = analyticsCalls(fetchMock).length;

  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-16" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
  await userEvent.click(screen.getByRole("button", { name: "Apply range" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The From date must be on or before the To date.");
  expect(screen.getByLabelText("From")).toHaveAttribute("aria-invalid", "true");

  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2023-10-15" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-15" } });
  await userEvent.click(screen.getByRole("button", { name: "Apply range" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("shorter than 3 years");

  expect(analyticsCalls(fetchMock)).toHaveLength(before);
});

it("asks again for a valid new range", async () => {
  const fetchMock = installFetch();
  setSession(sessionFor("mis"));
  renderApp("/analytics");
  await screen.findByText("Learners assessed");

  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
  await userEvent.click(screen.getByRole("button", { name: "Apply range" }));

  await waitFor(() =>
    expect(
      analyticsCalls(fetchMock).some(
        (u) => u.pathname.endsWith("/summary") && u.searchParams.get("from") === "2026-01-01" && u.searchParams.get("to") === "2026-03-31",
      ),
    ).toBe(true),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

const TABS = [
  ["By assessor", "by-assessor", "Assessor"],
  ["By training partner", "by-training-partner", "Training partner"],
  ["By job role", "by-job-role", "Job role"],
  ["By state", "by-state", "State"],
] as const;

it.each(TABS)("shows the %s tab with a table and a chart", async (tabName, path, noun) => {
  const fetchMock = installFetch((url) =>
    url.pathname.endsWith(`/analytics/${path}`)
      ? jsonResponse(200, listBody([row({ id: "a", name: `${noun} Alpha`, code: null, batches: 5, passRate: 0.8 }), row({ id: "b", name: `${noun} Beta`, code: null, batches: 3, passRate: null, learnersAssessed: 0 })]))
      : undefined,
  );
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/analytics");
  await screen.findByText("Learners assessed");

  await userEvent.click(screen.getByRole("tab", { name: tabName }));
  expect(screen.getByRole("tab", { name: tabName })).toHaveAttribute("aria-selected", "true");
  const panel = await screen.findByRole("tabpanel");
  const table = await within(panel).findByRole("table");
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent(`${noun} Alpha`);
  expect(within(rows[1]).getByText("80.0%")).toBeInTheDocument();
  expect(within(rows[2]).getAllByText("No data").length).toBeGreaterThan(0);
  expect(within(table).getByRole("columnheader", { name: noun })).toBeInTheDocument();

  const chart = within(panel).getByRole("img");
  expect(chart.getAttribute("aria-label")).toContain(`${noun} Alpha: 80.0%`);
  expect(chart.getAttribute("aria-label")).toContain(`${noun} Beta: no data`);
  expect(within(panel).getByText("Pass rate (%)")).toBeInTheDocument();
  expect(within(panel).getAllByText(noun).length).toBeGreaterThan(0);

  await userEvent.click(within(panel).getByRole("radio", { name: "Batches" }));
  expect(within(panel).getByRole("img").getAttribute("aria-label")).toContain(`${noun} Alpha: 5`);
  expect(within(panel).getByText("Batches in range")).toBeInTheDocument();

  expect(analyticsCalls(fetchMock).some((u) => u.pathname.endsWith(`/${path}`) && u.searchParams.get("pageSize") === "10")).toBe(true);
});

it("moves between tabs with the arrow keys", async () => {
  installFetch();
  setSession(sessionFor("aa_admin"));
  renderApp("/analytics");
  await screen.findByText("Learners assessed");
  const first = screen.getByRole("tab", { name: "By assessor" });
  first.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "By training partner" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "By training partner" })).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "By state" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "By assessor" })).toHaveFocus();
});

it("pages the table and keeps the chart on the top 10", async () => {
  const fetchMock = installFetch((url) => {
    if (!url.pathname.endsWith("/by-assessor")) return undefined;
    const page = Number(url.searchParams.get("page"));
    return jsonResponse(200, listBody([row({ id: `p${page}`, name: `Page ${page} person` })], { page, total: 11 }));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/analytics");
  expect(await screen.findByRole("rowheader", { name: "Page 1 person (AS-1)" })).toBeInTheDocument();
  expect(screen.getByText(/Page 1 of 2\. 11 rows/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("rowheader", { name: "Page 2 person (AS-1)" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Page 1 person");
  expect(analyticsCalls(fetchMock).some((u) => u.searchParams.get("page") === "2")).toBe(true);
});

it("shows empty states", async () => {
  installFetch((url) => {
    if (url.pathname.endsWith("/summary")) {
      return jsonResponse(200, { ...SUMMARY, batches: { total: 0, byStatus: {} }, publishedResults: { total: 0, onTime: 0, late: 0 }, learnersAssessed: 0, passRate: null, slaBreaches: 0 });
    }
    return jsonResponse(200, listBody([]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/analytics");
  expect(await screen.findByText(/No batches start between 2026-07-18 and 2026-10-15/)).toBeInTheDocument();
  expect(await screen.findByText(/No assessor figures for 2026-07-18 to 2026-10-15/)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("shows a null pass rate as no data", async () => {
  installFetch((url) =>
    url.pathname.endsWith("/summary") ? jsonResponse(200, { ...SUMMARY, learnersAssessed: 0, passRate: null }) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/analytics");
  const tile = (await screen.findByText("Pass rate", { selector: "dt" })).closest(".stat-tile") as HTMLElement;
  expect(within(tile).getByText("No data")).toBeInTheDocument();
});

it("shows an error for the summary and for a tab without hiding the other", async () => {
  installFetch((url) => {
    if (url.pathname.endsWith("/summary")) {
      return jsonResponse(403, { error: { code: "FORBIDDEN", message: "Reviewer has no awarding body" } });
    }
    if (url.pathname.endsWith("/by-assessor")) return jsonResponse(500, { error: { code: "INTERNAL", message: "Aggregation failed" } });
    return undefined;
  });
  setSession(sessionFor("ab_reviewer"));
  renderApp("/analytics");
  expect(await screen.findByText("Reviewer has no awarding body")).toBeInTheDocument();
  expect(await screen.findByText("Aggregation failed")).toBeInTheDocument();
  expect(screen.getAllByRole("alert")).toHaveLength(2);

  await userEvent.click(screen.getByRole("tab", { name: "By state" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
});
