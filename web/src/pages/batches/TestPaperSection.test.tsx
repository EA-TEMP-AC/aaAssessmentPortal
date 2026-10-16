import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../../api/session";
import { IDS, batchRecord, emptyMasterList } from "../../test/batchFixtures";
import { jsonResponse, sessionFor } from "../../test/fixtures";
import { PAPER_ID, paperDoc } from "../../test/questionFixtures";
import { renderApp } from "../../test/render";
import type { Role } from "../../routing/access";

type Call = { method: string; url: URL; body: unknown };

const HINDI = paperDoc({ _id: PAPER_ID, name: "Hindi paper", status: "approved", rules: { language: "hi", quotas: [] } });
const ENGLISH = paperDoc({
  _id: "66f0000000000000000000f9",
  name: "English paper",
  status: "approved",
  rules: { language: "en", quotas: [] },
});
const INCOMPLETE = paperDoc({
  _id: "66f0000000000000000000f8",
  name: "Short paper",
  status: "approved",
  complete: false,
  rules: { language: "hi", quotas: [] },
});

function install(options: { testPaperId?: string | null; put?: (call: Call) => Response } = {}) {
  const calls: Call[] = [];
  let testPaperId = options.testPaperId ?? null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const call = {
        method: (init?.method ?? "GET").toUpperCase(),
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const path = url.pathname;
      if (path.endsWith(`/batches/${IDS.batch}/test-paper`) && call.method === "PUT") {
        const response = options.put ? options.put(call) : jsonResponse(200, batchRecord());
        if (response.ok) testPaperId = (call.body as { testPaperId: string }).testPaperId;
        return response;
      }
      if (path.endsWith(`/batches/${IDS.batch}`)) return jsonResponse(200, batchRecord({ testPaperId }));
      if (path.endsWith("/tests") && call.method === "GET") {
        return jsonResponse(200, { items: [HINDI, ENGLISH, INCOMPLETE], total: 3, page: 1, pageSize: 100 });
      }
      if (path.endsWith(`/tests/${PAPER_ID}`)) return jsonResponse(200, HINDI);
      if (path.endsWith("/candidates")) return jsonResponse(200, { items: [] });
      if (/\/(awarding-bodies|qualifications|training-partners|centres)$/.test(path)) {
        return jsonResponse(200, emptyMasterList());
      }
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }),
  );
  return calls;
}

function open(role: Role) {
  setSession(sessionFor(role));
  renderApp(`/batches/${IDS.batch}`);
}

it("tells the admin that no paper is set and lists only approved complete papers in the batch language", async () => {
  install();
  open("aa_admin");
  const section = await screen.findByRole("region", { name: "Test paper" });
  expect(within(section).getByText(/No test paper is set/)).toBeInTheDocument();
  const select = within(section).getByLabelText("Choose the test paper");
  await waitFor(() => expect(within(select).getByRole("option", { name: "Hindi paper (4 marks)" })).toBeInTheDocument());
  expect(within(select).queryByRole("option", { name: /English paper/ })).not.toBeInTheDocument();
  expect(within(select).queryByRole("option", { name: /Short paper/ })).not.toBeInTheDocument();
});

it("sets the paper and then shows which one is assigned", async () => {
  const user = userEvent.setup();
  const calls = install();
  open("aa_admin");
  const section = await screen.findByRole("region", { name: "Test paper" });
  const select = within(section).getByLabelText("Choose the test paper");
  await within(select).findByRole("option", { name: /Hindi paper/ });
  await user.click(within(section).getByRole("button", { name: "Set test paper" }));
  expect(within(section).getByRole("alert")).toHaveTextContent("Choose a paper first.");
  await user.selectOptions(select, PAPER_ID);
  await user.click(within(section).getByRole("button", { name: "Set test paper" }));
  expect(await within(section).findByText("The test paper was set for this batch.")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ testPaperId: PAPER_ID });
  expect(await within(section).findByText("Hindi paper")).toBeInTheDocument();
  expect(within(section).getByLabelText("Change the test paper")).toBeInTheDocument();
});

it("shows the assigned paper by name with a link to it", async () => {
  install({ testPaperId: PAPER_ID });
  open("aa_admin");
  const section = await screen.findByRole("region", { name: "Test paper" });
  expect(await within(section).findByText("Hindi paper")).toBeInTheDocument();
  expect(within(section).getByRole("link", { name: "Open paper" })).toHaveAttribute("href", `/papers/${PAPER_ID}`);
});

it("blocks the change once an attempt exists", async () => {
  const user = userEvent.setup();
  install({
    testPaperId: PAPER_ID,
    put: () =>
      jsonResponse(409, {
        error: { code: "BATCH_TEST_PAPER_LOCKED", message: "The test paper cannot be changed after a candidate has started" },
      }),
  });
  open("aa_admin");
  const section = await screen.findByRole("region", { name: "Test paper" });
  const select = within(section).getByLabelText("Change the test paper");
  await within(select).findByRole("option", { name: /Hindi paper/ });
  await user.selectOptions(select, PAPER_ID);
  await user.click(within(section).getByRole("button", { name: "Set test paper" }));
  expect(await within(section).findByRole("alert")).toHaveTextContent("cannot be changed after a candidate has started");
  expect(within(section).getByText(/The paper is fixed because a candidate has started/)).toBeInTheDocument();
  expect(within(section).queryByRole("button", { name: "Set test paper" })).not.toBeInTheDocument();
});

it("shows a refusal from the server", async () => {
  const user = userEvent.setup();
  install({
    put: () => jsonResponse(409, { error: { code: "BATCH_TEST_PAPER_NOT_APPROVED", message: "Only an approved paper can be set" } }),
  });
  open("aa_admin");
  const section = await screen.findByRole("region", { name: "Test paper" });
  const select = within(section).getByLabelText("Choose the test paper");
  await within(select).findByRole("option", { name: /Hindi paper/ });
  await user.selectOptions(select, PAPER_ID);
  await user.click(within(section).getByRole("button", { name: "Set test paper" }));
  expect(await within(section).findByRole("alert")).toHaveTextContent("Only an approved paper can be set");
  expect(within(section).getByRole("button", { name: "Set test paper" })).toBeInTheDocument();
});

it("shows the AB reviewer the paper but no way to change it", async () => {
  install({ testPaperId: PAPER_ID });
  open("ab_reviewer");
  const section = await screen.findByRole("region", { name: "Test paper" });
  expect(await within(section).findByText("Hindi paper")).toBeInTheDocument();
  expect(within(section).queryByRole("button", { name: "Set test paper" })).not.toBeInTheDocument();
});

it("tells MIS only that a paper is set", async () => {
  const calls = install({ testPaperId: PAPER_ID });
  open("mis");
  const section = await screen.findByRole("region", { name: "Test paper" });
  expect(within(section).getByText("A test paper is set.")).toBeInTheDocument();
  expect(calls.some((c) => c.url.pathname.endsWith("/tests") || c.url.pathname.includes("/tests/"))).toBe(false);
});
