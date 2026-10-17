import userEvent from "@testing-library/user-event";
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

it("lets admin upload an Excel file of records on a tab and shows the result", async () => {
  const user = userEvent.setup();
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      if (url.includes("/master-import/learners")) {
        return jsonResponse(200, {
          type: "learners",
          totalRows: 3,
          created: 1,
          skipped: 1,
          errors: [{ row: 4, reason: "name: Required" }],
        });
      }
      return jsonResponse(200, { page: 1, pageSize: 20, total: 0, items: [] });
    }),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/master-entry/learners");
  await user.click(
    await screen.findByText(/Add many students from an Excel file/),
  );
  await user.upload(
    screen.getByLabelText("Excel file for students"),
    new File(["x"], "students.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Upload" }));
  const summary = await screen.findByText(
    "1 added, 1 already there, 1 with problems (of 3 rows).",
  );
  expect(summary.parentElement).toHaveTextContent("Row 4: name: Required");
  expect(
    calls.some(
      (c) => c.method === "POST" && c.url.includes("/master-import/learners"),
    ),
  ).toBe(true);
});

it("shows no Excel panel on the Qualifications tab", async () => {
  stubEmptyLists();
  setSession(sessionFor("aa_admin"));
  renderApp("/master-entry/qualifications");
  await screen.findByRole("navigation", { name: "Master entry" });
  expect(screen.queryByText(/from an Excel file/)).not.toBeInTheDocument();
});
