import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { batchRecord, IDS, listBody } from "../test/batchFixtures";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

const SUBMITTED = batchRecord({
  id: "66f0000000000000000000b2",
  status: "result_submitted",
  sla: {
    acceptDueAt: null,
    assignDueAt: null,
    resultDueAt: "2026-12-05T18:29:59.999Z",
    breached: [],
    lateActions: [],
  },
});
const VALIDATED = batchRecord({
  id: "66f0000000000000000000b3",
  status: "ab_validated",
  assessmentStartDate: "2026-11-10",
  assessmentEndDate: "2026-11-11",
  sla: {
    acceptDueAt: null,
    assignDueAt: null,
    resultDueAt: "2026-11-25T18:29:59.999Z",
    breached: [],
    lateActions: [],
  },
});

function masterList(items: unknown[]) {
  return jsonResponse(200, { page: 1, pageSize: 100, total: items.length, items });
}

const QUALIFICATION = {
  id: IDS.qualification,
  code: "Q-ELEC-L4",
  name: "Electrician Level 4",
  sector: "Electronics",
  ratioClass: "manufacturing",
  defaultBatchType: "STT",
  passCriteriaMode: null,
  passMarkUnit: "percent",
  passMarks: { theory: 40, practical: 40, viva: 40 },
  maxMarks: null,
  pcPassMarksRequired: false,
  nos: [],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type Handler = (url: URL) => Response | Promise<Response>;

function installFetch(overrides: { batches?: Handler; other?: Handler } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.pathname.endsWith("/batches")) {
      if (overrides.batches) return overrides.batches(url);
      const status = url.searchParams.get("status");
      if (status === "result_submitted") return jsonResponse(200, listBody([SUBMITTED]));
      if (status === "ab_validated") return jsonResponse(200, listBody([VALIDATED]));
      return jsonResponse(400, { error: { code: "VALIDATION_ERROR", message: "Unexpected" } });
    }
    if (overrides.other) {
      const res = overrides.other(url);
      if (res) return res;
    }
    if (url.pathname.endsWith("/qualifications")) return masterList([QUALIFICATION]);
    if (url.pathname.endsWith("/settings/access")) {
      return jsonResponse(200, {
        abReviewerCanReadAssessorPayments: false,
        ncvetViewerCanSeeAbQueue: false,
      });
    }
    return jsonResponse(403, { error: { code: "FORBIDDEN", message: "Role or row scope denied" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function batchCalls(fetchMock: ReturnType<typeof installFetch>): URL[] {
  return fetchMock.mock.calls.map((call) => requestUrl(call[0])).filter((url) => url.pathname.endsWith("/batches"));
}

it("lists both queue statuses, soonest result due first, with a link to each batch", async () => {
  const fetchMock = installFetch();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/ab-queue");

  expect(await screen.findByRole("heading", { name: "AB queue" })).toBeInTheDocument();
  await screen.findByRole("link", { name: SUBMITTED.id });
  const rows = screen.getAllByRole("row");
  // Header plus the two batches. The validated batch is due first.
  expect(rows).toHaveLength(3);
  expect(within(rows[1]).getByRole("link", { name: VALIDATED.id })).toHaveAttribute("href", `/batches/${VALIDATED.id}`);
  expect(within(rows[2]).getByRole("link", { name: SUBMITTED.id })).toHaveAttribute("href", `/batches/${SUBMITTED.id}`);

  const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
  expect(headers).toEqual(["Batch", "Qualification", "Training partner", "Assessment dates", "Status", "Result due"]);
  expect(await within(rows[2]).findByText("Electrician Level 4")).toBeInTheDocument();
  expect(within(rows[2]).getByText(IDS.tp)).toBeInTheDocument();
  expect(within(rows[2]).getByText("2026-11-20 to 2026-11-21")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Result submitted")).toBeInTheDocument();
  expect(within(rows[1]).getByText("AB validated")).toBeInTheDocument();

  const calls = batchCalls(fetchMock);
  expect(calls.map((url) => url.searchParams.get("status")).sort()).toEqual(["ab_validated", "result_submitted"]);
  expect(calls.every((url) => url.searchParams.get("page") === "1" && url.searchParams.get("pageSize") === "20")).toBe(
    true,
  );
  // The own-awarding-body scope is the server's: no abId is sent.
  expect(calls.every((url) => !url.searchParams.has("abId"))).toBe(true);
  expect(screen.getByText("Only batches of your awarding body are listed.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /validate|publish|return/i })).not.toBeInTheDocument();
});

it("filters by one status and by assessment date range, and sends the page size", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/ab-queue");
  await screen.findByRole("link", { name: SUBMITTED.id });

  await user.selectOptions(screen.getByLabelText("Status"), "ab_validated");
  await user.type(screen.getByLabelText("From assessment date"), "2026-11-01");
  await user.type(screen.getByLabelText("To assessment date"), "2026-11-30");
  await user.selectOptions(screen.getByLabelText("Per page"), "50");
  fetchMock.mockClear();
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  await vi.waitFor(() => {
    const calls = batchCalls(fetchMock);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.searchParams.get("status") === "ab_validated")).toBe(true);
    const match = calls.find(
      (url) =>
        url.searchParams.get("from") === "2026-11-01" &&
        url.searchParams.get("to") === "2026-11-30" &&
        url.searchParams.get("pageSize") === "50",
    );
    expect(match).toBeDefined();
  });
  await vi.waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]).getByText("AB validated")).toBeInTheDocument();
});

it("refuses a date range that runs backwards", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/ab-queue");
  await screen.findByRole("link", { name: SUBMITTED.id });

  await user.type(screen.getByLabelText("From assessment date"), "2026-12-01");
  await user.type(screen.getByLabelText("To assessment date"), "2026-11-01");
  fetchMock.mockClear();
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  expect(screen.getByRole("alert")).toHaveTextContent("From must be on or before to.");
  expect(batchCalls(fetchMock)).toHaveLength(0);
});

it("pages through both statuses with page and pageSize", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch({
    batches: (url) => {
      const status = url.searchParams.get("status");
      const page = Number(url.searchParams.get("page"));
      const record = status === "result_submitted" ? SUBMITTED : VALIDATED;
      return jsonResponse(200, listBody(page === 1 ? [record] : [], { page, pageSize: 20, total: 25 }));
    },
  });
  setSession(sessionFor("ab_reviewer"));
  renderApp("/ab-queue");

  expect(await screen.findByText(/Page 1 of 2\./)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("50 batches");
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

  fetchMock.mockClear();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await vi.waitFor(() => {
    const pages = batchCalls(fetchMock).map((url) => url.searchParams.get("page"));
    expect(pages).toEqual(["2", "2"]);
  });
  expect(await screen.findByText(/Page 2 of 2\./)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
});

it("says so when nothing is waiting, and when filters match nothing", async () => {
  const user = userEvent.setup();
  installFetch({ batches: () => jsonResponse(200, listBody([])) });
  setSession(sessionFor("ab_reviewer"));
  renderApp("/ab-queue");
  expect(await screen.findByText("No results are waiting.")).toBeInTheDocument();

  await user.type(screen.getByLabelText("From assessment date"), "2026-11-01");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No batches match these filters.")).toBeInTheDocument();
});

it("shows the server's message when the list fails", async () => {
  installFetch({
    batches: () => jsonResponse(403, { error: { code: "FORBIDDEN", message: "Role or row scope denied" } }),
  });
  setSession(sessionFor("ab_reviewer"));
  renderApp("/ab-queue");
  expect(await screen.findByRole("alert")).toHaveTextContent(/denied|permission|not allowed/i);
});

it.each(["aa_admin", "mis"] as const)("opens read only for %s, with training partner names", async (role) => {
  installFetch({
    other: (url) =>
      url.pathname.endsWith("/training-partners")
        ? masterList([
            {
              id: IDS.tp,
              name: "Pune Skills Trust",
              code: null,
              email: null,
              active: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ])
        : jsonResponse(403, { error: { code: "FORBIDDEN", message: "Role or row scope denied" } }),
  });
  setSession(sessionFor(role));
  renderApp("/ab-queue");

  expect(await screen.findByRole("heading", { name: "AB queue" })).toBeInTheDocument();
  expect(screen.getByText(/Read only\. This view shows every awarding body\./)).toBeInTheDocument();
  expect((await screen.findAllByText("Pune Skills Trust")).length).toBe(2);
  // Not in their navigation, only reachable by address.
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).queryByRole("link", { name: "AB queue" })).not.toBeInTheDocument();
});

it("keeps the AB queue out of every menu (X-38)", async () => {
  installFetch();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/home");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).queryByRole("link", { name: "AB queue" })).not.toBeInTheDocument();
});

it.each(["assessor", "proctor", "candidate", "tp", "sme"] as const)(
  "sends %s away from the queue without asking the server",
  async (role) => {
    const fetchMock = installFetch();
    setSession(sessionFor(role));
    renderApp("/ab-queue");
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AB queue" })).not.toBeInTheDocument();
    expect(batchCalls(fetchMock)).toHaveLength(0);
  },
);

it("sends ncvet_viewer to Home when ncvetViewerCanSeeAbQueue is false", async () => {
  const fetchMock = installFetch({
    other: (url) => {
      if (url.pathname.endsWith("/settings/access")) {
        return jsonResponse(200, {
          abReviewerCanReadAssessorPayments: false,
          ncvetViewerCanSeeAbQueue: false,
        });
      }
      return jsonResponse(404);
    },
  });
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/ab-queue");

  expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "AB queue" })).not.toBeInTheDocument();
  expect(batchCalls(fetchMock)).toHaveLength(0);
});

it("allows ncvet_viewer to open /ab-queue when ncvetViewerCanSeeAbQueue is true", async () => {
  const fetchMock = installFetch({
    other: (url) => {
      if (url.pathname.endsWith("/settings/access")) {
        return jsonResponse(200, {
          abReviewerCanReadAssessorPayments: false,
          ncvetViewerCanSeeAbQueue: true,
        });
      }
      if (url.pathname.endsWith("/training-partners")) {
        return masterList([{ id: IDS.tp, name: "Pune Skills Trust", active: true }]);
      }
      return jsonResponse(404);
    },
  });
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/ab-queue");

  expect(await screen.findByRole("heading", { name: "AB queue" })).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: SUBMITTED.id })).toBeInTheDocument();
  expect(screen.getByText(/Read only. This view shows every awarding body./)).toBeInTheDocument();
  expect(batchCalls(fetchMock).length).toBeGreaterThan(0);
});
