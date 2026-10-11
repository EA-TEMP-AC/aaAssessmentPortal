import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { ACTION_CASES, batchRecord, listBody } from "../test/batchFixtures";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";
import type { Role } from "../routing/access";
import { ROLE_LABELS } from "../routing/access";

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it.each(["aa_admin", "mis", "assessor", "tp", "ab_reviewer", "ncvet_viewer"] as const)(
  "loads the batch list for %s",
  async (role) => {
    installFetch(async () => jsonResponse(200, listBody([])));
    setSession(sessionFor(role));
    renderApp("/batches");
    expect(await screen.findByRole("heading", { name: "Batches" })).toBeInTheDocument();
  },
);

it.each(["sme"] as const)("hides batches from %s", async (role) => {
  installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor(role));
  renderApp("/batches");
  expect(await screen.findByRole("heading", { name: ROLE_LABELS[role as Role] })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Batches" })).not.toBeInTheDocument();
});

it("shows create only to aa_admin and ab_reviewer", async () => {
  installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor("aa_admin"));
  const first = renderApp("/batches");
  expect(await screen.findByRole("link", { name: "Create batch" })).toBeInTheDocument();
  first.unmount();
  setSession(sessionFor("mis"));
  renderApp("/batches");
  expect(await screen.findByRole("heading", { name: "Batches" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Create batch" })).not.toBeInTheDocument();
});

it("sends status, date range, training partner, and page size filters", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url) => {
    if (url.pathname.endsWith("/batches")) return jsonResponse(200, listBody([]));
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Missing" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/batches");
  await screen.findByRole("heading", { name: "Batches" });

  await user.selectOptions(screen.getByLabelText("Status"), "allocated");
  await user.type(screen.getByLabelText("From assessment date"), "2026-11-01");
  await user.type(screen.getByLabelText("To assessment date"), "2026-11-30");
  await user.type(screen.getByLabelText("Training partner id"), "66f0000000000000000000tp");
  await user.selectOptions(screen.getByLabelText("Per page"), "50");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  await vi.waitFor(() => {
    const urls = fetchMock.mock.calls.map((call) => requestUrl(call[0]));
    expect(
      urls.some((url) => {
        return (
          url.pathname.endsWith("/batches") &&
          url.searchParams.get("status") === "allocated" &&
          url.searchParams.get("from") === "2026-11-01" &&
          url.searchParams.get("to") === "2026-11-30" &&
          url.searchParams.get("tpId") === "66f0000000000000000000tp" &&
          url.searchParams.get("pageSize") === "50"
        );
      }),
    ).toBe(true);
  });
});

it("pages to the next list", async () => {
  const user = userEvent.setup();
  const first = batchRecord({ id: "66f0000000000000000000b1" });
  const second = batchRecord({ id: "66f0000000000000000000b2" });
  const fetchMock = installFetch(async (url) => {
    if (!url.pathname.endsWith("/batches")) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Missing" } });
    }
    if (url.searchParams.get("page") === "2") {
      return jsonResponse(200, listBody([second], { page: 2, pageSize: 20, total: 21 }));
    }
    return jsonResponse(200, listBody([first], { page: 1, pageSize: 20, total: 21 }));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/batches");
  expect(await screen.findByText("66f0000000000000000000b1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByText("66f0000000000000000000b2")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some((call) => requestUrl(call[0]).searchParams.get("page") === "2"),
  ).toBe(true);
});

it("shows overdue, due-soon, and on-track SLA states with text and icons", async () => {
  const overdue = batchRecord({
    id: "66f0000000000000000000b1",
    sla: {
      acceptDueAt: "2000-01-01T00:00:00.000Z",
      assignDueAt: "2000-01-02T00:00:00.000Z",
      resultDueAt: "2099-02-01T00:00:00.000Z",
      breached: ["accept"],
      lateActions: [],
    },
  });
  const onTrack = batchRecord({
    id: "66f0000000000000000000b2",
    sla: {
      acceptDueAt: "2099-01-01T00:00:00.000Z",
      assignDueAt: "2099-01-08T00:00:00.000Z",
      resultDueAt: "2099-02-01T00:00:00.000Z",
      breached: [],
      lateActions: [],
    },
  });
  installFetch(async () => jsonResponse(200, listBody([overdue, onTrack])));
  setSession(sessionFor("aa_admin"));
  renderApp("/batches");
  const overdueRow = await screen.findByRole("row", { name: /66f0000000000000000000b1/ });
  expect(within(overdueRow).getByText(/Accept SLA: Overdue/)).toBeInTheDocument();
  expect(within(overdueRow).getAllByText(/■/).length).toBeGreaterThan(0);
  const okRow = screen.getByRole("row", { name: /66f0000000000000000000b2/ });
  expect(within(okRow).getByText(/Accept SLA: On track/)).toBeInTheDocument();
  expect(within(okRow).getAllByText(/●/).length).toBeGreaterThan(0);
});

it("does not show action buttons on the list", async () => {
  installFetch(async () => jsonResponse(200, listBody([batchRecord()])));
  setSession(sessionFor("aa_admin"));
  renderApp("/batches");
  await screen.findByRole("heading", { name: "Batches" });
  expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  expect(ACTION_CASES.length).toBeGreaterThan(0);
});
