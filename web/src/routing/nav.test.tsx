import { screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import type { Role } from "./access";
import { renderApp } from "../test/render";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { navItemsForRole } from "./nav";

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

const VISIBLE: Record<Role, readonly string[]> = {
  aa_admin: [
    "Home",
    "Batches",
    "Master entry",
    "Users",
    "Schemes",
    "Projects",
    "Signatories",
    "Recognition",
    "Question bank",
    "Papers",
    "Results",
    "Evidence",
    "Proctoring",
    "Audit log",
    "Analytics",
    "Working days",
    "Public site",
    "Settings",
  ],
  mis: [
    "Home",
    "Batches",
    "Master entry",
    "Users",
    "Schemes",
    "Projects",
    "Signatories",
    "Recognition",
    "Results",
    "Evidence",
    "Audit log",
    "Analytics",
    "Working days",
    "Public site",
  ],
  sme: ["Home", "Question bank", "Papers"],
  assessor: ["Home", "Batches", "Registry", "Results", "Proctoring"],
  proctor: ["Home", "Batches", "Registry", "Proctoring"],
  candidate: ["Home", "Batches", "Master data", "Results", "Exam"],
  tp: ["Home", "Batches", "Master data", "Results"],
  ab_reviewer: [
    "Home",
    "Batches",
    "Registry",
    "Master data",
    "Schemes",
    "Projects",
    "Signatories",
    "Question bank",
    "Papers",
    "Results",
    "Evidence",
    "Proctoring",
    "Audit log",
    "Analytics",
  ],
  ncvet_viewer: [
    "Home",
    "Batches",
    "Registry",
    "Master data",
    "Schemes",
    "Projects",
    "Signatories",
    "Recognition",
    "Results",
    "Evidence",
    "Proctoring",
    "Audit log",
    "Analytics",
  ],
};

it.each(Object.entries(VISIBLE) as [Role, readonly string[]][])(
  "shows %s navigation and hides the rest",
  (role, labels) => {
    setSession(sessionFor(role));
    renderApp("/home");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(labels);
  },
);

it("never shows the AB queue in the menu, even for ncvet_viewer with the setting on (X-38)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith("/settings/access")) {
        return jsonResponse(200, {
          abReviewerCanReadAssessorPayments: false,
          ncvetViewerCanSeeAbQueue: true,
        });
      }
      if (url.pathname.endsWith("/batches")) {
        return jsonResponse(200, {
          page: 1,
          pageSize: 20,
          total: 0,
          items: [],
        });
      }
      if (
        url.pathname.endsWith("/qualifications") ||
        url.pathname.endsWith("/training-partners")
      ) {
        return jsonResponse(200, {
          page: 1,
          pageSize: 100,
          total: 0,
          items: [],
        });
      }
      return jsonResponse(404);
    }),
  );
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/ab-queue");
  const nav = await screen.findByRole("navigation", { name: "Primary" });
  expect(within(nav).queryByRole("link", { name: "AB queue" })).toBeNull();
});

it("filters nav items correctly via navItemsForRole", () => {
  const without = navItemsForRole("ncvet_viewer", {
    ncvetViewerCanSeeAbQueue: false,
  });
  expect(without.some((item) => item.id === "ab-queue")).toBe(false);

  const withQueue = navItemsForRole("ncvet_viewer", {
    ncvetViewerCanSeeAbQueue: true,
  });
  expect(withQueue.some((item) => item.id === "ab-queue")).toBe(false);
});
