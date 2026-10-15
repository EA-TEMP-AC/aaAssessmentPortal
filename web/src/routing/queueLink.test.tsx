import { act, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";
import type { Role } from "./access";

function settingsBody(canSee: boolean) {
  return { abReviewerCanReadAssessorPayments: false, ncvetViewerCanSeeAbQueue: canSee, updatedBy: null, updatedAt: null };
}

function stub(handler: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/settings/access")) return handler();
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "No" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function settingsCalls(fetchMock: ReturnType<typeof stub>) {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes("/settings/access")).length;
}

it("shows the AB queue link to ncvet_viewer on Home when the setting is on", async () => {
  stub(() => jsonResponse(200, settingsBody(true)));
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/home");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(await within(nav).findByRole("link", { name: "AB queue" })).toHaveAttribute("href", "/ab-queue");
});

it("hides the link when the setting is off", async () => {
  const fetchMock = stub(() => jsonResponse(200, settingsBody(false)));
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/home");
  await waitFor(() => expect(settingsCalls(fetchMock)).toBe(1));
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).queryByRole("link", { name: "AB queue" })).not.toBeInTheDocument();
});

it("hides the link and keeps the app working when the request fails", async () => {
  const fetchMock = stub(() => jsonResponse(500, { error: { code: "INTERNAL", message: "Down" } }));
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/home");
  await waitFor(() => expect(settingsCalls(fetchMock)).toBe(1));
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).queryByRole("link", { name: "AB queue" })).not.toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Batches" })).toBeInTheDocument();
});

it("refreshes the setting when the page regains focus", async () => {
  let canSee = false;
  const fetchMock = stub(() => jsonResponse(200, settingsBody(canSee)));
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/home");
  await waitFor(() => expect(settingsCalls(fetchMock)).toBe(1));
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).queryByRole("link", { name: "AB queue" })).not.toBeInTheDocument();

  canSee = true;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(await within(nav).findByRole("link", { name: "AB queue" })).toBeInTheDocument();
  expect(settingsCalls(fetchMock)).toBe(2);
});

it("takes the link away again if a refresh fails", async () => {
  let fail = false;
  const fetchMock = stub(() =>
    fail ? jsonResponse(500, { error: { code: "INTERNAL", message: "Down" } }) : jsonResponse(200, settingsBody(true)),
  );
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/home");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  await within(nav).findByRole("link", { name: "AB queue" });

  fail = true;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(within(nav).queryByRole("link", { name: "AB queue" })).not.toBeInTheDocument());
  expect(settingsCalls(fetchMock)).toBe(2);
});

it.each<Role>(["aa_admin", "mis", "assessor", "ab_reviewer", "tp"])("does not load the setting for %s", async (role) => {
  const fetchMock = stub(() => jsonResponse(200, settingsBody(true)));
  setSession(sessionFor(role));
  renderApp("/home");
  await screen.findByRole("navigation", { name: "Primary" });
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(settingsCalls(fetchMock)).toBe(0);
});
