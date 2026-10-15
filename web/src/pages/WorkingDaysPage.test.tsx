import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { ROLE_LABELS, type Role } from "../routing/access";
import { buildHoliday } from "./workingDayWrite";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const DENIED: readonly Role[] = ["sme", "assessor", "proctor", "candidate", "tp", "ab_reviewer", "ncvet_viewer"];
const ALLOWED: readonly Role[] = ["aa_admin", "mis"];

const CONFIG = { weekendDays: [6, 0], timezone: "Asia/Kolkata" };
const HOLIDAY_ID = "66f0000000000000000000aa";

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function methodOf(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function requestBody(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== "string") return undefined;
  return JSON.parse(init.body);
}

function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function holidayGets(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter((call) => {
    const url = requestUrl(call[0] ?? "");
    return url.pathname === "/api/v1/admin/holidays" && methodOf(call[1]) === "GET";
  });
}

function installReads(holidays: { id: string; date: string; name: string; region: string | null }[] = []) {
  return installFetch(async (url) => {
    if (url.pathname === "/api/v1/admin/working-day-config") return jsonResponse(200, CONFIG);
    if (url.pathname === "/api/v1/admin/holidays") return jsonResponse(200, { items: holidays });
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
}

it("sends a blank holiday region as null", () => {
  expect(buildHoliday({ date: "2026-10-02", name: "  Gandhi Jayanti ", region: "  " })).toEqual({
    ok: true,
    body: { date: "2026-10-02", name: "Gandhi Jayanti", region: null },
  });
  expect(buildHoliday({ date: "2026-10-02", name: "State holiday", region: " MH " })).toEqual({
    ok: true,
    body: { date: "2026-10-02", name: "State holiday", region: "MH" },
  });
});

it.each(DENIED)("hides working days from %s", async (role) => {
  const fetchMock = installReads();
  setSession(sessionFor(role));
  renderApp("/working-days");

  expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Working days" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Working days" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter((call) => !String(call[0]).endsWith("/settings/access"))).toHaveLength(0);
});

it.each(ALLOWED)("shows working-day settings to %s", async (role) => {
  installReads();
  setSession(sessionFor(role));
  renderApp("/working-days");

  expect(await screen.findByRole("heading", { name: "Weekend days" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Working days" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Kolkata");
  expect(screen.getByLabelText("Timezone")).toHaveAttribute("readonly");
  expect(screen.getByRole("checkbox", { name: "Sunday" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Saturday" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Monday" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save weekend days" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Add holiday" })).toBeEnabled();
  expect(screen.getByText(/Changing weekend days does not rewrite accept, assign, or result due dates/)).toBeInTheDocument();
  expect(screen.getByText(/Batches do not use it yet/)).toBeInTheDocument();
});

it("saves weekend days from the keyboard and keeps the timezone read-only", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url, init) => {
    if (methodOf(init) === "PUT") {
      return jsonResponse(200, {
        id: "66f0000000000000000000bb",
        weekendDays: [5, 6],
        timezone: "Asia/Kolkata",
      });
    }
    if (url.pathname === "/api/v1/admin/working-day-config") return jsonResponse(200, CONFIG);
    if (url.pathname === "/api/v1/admin/holidays") return jsonResponse(200, { items: [] });
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/working-days");

  const friday = await screen.findByRole("checkbox", { name: "Friday" });
  friday.focus();
  await user.keyboard(" ");
  expect(friday).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Sunday" }));
  await user.click(screen.getByRole("button", { name: "Save weekend days" }));

  expect(
    await screen.findByText(
      "Weekend days were saved. This does not rewrite accept, assign, or result due dates already stored on existing batches.",
    ),
  ).toBeInTheDocument();
  const put = fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "PUT");
  expect(put).toHaveLength(1);
  expect(requestUrl(put[0]?.[0] ?? "").pathname).toBe("/api/v1/admin/working-day-config");
  expect(requestBody(put[0]?.[1])).toEqual({ weekendDays: [5, 6] });
  expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Kolkata");
  expect(screen.getByRole("checkbox", { name: "Friday" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sunday" })).not.toBeChecked();
});

it("blocks a weekend selection that leaves no working day", async () => {
  const user = userEvent.setup();
  const fetchMock = installReads();
  setSession(sessionFor("mis"));
  renderApp("/working-days");

  expect(await screen.findByRole("checkbox", { name: "Monday" })).toBeInTheDocument();
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
    await user.click(screen.getByRole("checkbox", { name: day }));
  }
  await user.click(screen.getByRole("button", { name: "Save weekend days" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Leave at least one working day.");
  expect(screen.getByRole("group", { name: "Weekend days" })).toHaveFocus();
  expect(fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "PUT")).toHaveLength(0);
});

it("shows a server validation error for weekend days", async () => {
  const user = userEvent.setup();
  installFetch(async (url, init) => {
    if (methodOf(init) === "PUT") {
      return jsonResponse(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: { weekendDays: ["weekendDays must be unique"] },
        },
      });
    }
    if (url.pathname === "/api/v1/admin/working-day-config") return jsonResponse(200, CONFIG);
    if (url.pathname === "/api/v1/admin/holidays") return jsonResponse(200, { items: [] });
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/working-days");

  await screen.findByRole("button", { name: "Save weekend days" });
  await user.click(screen.getByRole("button", { name: "Save weekend days" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("VALIDATION_ERROR");
  expect(alert).toHaveTextContent("weekendDays must be unique");
  expect(screen.getByRole("group", { name: "Weekend days" })).toHaveAttribute("aria-invalid", "true");
});

it("adds a holiday and deletes it after confirmation", async () => {
  const user = userEvent.setup();
  const items: { id: string; date: string; name: string; region: string | null }[] = [];
  const fetchMock = installFetch(async (url, init) => {
    const method = methodOf(init);
    if (url.pathname === "/api/v1/admin/working-day-config") return jsonResponse(200, CONFIG);
    if (url.pathname === "/api/v1/admin/holidays" && method === "GET") {
      return jsonResponse(200, { items: items.map((item) => ({ ...item })) });
    }
    if (url.pathname === "/api/v1/admin/holidays" && method === "POST") {
      const body = requestBody(init) as { date: string; name: string; region: string | null };
      const created = { id: HOLIDAY_ID, date: body.date, name: body.name, region: body.region };
      items.push(created);
      return jsonResponse(201, created);
    }
    if (method === "DELETE" && url.pathname === `/api/v1/admin/holidays/${HOLIDAY_ID}`) {
      items.splice(0, items.length);
      return jsonResponse(204);
    }
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/working-days");

  expect(await screen.findByText("No holidays are recorded.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Holiday date"), { target: { value: "2026-10-02" } });
  await user.type(screen.getByLabelText("Holiday name"), "Gandhi Jayanti");
  await user.click(screen.getByRole("button", { name: "Add holiday" }));

  expect(await screen.findByRole("button", { name: "Delete Gandhi Jayanti on 2026-10-02" })).toBeInTheDocument();
  expect(screen.getByText(/Gandhi Jayanti on 2026-10-02 was added/)).toBeInTheDocument();
  expect(screen.getByText("AA-wide")).toBeInTheDocument();
  expect(screen.getByLabelText("Holiday name")).toHaveValue("");
  const post = fetchMock.mock.calls.find((call) => methodOf(call[1]) === "POST");
  expect(requestUrl(post?.[0] ?? "").pathname).toBe("/api/v1/admin/holidays");
  expect(requestBody(post?.[1])).toEqual({ date: "2026-10-02", name: "Gandhi Jayanti", region: null });

  await user.click(screen.getByRole("button", { name: "Delete Gandhi Jayanti on 2026-10-02" }));
  expect(await screen.findByRole("dialog", { name: "Delete Gandhi Jayanti?" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "DELETE")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Delete Gandhi Jayanti on 2026-10-02" }));
  await user.click(screen.getByRole("button", { name: "Delete holiday" }));
  expect(
    await screen.findByText(
      "Gandhi Jayanti on 2026-10-02 was deleted. This does not rewrite accept, assign, or result due dates already stored on existing batches.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete Gandhi Jayanti on 2026-10-02" })).not.toBeInTheDocument();
  expect(screen.getByText("No holidays are recorded.")).toBeInTheDocument();
  const deleted = fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "DELETE");
  expect(deleted).toHaveLength(1);
  expect(requestUrl(deleted[0]?.[0] ?? "").pathname).toBe(`/api/v1/admin/holidays/${HOLIDAY_ID}`);
}, 15000);

it("shows a duplicate holiday error", async () => {
  const user = userEvent.setup();
  installFetch(async (url, init) => {
    if (url.pathname === "/api/v1/admin/working-day-config") return jsonResponse(200, CONFIG);
    if (methodOf(init) === "POST") {
      return jsonResponse(409, {
        error: {
          code: "DUPLICATE_RESOURCE",
          message: "A holiday already exists for this date and region",
        },
      });
    }
    if (url.pathname === "/api/v1/admin/holidays") return jsonResponse(200, { items: [] });
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
  setSession(sessionFor("mis"));
  renderApp("/working-days");

  await screen.findByRole("button", { name: "Add holiday" });
  fireEvent.change(screen.getByLabelText("Holiday date"), { target: { value: "2026-10-02" } });
  await user.type(screen.getByLabelText("Holiday name"), "Gandhi Jayanti");
  await user.click(screen.getByRole("button", { name: "Add holiday" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("DUPLICATE_RESOURCE");
  expect(alert).toHaveTextContent("A holiday already exists for this date and region");
  expect(alert).toHaveFocus();
});

it("shows holiday validation errors", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url, init) => {
    if (url.pathname === "/api/v1/admin/working-day-config") return jsonResponse(200, CONFIG);
    if (methodOf(init) === "POST") {
      return jsonResponse(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: { date: ["Invalid date"] },
        },
      });
    }
    if (url.pathname === "/api/v1/admin/holidays") return jsonResponse(200, { items: [] });
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/working-days");

  await screen.findByRole("button", { name: "Add holiday" });
  await user.click(screen.getByRole("button", { name: "Add holiday" }));
  let alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Enter a holiday date.");
  expect(alert).toHaveTextContent("Enter a holiday name.");
  expect(screen.getByLabelText("Holiday date")).toHaveFocus();
  expect(screen.getByLabelText("Holiday date")).toHaveAttribute("aria-invalid", "true");
  expect(fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "POST")).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("Holiday date"), { target: { value: "2026-10-02" } });
  fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "A".repeat(201) } });
  await user.click(screen.getByRole("button", { name: "Add holiday" }));
  alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Holiday name must be 200 characters or fewer.");
  expect(screen.getByLabelText("Holiday name")).toHaveFocus();
  expect(fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "POST")).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "Gandhi Jayanti" } });
  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "R".repeat(65) } });
  await user.click(screen.getByRole("button", { name: "Add holiday" }));
  alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Region must be 64 characters or fewer.");
  expect(screen.getByLabelText("Region")).toHaveAttribute("aria-invalid", "true");
  expect(fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "POST")).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "" } });
  await user.click(screen.getByRole("button", { name: "Add holiday" }));
  alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("VALIDATION_ERROR");
  expect(alert).toHaveTextContent("Date: Invalid date");
  expect(screen.getByLabelText("Holiday date")).toHaveAttribute("aria-invalid", "true");
});

it("filters holidays by from and to", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url, init) => {
    if (url.pathname === "/api/v1/admin/working-day-config") return jsonResponse(200, CONFIG);
    if (url.pathname === "/api/v1/admin/holidays" && methodOf(init) === "GET") {
      const from = url.searchParams.get("from");
      const items =
        from === "2026-10-01"
          ? [{ id: HOLIDAY_ID, date: "2026-10-02", name: "Gandhi Jayanti", region: null }]
          : [];
      return jsonResponse(200, { items });
    }
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
  setSession(sessionFor("mis"));
  renderApp("/working-days");

  expect(await screen.findByText("No holidays are recorded.")).toBeInTheDocument();
  expect(holidayGets(fetchMock)).toHaveLength(1);
  expect(requestUrl(holidayGets(fetchMock)[0]?.[0] ?? "").search).toBe("");

  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-03" } });
  fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-01" } });
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("The From date must be on or before the To date.");
  expect(screen.getByLabelText("From date")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("From date")).toHaveFocus();
  expect(holidayGets(fetchMock)).toHaveLength(1);

  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-31" } });
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByRole("button", { name: "Delete Gandhi Jayanti on 2026-10-02" })).toBeInTheDocument();
  const ranged = holidayGets(fetchMock).at(-1);
  expect(requestUrl(ranged?.[0] ?? "").searchParams.get("from")).toBe("2026-10-01");
  expect(requestUrl(ranged?.[0] ?? "").searchParams.get("to")).toBe("2026-10-31");

  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(await screen.findByText("No holidays are recorded.")).toBeInTheDocument();
  expect(requestUrl(holidayGets(fetchMock).at(-1)?.[0] ?? "").search).toBe("");
});
