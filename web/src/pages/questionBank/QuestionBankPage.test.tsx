import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../../api/session";
import type { Role } from "../../routing/access";
import { jsonResponse, sessionFor } from "../../test/fixtures";
import { QUAL, QUESTION_ID, qualificationList, questionDoc, questionPage } from "../../test/questionFixtures";
import { renderApp } from "../../test/render";

type Call = { method: string; url: URL; body: unknown };

function install(handler: (call: Call) => Response | null) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const body = init?.body instanceof Blob ? init.body : typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method: (init?.method ?? "GET").toUpperCase(), url, body };
    calls.push(call);
    if (url.pathname.endsWith("/qualifications")) return jsonResponse(200, qualificationList());
    return handler(call) ?? jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function open(role: Role) {
  setSession(sessionFor(role));
  renderApp("/question-bank");
}

const listing = (items: unknown[]) => (call: Call) =>
  call.url.pathname.endsWith("/question-bank/questions") && call.method === "GET"
    ? jsonResponse(200, questionPage(items))
    : null;

it("lists questions 50 at a time and shows write buttons only to those who can write", async () => {
  const calls = install(listing([questionDoc()]));
  open("sme");
  expect(await screen.findByText("Which tool measures current?")).toBeInTheDocument();
  const listCall = calls.find((c) => c.url.pathname.endsWith("/question-bank/questions"));
  expect(listCall?.url.searchParams.get("pageSize")).toBe("50");
  expect(screen.getByRole("button", { name: "New question" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import from Excel" })).toBeInTheDocument();
  expect(screen.getByText("1 question. Page 1 of 1.")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "N0101 / PC1.1" })).toBeInTheDocument();
});

it("hides New question and Import from the AB reviewer", async () => {
  install(listing([questionDoc()]));
  open("ab_reviewer");
  await screen.findByText("Which tool measures current?");
  expect(screen.queryByRole("button", { name: "New question" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Import from Excel" })).not.toBeInTheDocument();
});

it("sends the chosen filters", async () => {
  const user = userEvent.setup();
  const calls = install(listing([]));
  open("aa_admin");
  expect(await screen.findByText("There are no questions yet.")).toBeInTheDocument();
  await user.selectOptions(await screen.findByLabelText("Qualification"), QUAL.id);
  await user.selectOptions(screen.getByLabelText("NOS"), "NOS-01");
  await user.selectOptions(screen.getByLabelText("PC"), "PC-02");
  await user.selectOptions(screen.getByLabelText("Type"), "viva");
  await user.type(screen.getByLabelText("Language"), "hi");
  await user.selectOptions(screen.getByLabelText("Status"), "approved");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No questions match these filters.")).toBeInTheDocument();
  const last = calls.filter((c) => c.url.pathname.endsWith("/question-bank/questions")).at(-1);
  const params = Object.fromEntries(last?.url.searchParams ?? []);
  expect(params).toMatchObject({
    qualification: QUAL.id,
    nos: "NOS-01",
    pc: "PC-02",
    type: "viva",
    language: "hi",
    status: "approved",
    page: "1",
    pageSize: "50",
  });
});

it("shows an error with a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  install((call) => {
    if (!call.url.pathname.endsWith("/question-bank/questions")) return null;
    if (fail) return jsonResponse(429, { error: { code: "CONTENT_READ_LIMIT", message: "Daily limit reached" } });
    return jsonResponse(200, questionPage([questionDoc()]));
  });
  open("sme");
  expect(await screen.findByRole("alert")).toHaveTextContent("Daily limit reached");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Which tool measures current?")).toBeInTheDocument();
});

it("lets the AB reviewer approve a question in review", async () => {
  const user = userEvent.setup();
  let approved = false;
  const calls = install((call) => {
    if (call.url.pathname.endsWith(`/${QUESTION_ID}/approve`)) {
      approved = true;
      return jsonResponse(200, questionDoc({ status: "approved" }));
    }
    return listing([questionDoc({ status: "in_review" })])(call);
  });
  open("ab_reviewer");
  await user.click(await screen.findByRole("button", { name: /^Open/ }));
  const dialog = await screen.findByRole("dialog", { name: "Question" });
  expect(within(dialog).getByText(/Ammeter/)).toBeInTheDocument();
  expect(within(dialog).getByText(/correct answer/)).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Edit (new version)" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(approved).toBe(true));
  expect(await screen.findByText("The question was approved.")).toBeInTheDocument();
  expect(calls.filter((c) => c.url.pathname.endsWith("/question-bank/questions")).length).toBeGreaterThan(1);
});

it("lets an SME submit a draft for review but not approve it", async () => {
  const user = userEvent.setup();
  let submitted = false;
  install((call) => {
    if (call.url.pathname.endsWith(`/${QUESTION_ID}/submit-for-review`)) {
      submitted = true;
      return jsonResponse(200, questionDoc({ status: "in_review" }));
    }
    return listing([questionDoc()])(call);
  });
  open("sme");
  await user.click(await screen.findByRole("button", { name: /^Open/ }));
  const dialog = await screen.findByRole("dialog", { name: "Question" });
  expect(within(dialog).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Submit for review" }));
  await waitFor(() => expect(submitted).toBe(true));
  expect(await screen.findByText("The question was sent for review.")).toBeInTheDocument();
});

it("offers no submit or approve on an approved question", async () => {
  const user = userEvent.setup();
  install((call) => {
    return listing([questionDoc({ status: "approved" })])(call);
  });
  open("sme");
  await user.click(await screen.findByRole("button", { name: /^Open/ }));
  const dialog = await screen.findByRole("dialog", { name: "Question" });
  expect(within(dialog).queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Edit (new version)" })).toBeInTheDocument();
});

it("checks the form, then creates a question", async () => {
  const user = userEvent.setup();
  const calls = install((call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/question-bank/questions")) {
      return jsonResponse(201, questionDoc());
    }
    return listing([])(call);
  });
  open("sme");
  await user.click(await screen.findByRole("button", { name: "New question" }));
  const dialog = await screen.findByRole("dialog", { name: "New question" });
  await user.click(within(dialog).getByRole("button", { name: "Create question" }));
  expect(within(dialog).getByText("Enter the question text.")).toBeInTheDocument();
  expect(within(dialog).getByText("Give at least two options and fill in every option you add.")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);

  expect(within(dialog).getByText("Choose a NOS.")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Qualification")).toHaveValue(QUAL.id);
  await user.selectOptions(within(dialog).getByLabelText("NOS"), "NOS-01");
  await user.selectOptions(within(dialog).getByLabelText("PC"), "PC-01");
  await user.type(within(dialog).getByLabelText("Question text"), "What is Ohm's law?");
  await user.type(within(dialog).getByLabelText("Option A"), "V = IR");
  await user.type(within(dialog).getByLabelText("Option B"), "V = I + R");
  await user.click(within(dialog).getByRole("button", { name: "Create question" }));
  expect(within(dialog).getByText("Choose the correct option.")).toBeInTheDocument();
  await user.selectOptions(within(dialog).getByLabelText("Correct option"), "A");
  await user.click(within(dialog).getByRole("button", { name: "Create question" }));

  expect(await screen.findByText("The question was created as a draft.")).toBeInTheDocument();
  const post = calls.find((c) => c.method === "POST");
  expect(post?.body).toEqual({
    qualificationId: QUAL.id,
    nosId: "NOS-01",
    pcId: "PC-01",
    type: "mcq",
    language: "en",
    difficulty: null,
    bloomLevel: null,
    stem: "What is Ohm's law?",
    options: [
      { key: "A", text: "V = IR" },
      { key: "B", text: "V = I + R" },
    ],
    correctAnswer: "A",
    marks: 1,
    images: [],
  });
});

it("edits a question into a new version", async () => {
  const user = userEvent.setup();
  const calls = install((call) => {
    if (call.method === "PUT") return jsonResponse(200, questionDoc({ version: 2, stem: "Changed" }));
    return listing([questionDoc()])(call);
  });
  open("aa_admin");
  await user.click(await screen.findByRole("button", { name: /^Open/ }));
  await user.click(await screen.findByRole("button", { name: "Edit (new version)" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit question" });
  expect(within(dialog).getByText(/Saving creates version 2/)).toBeInTheDocument();
  const stem = within(dialog).getByLabelText("Question text");
  await user.clear(stem);
  await user.type(stem, "Changed");
  await user.click(within(dialog).getByRole("button", { name: "Save new version" }));
  expect(await screen.findByText("Saved as version 2. It is a draft and needs review again.")).toBeInTheDocument();
  const put = calls.find((c) => c.method === "PUT");
  expect(put?.url.pathname).toContain(QUESTION_ID);
  expect(put?.body).toMatchObject({ stem: "Changed", correctAnswer: "A" });
});

it("downloads the import template", async () => {
  const user = userEvent.setup();
  const created = vi.fn(() => "blob:template");
  const revoked = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const calls = install((call) => {
    if (call.url.pathname.endsWith("/import-template")) {
      return new Response(new Blob(["xlsx"]), {
        status: 200,
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
    }
    return listing([])(call);
  });
  open("sme");
  await user.click(await screen.findByRole("button", { name: "Import from Excel" }));
  await user.click(await screen.findByRole("button", { name: "Download template (.xlsx)" }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(calls.some((c) => c.url.pathname.endsWith("/import-template"))).toBe(true);
  expect(revoked).toHaveBeenCalled();
  expect(click).toHaveBeenCalled();
  click.mockRestore();
});

it("shows the per-row report for a refused import, then imports valid rows only", async () => {
  const user = userEvent.setup();
  const calls = install((call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/question-bank/import")) {
      if (call.url.searchParams.get("partial") === "true") {
        return jsonResponse(201, {
          success: true,
          totalRows: 3,
          importedCount: 2,
          errorCount: 1,
          errors: [{ row: 3, errors: ["PC 'PC-99' not found under NOS 'NOS-01'"] }],
        });
      }
      return jsonResponse(400, {
        success: false,
        code: "IMPORT_VALIDATION_FAILED",
        totalRows: 3,
        importedCount: 0,
        errorCount: 1,
        errors: [{ row: 3, errors: ["PC 'PC-99' not found under NOS 'NOS-01'"] }],
      });
    }
    return listing([])(call);
  });
  open("sme");
  await user.click(await screen.findByRole("button", { name: "Import from Excel" }));
  const dialog = await screen.findByRole("dialog", { name: "Import questions from Excel" });

  await user.click(within(dialog).getByRole("button", { name: "Import" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose an .xlsx file first.");

  const file = new File(["x"], "questions.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await user.upload(within(dialog).getByLabelText("Excel file"), file);
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
  const report = await within(dialog).findByRole("status", { name: "Import report" });
  expect(report).toHaveTextContent("Nothing was imported. 1 of 3 rows have errors.");
  expect(within(report).getByRole("row", { name: /3 PC 'PC-99' not found/ })).toBeInTheDocument();

  await user.click(within(dialog).getByRole("checkbox", { name: /Import valid rows only/ }));
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
  await waitFor(() => expect(within(dialog).getByRole("status", { name: "Import report" })).toHaveTextContent("2 of 3 rows imported"));
  const imports = calls.filter((c) => c.url.pathname.endsWith("/question-bank/import"));
  expect(imports.map((c) => c.url.searchParams.get("partial"))).toEqual([null, "true"]);
  expect(imports[1]?.body).toBeInstanceOf(Blob);
});

it("refuses a file that is not .xlsx before sending it", async () => {
  const user = userEvent.setup({ applyAccept: false });
  const calls = install(listing([]));
  open("aa_admin");
  await user.click(await screen.findByRole("button", { name: "Import from Excel" }));
  const dialog = await screen.findByRole("dialog", { name: "Import questions from Excel" });
  await user.upload(within(dialog).getByLabelText("Excel file"), new File(["x"], "questions.csv", { type: "text/csv" }));
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Only .xlsx files can be imported.");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

it("keeps candidates out", async () => {
  install(listing([]));
  open("candidate");
  expect(await screen.findByRole("heading", { name: "Candidate" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Question bank" })).not.toBeInTheDocument();
});
