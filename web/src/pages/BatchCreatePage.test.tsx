import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { IDS, batchRecord, emptyMasterList } from "../test/batchFixtures";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function methodOf(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function requestBody(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== "string") return undefined;
  return JSON.parse(init.body);
}

function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function masterLists(url: URL) {
  if (
    url.pathname.endsWith("/awarding-bodies") ||
    url.pathname.endsWith("/qualifications") ||
    url.pathname.endsWith("/training-partners") ||
    url.pathname.endsWith("/centres")
  ) {
    return jsonResponse(200, emptyMasterList());
  }
  return null;
}

async function fillRequired() {
  await screen.findByLabelText("Awarding body");
  fireEvent.change(screen.getByLabelText("Awarding body"), { target: { value: IDS.ab } });
  fireEvent.change(screen.getByLabelText("Qualification"), { target: { value: IDS.qualification } });
  fireEvent.change(screen.getByLabelText("Assessment start date"), { target: { value: "2026-11-20" } });
  fireEvent.change(screen.getByLabelText("Assessment end date"), { target: { value: "2026-11-21" } });
  fireEvent.change(screen.getByLabelText("Training partner"), { target: { value: IDS.tp } });
  fireEvent.change(screen.getByLabelText("Centre"), { target: { value: IDS.centre } });
  fireEvent.change(screen.getByLabelText("Candidate count"), { target: { value: "24" } });
}

it("validates required create fields including assessment language", async () => {
  const user = userEvent.setup();
  installFetch(async (url) => masterLists(url) ?? jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } }));
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  await user.click(await screen.findByRole("button", { name: "Create batch" }));
  expect(screen.getByRole("alert")).toHaveTextContent("assessment language");
  expect(screen.getByRole("alert")).toHaveTextContent("24-character awarding body");
});

it("sends the contract create body", async () => {
  const user = userEvent.setup();
  const created = batchRecord();
  const fetchMock = installFetch(async (url, init) => {
    const lists = masterLists(url);
    if (lists) return lists;
    if (methodOf(init) === "POST" && url.pathname.endsWith("/batches")) {
      return jsonResponse(201, created);
    }
    if (url.pathname.endsWith(`/batches/${created.id}`)) return jsonResponse(200, created);
    if (url.pathname.endsWith("/batches")) return jsonResponse(200, { page: 1, pageSize: 20, total: 1, items: [created] });
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  await fillRequired();
  await user.type(screen.getByLabelText("Assessment language"), "Hindi");
  await user.click(screen.getByRole("button", { name: "Create batch" }));
  expect(await screen.findByRole("heading", { name: `Batch ${created.id}` })).toBeInTheDocument();
  const createCall = fetchMock.mock.calls.find(
    (call) => methodOf(call[1]) === "POST" && requestUrl(call[0]).pathname.endsWith("/batches"),
  );
  expect(requestBody(createCall?.[1])).toEqual({
    abId: IDS.ab,
    qualificationId: IDS.qualification,
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId: IDS.tp,
    centreId: IDS.centre,
    candidateCount: 24,
    assessmentLanguage: "Hindi",
  });
});

it("shows a recognition override for aa_admin and resends it", async () => {
  const user = userEvent.setup();
  const created = batchRecord({
    recognitionOverride: {
      byUserId: "66f000000000000000000001",
      reason: "AB confirmed coverage",
      at: "2026-10-12T12:00:00.000Z",
      checks: ["sector"],
    },
  });
  const fetchMock = installFetch(async (url, init) => {
    const lists = masterLists(url);
    if (lists) return lists;
    if (methodOf(init) === "POST" && url.pathname.endsWith("/batches")) {
      const body = requestBody(init) as { recognitionOverrideReason?: string };
      if (!body.recognitionOverrideReason) {
        return jsonResponse(409, {
          error: {
            code: "RULE_OUTSIDE_RECOGNITION",
            message: "Outside recognition",
            details: { checks: ["sector"] },
          },
        });
      }
      return jsonResponse(201, created);
    }
    if (url.pathname.endsWith(`/batches/${created.id}`)) return jsonResponse(200, created);
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  await fillRequired();
  await user.type(screen.getByLabelText("Assessment language"), "Hindi");
  await user.click(screen.getByRole("button", { name: "Create batch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("outside recognition");
  expect(screen.getByRole("alert")).toHaveTextContent("not a recognised sector");
  await user.type(screen.getByLabelText("Recognition override reason"), "AB confirmed coverage");
  await user.click(screen.getByRole("button", { name: "Create with override" }));
  expect(await screen.findByRole("heading", { name: `Batch ${created.id}` })).toBeInTheDocument();
  const posts = fetchMock.mock.calls.filter(
    (call) => methodOf(call[1]) === "POST" && requestUrl(call[0]).pathname.endsWith("/batches"),
  );
  expect(requestBody(posts[1]?.[1])).toMatchObject({ recognitionOverrideReason: "AB confirmed coverage" });
});

it("does not offer a recognition override to an AB reviewer", async () => {
  const user = userEvent.setup();
  installFetch(async (url, init) => {
    const lists = masterLists(url);
    if (lists) return lists;
    if (methodOf(init) === "POST" && url.pathname.endsWith("/batches")) {
      return jsonResponse(409, {
        error: { code: "RULE_OUTSIDE_RECOGNITION", message: "Outside recognition", details: { checks: ["state"] } },
      });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("ab_reviewer"));
  renderApp("/batches/new");
  await fillRequired();
  await user.type(screen.getByLabelText("Assessment language"), "Hindi");
  await user.click(screen.getByRole("button", { name: "Create batch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("outside recognition");
  expect(screen.queryByLabelText("Recognition override reason")).not.toBeInTheDocument();
});

it("sends mis away from create", async () => {
  installFetch(async (url) => {
    if (url.pathname.endsWith("/batches")) return jsonResponse(200, { page: 1, pageSize: 20, total: 0, items: [] });
    return masterLists(url) ?? jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("mis"));
  renderApp("/batches/new");
  expect(await screen.findByRole("heading", { name: "Batches" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Create batch" })).not.toBeInTheDocument();
});
