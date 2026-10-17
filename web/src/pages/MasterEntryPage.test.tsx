import { screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

function stubEmptyLists() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse(200, { page: 1, pageSize: 20, total: 0, items: [] }),
    ),
  );
}

it.each(["aa_admin", "mis"] as const)(
  "gives %s one Master entry page with a tab per record type",
  async (role) => {
    stubEmptyLists();
    setSession(sessionFor(role));
    renderApp("/master-entry");
    const tabs = await screen.findByRole("navigation", {
      name: "Master entry",
    });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual([
      "Awarding bodies",
      "Training partners",
      "Training centres",
      "Assessors",
      "Proctors",
      "Students",
      "Qualifications",
    ]);
    const menu = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(menu).getByRole("link", { name: "Master entry" }),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole("link", { name: "Registry" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("link", { name: "Master data" }),
    ).not.toBeInTheDocument();
  },
);

it("does not show Master entry to a training partner", () => {
  stubEmptyLists();
  setSession(sessionFor("tp"));
  renderApp("/home");
  const menu = screen.getByRole("navigation", { name: "Primary" });
  expect(
    within(menu).queryByRole("link", { name: "Master entry" }),
  ).not.toBeInTheDocument();
});
