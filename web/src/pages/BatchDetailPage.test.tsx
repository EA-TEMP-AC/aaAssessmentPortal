import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import {
  ACTION_CASES,
  IDS,
  assessorItem,
  batchRecord,
  emptyMasterList,
  listBody,
  proctorItem,
} from "../test/batchFixtures";
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

function defaultListHandler(url: URL, current = batchRecord()) {
  if (url.pathname.endsWith("/batches") && !url.pathname.includes(IDS.batch)) {
    return jsonResponse(200, listBody([current]));
  }
  if (url.pathname.endsWith("/candidates")) return jsonResponse(200, { items: [] });
  // X-10: the Test paper section lists approved papers for aa_admin.
  if (url.pathname.endsWith("/tests")) return jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 100 });
  if (url.pathname.endsWith(`/batches/${IDS.batch}`)) return jsonResponse(200, current);
  if (url.pathname.endsWith("/assessors/available")) return jsonResponse(200, { items: [assessorItem()] });
  if (url.pathname.endsWith("/proctors")) return jsonResponse(200, { page: 1, pageSize: 100, total: 1, items: [proctorItem()] });
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

it.each(ACTION_CASES)("shows $labels for $role when status is $status", async ({ role, status, labels }) => {
  const current = batchRecord({ status });
  installFetch(async (url) => defaultListHandler(url, current) ?? jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } }));
  setSession(sessionFor(role));
  renderApp(`/batches/${IDS.batch}`);
  await screen.findByText("Assessment language");
  if (labels[0]) {
    await screen.findByRole("button", { name: labels[0] });
  } else {
    await screen.findByText("No status changes are available for this role and status.");
  }
  for (const label of ["Accept", "Reject", "Assign assessor", "Reassign assessor", "Cancel", "Complete"]) {
    const button = screen.queryByRole("button", { name: label });
    if (labels.includes(label)) expect(button).toBeInTheDocument();
    else expect(button).not.toBeInTheDocument();
  }
});

it("retries accept with a late reason after SLA_ACCEPT_EXPIRED", async () => {
  const user = userEvent.setup();
  let accepted = false;
  const fetchMock = installFetch(async (url, init) => {
    const listed = defaultListHandler(url, batchRecord());
    if (listed && methodOf(init) === "GET") return listed;
    if (url.pathname.endsWith("/accept")) {
      const body = requestBody(init) as { lateReason?: string };
      if (!body.lateReason) {
        return jsonResponse(409, {
          error: { code: "SLA_ACCEPT_EXPIRED", message: "Accept is past due" },
        });
      }
      accepted = true;
      return jsonResponse(200, batchRecord({ status: "accepted", acceptedAt: "2026-10-12T12:00:00.000Z" }));
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await user.click(await screen.findByRole("button", { name: "Accept" }));
  const dialog = screen.getByRole("dialog", { name: "Accept" });
  await user.click(within(dialog).getByRole("button", { name: "Accept" }));
  expect(await screen.findByLabelText("Late reason")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("past the stored accept due time");
  await user.type(screen.getByLabelText("Late reason"), "AB confirmation delayed");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(/Batch accepted/);
  expect(accepted).toBe(true);
  const acceptCalls = fetchMock.mock.calls.filter((call) => requestUrl(call[0]).pathname.endsWith("/accept"));
  expect(requestBody(acceptCalls[1]?.[1])).toEqual({ lateReason: "AB confirmation delayed" });
});

it("shows each assign rule error in plain language", async () => {
  const user = userEvent.setup();
  const codes = [
    ["RULE_TOA_INVALID", "Training of Assessor"],
    ["RULE_MAX_AAS", "more than four assessment agencies"],
    ["RULE_ASSESSOR_CLASH", "different centre"],
  ] as const;
  for (const [code, phrase] of codes) {
    installFetch(async (url, init) => {
      const listed = defaultListHandler(url, batchRecord({ status: "accepted" }));
      if (listed && methodOf(init) === "GET") return listed;
      if (url.pathname.endsWith("/assign")) {
        return jsonResponse(409, { error: { code, message: code } });
      }
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
    });
    setSession(sessionFor("aa_admin"));
    const view = renderApp(`/batches/${IDS.batch}`);
    await user.click(await screen.findByRole("button", { name: "Assign assessor" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign assessor" });
    await user.click(await within(dialog).findByLabelText(/Asha Assessor/));
    await user.click(within(dialog).getByRole("button", { name: "Assign assessor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(phrase);
    expect(within(dialog).queryByLabelText(/override reason/i)).not.toBeInTheDocument();
    view.unmount();
  }
});

it("retries assign with a ratio override after RULE_RATIO", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url, init) => {
    const listed = defaultListHandler(url, batchRecord({ status: "accepted" }));
    if (listed && methodOf(init) === "GET") return listed;
    if (url.pathname.endsWith("/assign")) {
      const body = requestBody(init) as { ratioOverrideReason?: string };
      if (!body.ratioOverrideReason) {
        return jsonResponse(409, {
          error: {
            code: "RULE_RATIO",
            message: "Over ratio",
            details: { ratioClass: "manufacturing", candidateCount: 30, max: 25 },
          },
        });
      }
      return jsonResponse(200, batchRecord({ status: "assessor_assigned", assessorId: IDS.assessor }));
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await user.click(await screen.findByRole("button", { name: "Assign assessor" }));
  const ratioDialog = await screen.findByRole("dialog", { name: "Assign assessor" });
  await user.click(await within(ratioDialog).findByLabelText(/Asha Assessor/));
  await user.click(within(ratioDialog).getByRole("button", { name: "Assign assessor" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("assessor-to-learner ratio");
  await user.type(within(ratioDialog).getByLabelText("Ratio override reason"), "AB approved larger cohort");
  await user.click(within(ratioDialog).getByRole("button", { name: "Retry" }));
  await screen.findByText(/Assessor assigned/);
  const assignCalls = fetchMock.mock.calls.filter((call) => requestUrl(call[0]).pathname.endsWith("/assign"));
  expect(requestBody(assignCalls[1]?.[1])).toMatchObject({
    assessorId: IDS.assessor,
    ratioOverrideReason: "AB approved larger cohort",
  });
});

it("retries assign with a language override after RULE_ASSESSOR_LANGUAGE", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url, init) => {
    const listed = defaultListHandler(url, batchRecord({ status: "accepted" }));
    if (listed && methodOf(init) === "GET") return listed;
    if (url.pathname.endsWith("/assign")) {
      const body = requestBody(init) as { languageOverrideReason?: string };
      if (!body.languageOverrideReason) {
        return jsonResponse(409, { error: { code: "RULE_ASSESSOR_LANGUAGE", message: "Language does not match" } });
      }
      return jsonResponse(200, batchRecord({ status: "assessor_assigned", assessorId: IDS.assessor }));
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await user.click(await screen.findByRole("button", { name: "Assign assessor" }));
  const languageDialog = await screen.findByRole("dialog", { name: "Assign assessor" });
  await user.click(await within(languageDialog).findByLabelText(/Asha Assessor/));
  await user.click(within(languageDialog).getByRole("button", { name: "Assign assessor" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("assessment language");
  await user.type(within(languageDialog).getByLabelText("Language override reason"), "Proctor will brief in Hindi");
  await user.click(within(languageDialog).getByRole("button", { name: "Retry" }));
  await screen.findByText(/Assessor assigned/);
  const assignCalls = fetchMock.mock.calls.filter((call) => requestUrl(call[0]).pathname.endsWith("/assign"));
  expect(requestBody(assignCalls[1]?.[1])).toMatchObject({
    languageOverrideReason: "Proctor will brief in Hindi",
  });
});

it("retries assign with a late reason after SLA_ASSIGN_EXPIRED", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url, init) => {
    const listed = defaultListHandler(url, batchRecord({ status: "accepted" }));
    if (listed && methodOf(init) === "GET") return listed;
    if (url.pathname.endsWith("/assign")) {
      const body = requestBody(init) as { lateReason?: string };
      if (!body.lateReason) {
        return jsonResponse(409, { error: { code: "SLA_ASSIGN_EXPIRED", message: "Assign is past due" } });
      }
      return jsonResponse(200, batchRecord({ status: "assessor_assigned", assessorId: IDS.assessor }));
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await user.click(await screen.findByRole("button", { name: "Assign assessor" }));
  const lateDialog = await screen.findByRole("dialog", { name: "Assign assessor" });
  await user.click(await within(lateDialog).findByLabelText(/Asha Assessor/));
  await user.click(within(lateDialog).getByRole("button", { name: "Assign assessor" }));
  expect(await within(lateDialog).findByLabelText("Late reason")).toBeInTheDocument();
  expect(within(lateDialog).getByRole("alert")).toHaveTextContent("past the stored assign due time");
  await user.type(within(lateDialog).getByLabelText("Late reason"), "Travel clearance delayed");
  await user.click(within(lateDialog).getByRole("button", { name: "Retry" }));
  await screen.findByText(/Assessor assigned/);
  const assignCalls = fetchMock.mock.calls.filter((call) => requestUrl(call[0]).pathname.endsWith("/assign"));
  expect(requestBody(assignCalls[1]?.[1])).toMatchObject({ lateReason: "Travel clearance delayed" });
});

it("shows non-blocking assign warnings", async () => {
  const user = userEvent.setup();
  installFetch(async (url, init) => {
    const listed = defaultListHandler(url, batchRecord({ status: "accepted" }));
    if (listed && methodOf(init) === "GET") return listed;
    if (url.pathname.endsWith("/assign")) {
      return jsonResponse(
        200,
        batchRecord({
          status: "assessor_assigned",
          assessorId: IDS.assessor,
          warnings: [
            {
              code: "SAME_CENTRE_LOW_CANDIDATES",
              message: "Same assessor has another batch at this centre on an overlapping day with fewer than 10 candidates",
            },
          ],
        }),
      );
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await user.click(await screen.findByRole("button", { name: "Assign assessor" }));
  const warningDialog = await screen.findByRole("dialog", { name: "Assign assessor" });
  await user.click(await within(warningDialog).findByLabelText(/Asha Assessor/));
  await user.click(within(warningDialog).getByRole("button", { name: "Assign assessor" }));
  expect(await screen.findByText(/Assignment warning/)).toHaveTextContent("fewer than 10 candidates");
});

it("renders status history when the API returns it", async () => {
  installFetch(async (url) =>
    defaultListHandler(
      url,
      batchRecord({
        statusHistory: [{ action: "create", status: "allocated", at: "2026-10-08T08:00:00.000Z" }],
      }),
    ) ?? jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } }),
  );
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  expect(await screen.findByRole("heading", { name: "Status history" })).toBeInTheDocument();
  expect(screen.getByText(/create: allocated/)).toBeInTheDocument();
});

it("requires a reason to reject", async () => {
  const user = userEvent.setup();
  installFetch(async (url) => defaultListHandler(url) ?? jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } }));
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await user.click(await screen.findByRole("button", { name: "Reject" }));
  const rejectDialog = await screen.findByRole("dialog", { name: "Reject" });
  await user.click(within(rejectDialog).getByRole("button", { name: "Reject" }));
  expect(within(rejectDialog).getByRole("alert")).toHaveTextContent("Enter a reason");
});
