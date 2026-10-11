import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { localDayBound, type AuditLogItem, type AuditLogPage } from "../api/audit";
import { setSession } from "../api/session";
import { ROLE_LABELS, ROLES, type Role } from "../routing/access";
import { sessionFor, jsonResponse } from "../test/fixtures";
import { renderApp } from "../test/render";

const CAN_READ_AUDIT: readonly Role[] = ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"];

function auditItem(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    id: "row-1",
    actorId: "66f0000000000000000000aa",
    actorRole: "aa_admin",
    action: "batch.update",
    entity: "batch",
    entityId: "batch-1",
    abId: null,
    batchId: "batch-1",
    before: { name: "Old name", passwordHash: "***" },
    after: { name: "New name", passwordHash: "***" },
    meta: null,
    ip: null,
    createdAt: "2026-10-01T09:30:00.000Z",
    ...overrides,
  };
}

function auditPage(items: AuditLogItem[], extra: Partial<AuditLogPage> = {}): AuditLogPage {
  return {
    page: 1,
    pageSize: 20,
    total: items.length,
    items,
    ...extra,
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

it.each(ROLES)("shows the audit log only to roles allowed to read it (%s)", async (role) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return jsonResponse(200, auditPage([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  setSession(sessionFor(role));
  renderApp("/audit-logs");

  const allowed = CAN_READ_AUDIT.includes(role);
  if (allowed) {
    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit log" })).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByText(/may not include every entry in the system/i),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => requestUrl(call[0]).pathname.endsWith("/audit-logs"))).toBe(true);
  } else {
    expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Audit log" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  }
});

it("pages with the returned page, pageSize, and total", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const page = Number(requestUrl(input).searchParams.get("page"));
    return jsonResponse(
      200,
      auditPage([auditItem({ id: `row-${page}`, action: `action-${page}`, entityId: `id-${page}` })], {
        page,
        pageSize: 2,
        total: 5,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  setSession(sessionFor("mis"));
  renderApp("/audit-logs");

  expect(await screen.findByText("Page 1 of 3. 2 per page. 5 entries.")).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
    "When",
    "Actor",
    "Action",
    "Entity",
    "Entity id",
    "Changes",
  ]);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.getByRole("cell", { name: "AA admin (66f0000000000000000000aa)" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("cell", { name: "action-2" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Page 2 of 3. 2 per page. 5 entries.");
  expect(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams.get("page")).toBe("2");
  expect(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams.has("pageSize")).toBe(false);

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("cell", { name: "action-3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Previous page" }));
  expect(await screen.findByRole("cell", { name: "action-2" })).toBeInTheDocument();
});

it("sends entity, entity id, and the local date range, then returns to page 1", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const page = Number(requestUrl(input).searchParams.get("page") ?? "1");
    return jsonResponse(
      200,
      auditPage([auditItem({ id: `row-${page}`, action: `action-${page}` })], {
        page,
        pageSize: 2,
        total: 5,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  setSession(sessionFor("aa_admin"));
  renderApp("/audit-logs");

  await user.click(await screen.findByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("cell", { name: "action-2" })).toBeInTheDocument();

  await user.type(screen.getByLabelText("Entity"), "batch");
  await user.type(screen.getByLabelText("Entity id"), "batch-9");
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-02" } });
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  expect(await screen.findByRole("cell", { name: "action-1" })).toBeInTheDocument();
  const params = requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams;
  expect(params.get("entity")).toBe("batch");
  expect(params.get("entityId")).toBe("batch-9");
  expect(params.get("from")).toBe(localDayBound("2026-10-01", "start"));
  expect(params.get("to")).toBe(localDayBound("2026-10-02", "end"));
  expect(params.get("page")).toBe("1");
  expect(params.has("actor")).toBe(false);
  expect(params.has("actorId")).toBe(false);
  expect(params.has("actorRole")).toBe(false);
});

it("keeps an inverted date range off the request", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async () => jsonResponse(200, auditPage([auditItem()])));
  vi.stubGlobal("fetch", fetchMock);
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/audit-logs");
  await screen.findByRole("cell", { name: "batch.update" });
  const callsBefore = fetchMock.mock.calls.length;

  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-05" } });
  fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-01" } });
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The From date must be on or before the To date.");
  expect(fetchMock.mock.calls.length).toBe(callsBefore);
});

it("shows an empty state when the role has no matching entries", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return jsonResponse(200, auditPage([], { total: 0, pageSize: 20 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  setSession(sessionFor("ab_reviewer"));
  renderApp("/audit-logs");

  expect(await screen.findByText("No audit entries are available.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Page 1 of 1. 20 per page. 0 entries.");
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(screen.getAllByRole("columnheader")).toHaveLength(6);

  const user = userEvent.setup();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const entity = requestUrl(input).searchParams.get("entity");
    if (entity) return jsonResponse(200, auditPage([], { total: 0, pageSize: 20 }));
    return jsonResponse(200, auditPage([]));
  });
  await user.type(screen.getByLabelText("Entity"), "result");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No audit entries match these filters.")).toBeInTheDocument();
});

it("announces a load failure and retries", async () => {
  const user = userEvent.setup();
  let fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (fail) {
        return jsonResponse(503, {
          error: { code: "UNAVAILABLE", message: "Audit log is unavailable." },
        });
      }
      return jsonResponse(200, auditPage([auditItem()]));
    }),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/audit-logs");

  expect(await screen.findByRole("alert")).toHaveTextContent("Audit log is unavailable.");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("cell", { name: "batch.update" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("announces that the audit log is loading", async () => {
  let resolveFetch: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => pending),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/audit-logs");

  expect(await screen.findByRole("status")).toHaveTextContent("Loading audit log.");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  resolveFetch(jsonResponse(200, auditPage([auditItem()])));
  expect(await screen.findByRole("cell", { name: "batch.update" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Page 1 of 1. 20 per page. 1 entry.");
});

it("opens a keyboard-reachable before and after view", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, auditPage([auditItem()]))));
  setSession(sessionFor("aa_admin"));
  renderApp("/audit-logs");

  const button = await screen.findByRole("button", {
    name: "Before and after for batch.update on batch batch-1",
  });
  expect(button).toHaveAttribute("aria-expanded", "false");
  await user.click(button);

  const region = screen.getByRole("region", { name: "Before and after for batch.update on batch batch-1" });
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(region).toHaveFocus();
  expect(within(region).getByText("Changed fields: name")).toBeInTheDocument();
  expect(within(region).getByText("Old name")).toBeInTheDocument();
  expect(within(region).getByText("New name")).toBeInTheDocument();
  expect(within(region).getAllByText("***")).toHaveLength(2);

  await user.keyboard("{Escape}");
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button).toHaveFocus();
  expect(
    screen.queryByRole("region", { name: "Before and after for batch.update on batch batch-1" }),
  ).not.toBeInTheDocument();
});
