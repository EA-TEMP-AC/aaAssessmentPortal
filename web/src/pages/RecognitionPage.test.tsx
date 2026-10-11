import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { ROLE_LABELS, type Role } from "../routing/access";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const DENIED: readonly Role[] = ["sme", "assessor", "proctor", "candidate", "tp", "ab_reviewer"];

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

function recognitionBody() {
  return {
    id: "66f0000000000000000000aa",
    sectors: ["Electronics", "Construction"],
    panIndia: false,
    states: ["Maharashtra", "Gujarat"],
    startDate: "2026-04-01",
    endDate: "2029-03-31",
  };
}

it.each(DENIED)("hides recognition from %s", async (role) => {
  const fetchMock = installFetch(async () => jsonResponse(200, recognitionBody()));
  setSession(sessionFor(role));
  renderApp("/recognition");

  expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Recognition" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Recognition" })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  cleanup();
});

it("shows recognition as read-only for an NCVET viewer", async () => {
  const fetchMock = installFetch(async () => jsonResponse(200, recognitionBody()));
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/recognition");

  expect(await screen.findByRole("heading", { name: "Recognised sectors" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Recognition" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("You can view recognition. Your role cannot change it.")).toBeInTheDocument();
  expect(screen.getByText("Electronics")).toBeInTheDocument();
  expect(screen.getByText("Gujarat")).toBeInTheDocument();
  expect(screen.getByText("2026-04-01")).toBeInTheDocument();
  expect(screen.getByText("2029-03-31")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save recognition" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(methodOf(fetchMock.mock.calls[0]?.[1])).toBe("GET");
  expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? "").pathname).toBe("/api/v1/admin/recognition");
});

it("lets an AA admin create recognition after a 404, including PAN India", async () => {
  const user = userEvent.setup();
  const saved = {
    ...recognitionBody(),
    sectors: ["Electronics"],
    panIndia: true,
    states: [],
  };
  const fetchMock = installFetch(async (_url, init) => {
    if (methodOf(init) === "PUT") return jsonResponse(200, saved);
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Recognition is not configured" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/recognition");

  expect(await screen.findByText(/Recognition is not configured/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save recognition" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save recognition" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Choose at least one recognised sector.");
  expect(alert).toHaveTextContent("Choose at least one state, or choose PAN India.");
  expect(alert).toHaveTextContent("Enter a start date.");
  expect(screen.queryByRole("button", { name: /Try again/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Electronics" }));
  await user.click(screen.getByRole("checkbox", { name: "Maharashtra" }));
  await user.click(screen.getByRole("radio", { name: "PAN India" }));
  expect(screen.queryByRole("checkbox", { name: "Maharashtra" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-04-01" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-03-31" } });
  await user.click(screen.getByRole("button", { name: "Save recognition" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The end date must be on or after the start date.");
  expect(fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "PUT")).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2029-03-31" } });
  await user.click(screen.getByRole("button", { name: "Save recognition" }));
  expect(await screen.findByText(/Recognition was saved/)).toBeInTheDocument();
  const put = fetchMock.mock.calls.filter((call) => methodOf(call[1]) === "PUT");
  expect(put).toHaveLength(1);
  expect(requestUrl(put[0]?.[0] ?? "").pathname).toBe("/api/v1/admin/recognition");
  expect(requestBody(put[0]?.[1])).toEqual({
    sectors: ["Electronics"],
    panIndia: true,
    states: [],
    startDate: "2026-04-01",
    endDate: "2029-03-31",
  });
}, 15000);

it("lets MIS replace recognition for selected states", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (_url, init) => {
    if (methodOf(init) === "PUT") {
      return jsonResponse(200, { ...recognitionBody(), states: ["Maharashtra"] });
    }
    return jsonResponse(200, recognitionBody());
  });
  setSession(sessionFor("mis"));
  renderApp("/recognition");

  expect(await screen.findByRole("checkbox", { name: "Electronics" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Construction" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Gujarat" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Selected states" })).toBeChecked();
  const sectors = screen.getByRole("group", { name: "Recognised sectors" });
  await user.type(within(sectors).getByLabelText("Find a sector"), "elect");
  expect(within(sectors).getByRole("checkbox", { name: "Electronics" })).toBeInTheDocument();
  expect(within(sectors).queryByRole("checkbox", { name: "Construction" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Gujarat" }));
  await user.click(screen.getByRole("button", { name: "Save recognition" }));
  expect(await screen.findByText(/Recognition was saved/)).toBeInTheDocument();
  expect(requestBody(fetchMock.mock.calls.find((call) => methodOf(call[1]) === "PUT")?.[1])).toMatchObject({
    sectors: ["Construction", "Electronics"],
    panIndia: false,
    states: ["Maharashtra"],
    startDate: "2026-04-01",
    endDate: "2029-03-31",
  });
});
