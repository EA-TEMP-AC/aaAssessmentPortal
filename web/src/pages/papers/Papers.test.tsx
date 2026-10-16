import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../../api/session";
import type { Role } from "../../routing/access";
import { jsonResponse, sessionFor } from "../../test/fixtures";
import {
  PAPER_ID,
  QUAL,
  QUESTION_ID,
  paperDoc,
  qualificationList,
} from "../../test/questionFixtures";
import { renderApp } from "../../test/render";

type Call = { method: string; url: URL; body: unknown };

function install(handler: (call: Call) => Response | null) {
  const calls: Call[] = [];
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
      if (url.pathname.endsWith("/qualifications"))
        return jsonResponse(200, qualificationList());
      return (
        handler(call) ??
        jsonResponse(404, {
          error: { code: "NOT_FOUND", message: "Not found" },
        })
      );
    }),
  );
  return calls;
}

function open(role: Role, path: string) {
  setSession(sessionFor(role));
  renderApp(path);
}

const isPaper = (call: Call) =>
  call.url.pathname.endsWith(`/tests/${PAPER_ID}`) && call.method === "GET";

it("lists papers with their names and status", async () => {
  const calls = install((call) =>
    call.url.pathname.endsWith("/tests") && call.method === "GET"
      ? jsonResponse(200, {
          items: [
            paperDoc({ status: "submitted" }),
            paperDoc({
              _id: "66f0000000000000000000f2",
              name: undefined,
              status: "approved",
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        })
      : null,
  );
  open("sme", "/papers");
  expect(
    await screen.findByRole("link", { name: "Electrician mock paper" }),
  ).toHaveAttribute("href", `/papers/${PAPER_ID}`);
  expect(
    screen.getByRole("link", { name: "Q-ELEC-L4 Electrician Level 4 (en)" }),
  ).toBeInTheDocument();
  expect(screen.getByText("2 papers. Page 1 of 1.")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Create paper" }),
  ).toBeInTheDocument();
  expect(calls.some((c) => c.url.pathname.endsWith("/tests"))).toBe(true);
});

it("shows an empty state, and no Create paper link to the AB reviewer", async () => {
  install((call) =>
    call.url.pathname.endsWith("/tests")
      ? jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 20 })
      : null,
  );
  open("ab_reviewer", "/papers");
  expect(
    await screen.findByText("There are no test papers yet."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Create paper" }),
  ).not.toBeInTheDocument();
});

it("shows a list error with a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  install((call) => {
    if (!call.url.pathname.endsWith("/tests")) return null;
    return fail
      ? jsonResponse(500, {
          error: { code: "INTERNAL_ERROR", message: "Something broke" },
        })
      : jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 20 });
  });
  open("aa_admin", "/papers");
  expect(await screen.findByRole("alert")).toHaveTextContent("Something broke");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByText("There are no test papers yet."),
  ).toBeInTheDocument();
});

it("checks the create form, then generates a paper and opens it", async () => {
  const user = userEvent.setup();
  const calls = install((call) => {
    if (call.url.pathname.endsWith("/weight-profiles")) {
      return jsonResponse(200, {
        items: [
          {
            _id: "p1",
            rootProfileId: "66f0000000000000000000a9",
            name: "Balanced",
            version: 2,
          },
        ],
        total: 1,
      });
    }
    if (call.url.pathname.endsWith("/tests/generate"))
      return jsonResponse(201, paperDoc());
    if (isPaper(call)) return jsonResponse(200, paperDoc());
    return null;
  });
  open("sme", "/papers/new");
  await user.click(
    await screen.findByRole("button", { name: "Generate paper" }),
  );
  expect(
    await screen.findByText("Choose a NOS in every quota row."),
  ).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);

  await user.type(
    screen.getByLabelText(/Paper name/),
    "Electrician mock paper",
  );
  await screen.findByRole("option", { name: /Q-ELEC-L4/ });
  await user.selectOptions(screen.getByLabelText("Qualification"), QUAL.id);
  await user.selectOptions(screen.getByLabelText("NOS (row 1)"), "NOS-01");
  await user.selectOptions(screen.getByLabelText("Type (row 1)"), "mcq");
  const count = screen.getByLabelText("Questions (row 1)");
  await user.clear(count);
  await user.type(count, "2");
  await user.click(screen.getByRole("button", { name: "Add quota row" }));
  await user.selectOptions(screen.getByLabelText("NOS (row 2)"), "NOS-02");
  await user.selectOptions(
    await screen.findByLabelText("Weight profile (optional)"),
    "66f0000000000000000000a9",
  );
  await user.type(screen.getByLabelText(/Seed/), "77");
  await user.click(screen.getByRole("button", { name: "Generate paper" }));

  expect(
    await screen.findByRole("heading", { name: "Electrician mock paper" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("The paper was generated as a draft."),
  ).toBeInTheDocument();
  const post = calls.find((c) => c.url.pathname.endsWith("/tests/generate"));
  expect(post?.body).toEqual({
    qualificationId: QUAL.id,
    language: "en",
    name: "Electrician mock paper",
    quotas: [
      { nosId: "NOS-01", type: "mcq", count: 2 },
      { nosId: "NOS-02", count: 1 },
    ],
    seed: 77,
    weightProfileId: "66f0000000000000000000a9",
  });
});

it("lists the shortages when the bank cannot fill a quota", async () => {
  const user = userEvent.setup();
  install((call) =>
    call.url.pathname.endsWith("/weight-profiles")
      ? jsonResponse(200, { items: [], total: 0 })
      : call.url.pathname.endsWith("/tests/generate")
        ? jsonResponse(422, {
            error: {
              code: "TEST_BANK_SHORTAGE",
              message: "The bank cannot fill every quota",
              details: {
                shortages: [
                  { nosId: "NOS-01", type: "mcq", requested: 5, available: 2 },
                ],
              },
            },
          })
        : null,
  );
  open("aa_admin", "/papers/new");
  await screen.findByRole("option", { name: /Q-ELEC-L4/ });
  await user.selectOptions(screen.getByLabelText("Qualification"), QUAL.id);
  await user.selectOptions(screen.getByLabelText("NOS (row 1)"), "NOS-01");
  await user.click(screen.getByRole("button", { name: "Generate paper" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("The bank cannot fill every quota");
  expect(alert).toHaveTextContent("NOS-01 mcq: needs 5, the bank has 2");
});

it("keeps the AB reviewer off the create page", async () => {
  install(() => null);
  open("ab_reviewer", "/papers/new");
  expect(
    await screen.findByRole("heading", { name: "Papers" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Create paper" }),
  ).not.toBeInTheDocument();
});

it("lets the author submit a draft for approval", async () => {
  const user = userEvent.setup();
  let status = "draft";
  const calls = install((call) => {
    if (call.url.pathname.endsWith("/submit")) {
      status = "submitted";
      return jsonResponse(200, paperDoc({ status }));
    }
    if (isPaper(call)) return jsonResponse(200, paperDoc({ status }));
    return null;
  });
  open("sme", `/papers/${PAPER_ID}`);
  await user.click(
    await screen.findByRole("button", { name: "Submit for approval" }),
  );
  expect(
    await screen.findByText("The paper was submitted for approval."),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Submit for approval" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "Approve" }),
  ).not.toBeInTheDocument();
  expect(
    calls.some(
      (c) => c.url.pathname.endsWith("/submit") && c.method === "POST",
    ),
  ).toBe(true);
});

it("shows why a submit was refused when a question went stale", async () => {
  const user = userEvent.setup();
  install((call) => {
    if (call.url.pathname.endsWith("/submit")) {
      return jsonResponse(409, {
        error: {
          code: "TEST_PAPER_STALE",
          message: "A question changed",
          details: { stale: [{ questionId: QUESTION_ID, reason: "retired" }] },
        },
      });
    }
    return isPaper(call) ? jsonResponse(200, paperDoc()) : null;
  });
  open("aa_admin", `/papers/${PAPER_ID}`);
  await user.click(
    await screen.findByRole("button", { name: "Submit for approval" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "1 question(s) in this paper are no longer approved",
  );
});

it("blocks submit on an incomplete paper and lists the shortage", async () => {
  install((call) =>
    isPaper(call)
      ? jsonResponse(
          200,
          paperDoc({
            complete: false,
            shortages: [
              { nosId: "NOS-02", type: null, requested: 4, available: 1 },
            ],
          }),
        )
      : null,
  );
  open("sme", `/papers/${PAPER_ID}`);
  expect(
    await screen.findByText(/This paper is incomplete/),
  ).toBeInTheDocument();
  expect(
    screen.getByText("NOS-02: needs 4, the bank has 1"),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Submit for approval" }),
  ).not.toBeInTheDocument();
});

it("lets the AB reviewer approve a submitted paper", async () => {
  const user = userEvent.setup();
  let status = "submitted";
  install((call) => {
    if (call.url.pathname.endsWith("/approve")) {
      status = "approved";
      return jsonResponse(200, paperDoc({ status }));
    }
    return isPaper(call) ? jsonResponse(200, paperDoc({ status })) : null;
  });
  open("ab_reviewer", `/papers/${PAPER_ID}`);
  expect(
    screen.queryByRole("button", { name: "Submit for approval" }),
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  expect(
    await screen.findByText("The paper was approved."),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Send back" }),
    ).not.toBeInTheDocument(),
  );
});

it("makes the reviewer give a reason before sending a paper back", async () => {
  const user = userEvent.setup();
  const calls = install((call) => {
    if (call.url.pathname.endsWith("/return"))
      return jsonResponse(
        200,
        paperDoc({ status: "draft", returnReason: "More viva" }),
      );
    return isPaper(call)
      ? jsonResponse(200, paperDoc({ status: "submitted" }))
      : null;
  });
  open("ab_reviewer", `/papers/${PAPER_ID}`);
  await user.click(await screen.findByRole("button", { name: "Send back" }));
  const dialog = await screen.findByRole("dialog", { name: "Send paper back" });
  await user.click(within(dialog).getByRole("button", { name: "Send back" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Give a reason");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await user.type(within(dialog).getByLabelText("Reason"), "More viva");
  await user.click(within(dialog).getByRole("button", { name: "Send back" }));
  expect(
    await screen.findByText("The paper was sent back to the author."),
  ).toBeInTheDocument();
  expect(calls.find((c) => c.url.pathname.endsWith("/return"))?.body).toEqual({
    reason: "More viva",
  });
});

it("shows the reviewer's reason on a returned draft", async () => {
  install((call) =>
    isPaper(call)
      ? jsonResponse(
          200,
          paperDoc({ status: "draft", returnReason: "More viva" }),
        )
      : null,
  );
  open("sme", `/papers/${PAPER_ID}`);
  expect(
    await screen.findByText("Sent back by the reviewer: More viva"),
  ).toBeInTheDocument();
});

it("previews questions with answers only when asked, 50 a page", async () => {
  const user = userEvent.setup();
  const calls = install((call) => {
    if (
      isPaper(call) &&
      call.url.searchParams.get("withQuestions") === "true"
    ) {
      return jsonResponse(
        200,
        paperDoc({
          items: [
            {
              questionId: QUESTION_ID,
              version: 1,
              nosId: "NOS-01",
              pcId: "PC-01",
              type: "mcq",
              marks: 2,
              stem: "Which tool measures current?",
              options: [
                { key: "A", text: "Ammeter" },
                { key: "B", text: "Voltmeter" },
              ],
              correctAnswer: "A",
            },
          ],
          itemPage: 1,
          itemPageSize: 50,
          itemTotal: 1,
        }),
      );
    }
    return isPaper(call) ? jsonResponse(200, paperDoc()) : null;
  });
  open("ab_reviewer", `/papers/${PAPER_ID}`);
  await user.click(
    await screen.findByRole("button", { name: "Show questions and answers" }),
  );
  expect(
    await screen.findByText("Which tool measures current?"),
  ).toBeInTheDocument();
  expect(screen.getByText(/Ammeter/).textContent).toContain("correct answer");
  expect(screen.getByText("Questions 1 to 1 of 1.")).toBeInTheDocument();
  const preview = calls.filter(
    (c) => c.url.searchParams.get("withQuestions") === "true",
  );
  expect(preview).toHaveLength(1);
  expect(preview[0]?.url.searchParams.get("itemPage")).toBe("1");
});

it("shows the daily limit message when the preview is refused", async () => {
  const user = userEvent.setup();
  install((call) => {
    if (
      isPaper(call) &&
      call.url.searchParams.get("withQuestions") === "true"
    ) {
      return jsonResponse(429, {
        error: {
          code: "CONTENT_READ_LIMIT",
          message: "Daily content read limit reached",
        },
      });
    }
    return isPaper(call) ? jsonResponse(200, paperDoc()) : null;
  });
  open("aa_admin", `/papers/${PAPER_ID}`);
  await user.click(
    await screen.findByRole("button", { name: "Show questions and answers" }),
  );
  expect(
    await screen.findByText("Daily content read limit reached"),
  ).toBeInTheDocument();
});

it("keeps the candidate out of papers", async () => {
  install(() => null);
  open("candidate", "/papers");
  expect(
    await screen.findByRole("heading", { name: "Candidate" }),
  ).toBeInTheDocument();
});
