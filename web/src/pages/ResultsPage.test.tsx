import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { sessionFor, jsonResponse } from "../test/fixtures";
import { renderApp } from "../test/render";

const row = {
  batchId: "b1",
  qualification: "Field Technician (QP1)",
  sector: "Electronics",
  centre: "Centre A",
  partner: "TP One",
  assessor: "Ravi",
  assessmentDate: "2026-09-01",
  batchStatus: "published",
  resultStatus: "published",
  total: 3,
  pass: 2,
  fail: 0,
  absent: 1,
};

const summary = {
  batchId: "b1",
  resultStatus: "published",
  header: {
    qualification: "Field Technician (QP1)",
    sector: "Electronics",
    assessor: "Ravi",
    centre: "Centre A, OFFLINE",
    partner: "TP One",
    date: "01-Sep-2026",
  },
  counts: { total: 3, assessed: 2, pass: 2, fail: 0, absent: 1 },
  components: ["theory", "practical"],
  nos: [{ nosId: "n1", code: "NOS1", max: { theory: 20, practical: 30 } }],
  maxTotal: 50,
  rows: [
    {
      sNo: 1,
      reference: "C1",
      name: "Asha Devi",
      marks: [{ theory: 15, practical: 25 }],
      totals: { theory: 15, practical: 25 },
      total: 40,
      percentage: 80,
      status: "Pass",
    },
  ],
};

function stub() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("candidate-summary")) return jsonResponse(200, summary);
    return jsonResponse(200, { page: 1, pageSize: 20, total: 1, items: [row] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("lists finished batches with counts and opens the report", async () => {
  stub();
  setSession(sessionFor("aa_admin"));
  renderApp("/results");
  expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
  expect(await screen.findByText("Field Technician (QP1)")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("link", { name: "Open report" }));
  expect(await screen.findByRole("heading", { name: "Candidate Summary Report" })).toBeInTheDocument();
  expect(await screen.findByText("Asha Devi")).toBeInTheDocument();
  expect(screen.getByText("80.00")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Excel" })).toBeInTheDocument();
  expect(screen.getByText(/system generated report/i)).toBeInTheDocument();
});

it("shows an empty state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(200, { page: 1, pageSize: 20, total: 0, items: [] })),
  );
  setSession(sessionFor("mis"));
  renderApp("/results");
  expect(await screen.findByText("No batches with results yet.")).toBeInTheDocument();
});

it("does not call the report API for a candidate", async () => {
  const fetchMock = stub();
  setSession(sessionFor("candidate"));
  renderApp("/results");
  expect(await screen.findByText(/shown in your own section/i)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
