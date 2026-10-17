import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BATCH_SETTINGS } from "../../api/batchSettings";
import { setSession } from "../../api/session";
import { IDS, batchRecord, emptyMasterList } from "../../test/batchFixtures";
import { jsonResponse, sessionFor } from "../../test/fixtures";
import { PAPER_ID, paperDoc, qualificationList } from "../../test/questionFixtures";
import { renderApp } from "../../test/render";
import { buildPaperRequest, evenQuotas } from "./paperPlan";

const notFound = () => jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });

function install(handler: (url: URL, init?: RequestInit) => Response | null) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const custom = handler(url, init);
    if (custom) return custom;
    if (url.pathname.endsWith("/qualifications")) return jsonResponse(200, qualificationList());
    if (
      url.pathname.endsWith("/awarding-bodies") ||
      url.pathname.endsWith("/training-partners") ||
      url.pathname.endsWith("/centres")
    ) {
      return jsonResponse(200, emptyMasterList());
    }
    if (method === "POST" && url.pathname.endsWith("/batches")) return jsonResponse(201, batchRecord());
    if (url.pathname.endsWith(`/batches/${batchRecord().id}`)) return jsonResponse(200, batchRecord());
    return notFound();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));
const callsTo = (mock: ReturnType<typeof install>, method: string, suffix: string) =>
  mock.mock.calls.filter(
    (c) =>
      ((c[1] as RequestInit | undefined)?.method ?? "GET").toUpperCase() === method &&
      new URL(String(c[0]), "http://localhost").pathname.endsWith(suffix),
  );

async function fillRequired() {
  await screen.findByLabelText("Awarding body");
  fireEvent.change(screen.getByLabelText("Awarding body"), { target: { value: IDS.ab } });
  fireEvent.change(await screen.findByLabelText("Qualification"), { target: { value: IDS.qualification } });
  fireEvent.change(screen.getByLabelText("Assessment start date"), { target: { value: "2026-11-20" } });
  fireEvent.change(screen.getByLabelText("Assessment end date"), { target: { value: "2026-11-21" } });
  fireEvent.change(screen.getByLabelText("Training partner"), { target: { value: IDS.tp } });
  fireEvent.change(screen.getByLabelText("Centre"), { target: { value: IDS.centre } });
  fireEvent.change(screen.getByLabelText("Assessment language"), { target: { value: "Hindi" } });
}

describe("paper plan helpers (X-18)", () => {
  it("splits the count evenly, the first NOS getting the remainder, and drops zero counts", () => {
    const nos = [{ nosId: "A" }, { nosId: "B" }, { nosId: "C" }];
    expect(evenQuotas(nos, 7)).toEqual([
      { nosId: "A", count: 3 },
      { nosId: "B", count: 2 },
      { nosId: "C", count: 2 },
    ]);
    expect(evenQuotas(nos, 2)).toEqual([
      { nosId: "A", count: 1 },
      { nosId: "B", count: 1 },
    ]);
    expect(evenQuotas([], 5)).toEqual([]);
    expect(evenQuotas(nos, 0)).toEqual([]);
  });

  it("checks the build plan and makes the generate body", () => {
    const plan = { mode: "build", totalQuestions: "4", weightProfileId: "P1", durationMinutes: "45", sendForApproval: true } as const;
    const nos = [{ nosId: "A" }, { nosId: "B" }];
    expect(buildPaperRequest(plan, "Q1", "Hindi", nos)).toEqual({
      input: {
        qualificationId: "Q1",
        language: "hi",
        quotas: [
          { nosId: "A", count: 2 },
          { nosId: "B", count: 2 },
        ],
        allowPartial: false,
        weightProfileId: "P1",
        durationMinutes: 45,
      },
    });
    expect(buildPaperRequest({ ...plan, totalQuestions: "0" }, "Q1", "Hindi", nos)).toHaveProperty("problem");
    expect(buildPaperRequest({ ...plan, totalQuestions: "501" }, "Q1", "Hindi", nos)).toHaveProperty("problem");
    expect(buildPaperRequest({ ...plan, durationMinutes: "x" }, "Q1", "Hindi", nos)).toHaveProperty("problem");
    expect(buildPaperRequest(plan, "Q1", "Hindi", [])).toHaveProperty("problem");
  });
});

describe("create batch with a paper step (X-18)", () => {
  it("builds a draft from the bank by count and difficulty mix, sends it for approval, and keeps the batch", async () => {
    const user = userEvent.setup();
    const mock = install((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.pathname.endsWith("/weight-profiles")) {
        return jsonResponse(200, { items: [{ rootProfileId: "WP1", name: "Balanced", version: 2 }] });
      }
      if (method === "POST" && url.pathname.endsWith("/tests/generate")) return jsonResponse(201, paperDoc());
      if (method === "POST" && url.pathname.endsWith(`/tests/${PAPER_ID}/submit`)) {
        return jsonResponse(200, paperDoc({ status: "submitted" }));
      }
      return null;
    });
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("radio", { name: "Build a new paper from the question bank" }));
    await user.type(screen.getByLabelText("Number of questions"), "5");
    await user.selectOptions(await screen.findByLabelText("Difficulty mix"), "WP1");
    await user.click(screen.getByRole("button", { name: "Create batch" }));

    expect(await screen.findByText(/A draft paper was sent for approval/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the batch" })).toBeInTheDocument();
    const generate = callsTo(mock, "POST", "/tests/generate")[0];
    expect(bodyOf(generate[1] as RequestInit)).toEqual({
      qualificationId: IDS.qualification,
      language: "hi",
      quotas: [
        { nosId: "NOS-01", count: 3 },
        { nosId: "NOS-02", count: 2 },
      ],
      allowPartial: false,
      weightProfileId: "WP1",
    });
    expect(callsTo(mock, "POST", `/tests/${PAPER_ID}/submit`)).toHaveLength(1);
    // One batch only, and the form is locked so a second click cannot make another.
    expect(callsTo(mock, "POST", "/batches")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create batch" })).toBeDisabled();
  });

  it("sets an approved paper on the new batch", async () => {
    const user = userEvent.setup();
    const mock = install((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname.endsWith("/tests")) {
        return jsonResponse(200, {
          page: 1,
          pageSize: 100,
          total: 1,
          items: [paperDoc({ status: "approved", rules: { language: "hi", quotas: [] } })],
        });
      }
      if (method === "PUT" && url.pathname.endsWith("/test-paper")) return jsonResponse(200, batchRecord());
      return null;
    });
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("radio", { name: "Use an approved paper" }));
    await user.selectOptions(await screen.findByLabelText("Approved paper"), PAPER_ID);
    await user.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByRole("heading", { name: `Batch ${batchRecord().id}` })).toBeInTheDocument();
    const put = callsTo(mock, "PUT", "/test-paper")[0];
    expect(bodyOf(put[1] as RequestInit)).toEqual({ testPaperId: PAPER_ID });
  });

  it("asks for a paper before creating when 'Use an approved paper' has none chosen", async () => {
    const user = userEvent.setup();
    const mock = install(() => null);
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("radio", { name: "Use an approved paper" }));
    await user.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the approved paper");
    expect(callsTo(mock, "POST", "/batches")).toHaveLength(0);
  });

  it("keeps the batch and says so when the bank cannot fill the paper", async () => {
    const user = userEvent.setup();
    install((url, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "POST" && url.pathname.endsWith("/tests/generate")) {
        return jsonResponse(422, { error: { code: "TEST_BANK_SHORTAGE", message: "The bank has too few questions" } });
      }
      return null;
    });
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("radio", { name: "Build a new paper from the question bank" }));
    await user.type(screen.getByLabelText("Number of questions"), "50");
    await user.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByText(/The batch was created, but the paper could not be built/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the batch" })).toBeInTheDocument();
  });

  it("does not show the paper step to a reviewer, who cannot set papers", async () => {
    install(() => null);
    setSession(sessionFor("ab_reviewer"));
    renderApp("/batches/new");
    await screen.findByLabelText("Awarding body");
    expect(screen.queryByText(/Question paper/)).not.toBeInTheDocument();
  });
});

describe("create batch: mock test and exam settings (X-19)", () => {
  const settingsReply = (url: URL, init?: RequestInit) =>
    (init?.method ?? "GET").toUpperCase() === "PATCH" && url.pathname.endsWith("/settings")
      ? jsonResponse(200, { settings: DEFAULT_BATCH_SETTINGS })
      : null;

  it("sends only the changed exam settings, then goes to the batch", async () => {
    const user = userEvent.setup();
    const mock = install(settingsReply);
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("checkbox", { name: "Show marks to the candidate" }));
    await user.click(screen.getByRole("checkbox", { name: "Check for talking" }));
    await user.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByRole("heading", { name: `Batch ${batchRecord().id}` })).toBeInTheDocument();
    const patch = callsTo(mock, "PATCH", "/settings")[0];
    expect(bodyOf(patch[1] as RequestInit)).toEqual({ showMarksToCandidate: true, detectVoice: false });
  });

  it("sends no settings call when nothing was changed", async () => {
    const user = userEvent.setup();
    const mock = install(settingsReply);
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByRole("heading", { name: `Batch ${batchRecord().id}` })).toBeInTheDocument();
    expect(callsTo(mock, "PATCH", "/settings")).toHaveLength(0);
  });

  it("mock test: saves the switch first, builds the paper and sets it without sending it to the reviewer", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const mock = install((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const settings = settingsReply(url, init);
      if (settings) {
        order.push("settings");
        return settings;
      }
      if (method === "POST" && url.pathname.endsWith("/tests/generate")) {
        order.push("generate");
        return jsonResponse(201, paperDoc());
      }
      if (method === "PUT" && url.pathname.endsWith("/test-paper")) {
        order.push("set-paper");
        return jsonResponse(200, batchRecord());
      }
      return null;
    });
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("checkbox", { name: "Mock test: use a paper without the reviewer's approval" }));
    await user.click(screen.getByRole("radio", { name: "Build a new paper from the question bank" }));
    await user.type(screen.getByLabelText("Number of questions"), "4");
    expect(screen.queryByText(/Send the new paper to the awarding body reviewer/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByText(/the new paper was set on it for the mock test/)).toBeInTheDocument();
    expect(order).toEqual(["settings", "generate", "set-paper"]);
    expect(bodyOf(callsTo(mock, "PATCH", "/settings")[0][1] as RequestInit)).toEqual({ skipPaperApproval: true });
    expect(callsTo(mock, "POST", `/tests/${PAPER_ID}/submit`)).toHaveLength(0);
  });

  it("keeps the batch and skips the paper when the settings cannot be saved", async () => {
    const user = userEvent.setup();
    const mock = install((url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH" && url.pathname.endsWith("/settings")) {
        return jsonResponse(500, { error: { code: "INTERNAL", message: "Could not save" } });
      }
      if (method === "GET" && url.pathname.endsWith("/tests")) {
        return jsonResponse(200, {
          page: 1,
          pageSize: 100,
          total: 1,
          items: [paperDoc({ status: "approved", rules: { language: "hi", quotas: [] } })],
        });
      }
      return null;
    });
    setSession(sessionFor("aa_admin"));
    renderApp("/batches/new");
    await fillRequired();
    await user.click(screen.getByRole("checkbox", { name: "Show marks to the candidate" }));
    await user.click(screen.getByRole("radio", { name: "Use an approved paper" }));
    await user.selectOptions(await screen.findByLabelText("Approved paper"), PAPER_ID);
    await user.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByText(/exam settings could not be saved/)).toBeInTheDocument();
    expect(callsTo(mock, "PUT", "/test-paper")).toHaveLength(0);
  });
});
