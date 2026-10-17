import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DEFAULT_BATCH_SETTINGS } from "../../api/batchSettings";
import { setSession } from "../../api/session";
import { IDS, batchRecord, emptyMasterList } from "../../test/batchFixtures";
import { jsonResponse, sessionFor } from "../../test/fixtures";
import { PAPER_ID, paperDoc } from "../../test/questionFixtures";
import { renderApp } from "../../test/render";
import type { Role } from "../../routing/access";

type Call = { method: string; url: URL; body: unknown };

const TAMIL = paperDoc({
  _id: PAPER_ID,
  name: "Tamil paper",
  status: "approved",
  rules: { language: "ta", quotas: [] },
});
const SAME = paperDoc({
  _id: "66f0000000000000000000f9",
  name: "Hindi paper",
  status: "approved",
  rules: { language: "hi", quotas: [] },
});

function install(options: {
  theory: boolean;
  saved?: { language: string; testPaperId: string }[];
}) {
  const calls: Call[] = [];
  let saved = options.saved ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const call = {
        method: (init?.method ?? "GET").toUpperCase(),
        url,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const path = url.pathname;
      if (
        path.endsWith(`/batches/${IDS.batch}/language-papers`) &&
        call.method === "PUT"
      ) {
        saved = (call.body as { papers: typeof saved }).papers;
        return jsonResponse(200, batchRecord({ languagePapers: saved }));
      }
      if (path.endsWith(`/batches/${IDS.batch}/settings`)) {
        return jsonResponse(200, {
          batchId: IDS.batch,
          settings: {
            ...DEFAULT_BATCH_SETTINGS,
            languages: {
              theory: options.theory,
              practical: false,
              viva: false,
            },
          },
        });
      }
      if (path.endsWith(`/batches/${IDS.batch}`))
        return jsonResponse(200, batchRecord({ languagePapers: saved }));
      if (path.endsWith("/tests") && call.method === "GET") {
        return jsonResponse(200, {
          items: [TAMIL, SAME],
          total: 2,
          page: 1,
          pageSize: 100,
        });
      }
      if (path.endsWith("/candidates")) return jsonResponse(200, { items: [] });
      if (
        /\/(awarding-bodies|qualifications|training-partners|centres)$/.test(
          path,
        )
      ) {
        return jsonResponse(200, emptyMasterList());
      }
      return jsonResponse(404, {
        error: { code: "NOT_FOUND", message: "Not found" },
      });
    }),
  );
  return calls;
}

function open(role: Role) {
  setSession(sessionFor(role));
  renderApp(`/batches/${IDS.batch}`);
}

it("points to the settings switch when the theory languages switch is off (X-33)", async () => {
  install({ theory: false });
  open("aa_admin");
  const section = await screen.findByRole("region", {
    name: "Papers in other languages",
  });
  expect(
    await within(section).findByText(/turn on "Theory"/),
  ).toBeInTheDocument();
  expect(
    within(section).queryByRole("form", { name: "Add a language paper" }),
  ).not.toBeInTheDocument();
});

it("adds a paper for another language and sends the whole list (X-33)", async () => {
  const user = userEvent.setup();
  const calls = install({ theory: true });
  open("aa_admin");
  const section = await screen.findByRole("region", {
    name: "Papers in other languages",
  });
  const select = await within(section).findByLabelText(
    "Paper in that language",
  );
  await within(select).findByRole("option", { name: /Tamil paper/ });
  // The paper in the batch's own language is not offered.
  expect(
    within(select).queryByRole("option", { name: /Hindi paper/ }),
  ).not.toBeInTheDocument();
  await user.click(
    within(section).getByRole("button", { name: "Add language paper" }),
  );
  expect(within(section).getByRole("alert")).toHaveTextContent(
    "Write the language and choose its paper.",
  );
  await user.type(within(section).getByLabelText("Language"), "Tamil");
  await user.selectOptions(select, PAPER_ID);
  await user.click(
    within(section).getByRole("button", { name: "Add language paper" }),
  );
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
    papers: [{ language: "Tamil", testPaperId: PAPER_ID }],
  });
  expect(
    await within(section).findByText(/Tamil: Tamil paper/),
  ).toBeInTheDocument();
});
