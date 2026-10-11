import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AwardingBody, Learner, Qualification } from "../api/masterData";
import { setSession } from "../api/session";
import { ROLE_LABELS, ROLES, type Role } from "../routing/access";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const WRITERS: readonly Role[] = ["aa_admin", "mis"];
const SUBNAV: Partial<Record<Role, readonly string[]>> = {
  aa_admin: ["Awarding bodies", "Training partners", "Centres", "Qualifications", "Learners"],
  mis: ["Awarding bodies", "Training partners", "Centres", "Qualifications", "Learners"],
  ncvet_viewer: ["Awarding bodies", "Training partners", "Centres", "Qualifications", "Learners"],
  ab_reviewer: ["Awarding bodies", "Qualifications"],
  tp: ["Training partners", "Centres"],
  candidate: ["Learners"],
};

const CREATE_LABEL: Partial<Record<Role, string>> = {
  aa_admin: "Create awarding body",
  mis: "Create awarding body",
  ncvet_viewer: "Create awarding body",
  ab_reviewer: "Create awarding body",
  tp: "Create training partner",
  candidate: "Create learner",
};

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

function listBody(items: unknown[], extra: { page?: number; pageSize?: number; total?: number } = {}) {
  return {
    page: extra.page ?? 1,
    pageSize: extra.pageSize ?? 20,
    total: extra.total ?? items.length,
    items,
  };
}

function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof installFetch>, method: string, pathEnds: string) {
  return fetchMock.mock.calls.filter((call) => {
    const url = requestUrl(call[0]);
    return methodOf(call[1]) === method && url.pathname.endsWith(pathEnds);
  });
}

function awardingBody(overrides: Partial<AwardingBody> = {}): AwardingBody {
  return {
    id: "66f0000000000000000000ab",
    name: "Sample Body",
    code: "AB-SAMPLE",
    notificationEmails: ["notify@example.com"],
    active: true,
    createdAt: "2026-10-01T09:30:00.000Z",
    updatedAt: "2026-10-02T09:30:00.000Z",
    ...overrides,
  };
}

function learner(overrides: Partial<Learner> = {}): Learner {
  return {
    id: "66f0000000000000000000L1",
    name: "Asha Devi",
    externalRef: "TP-REG-10021",
    phone: "9876543210",
    accommodations: ["Extra time"],
    active: true,
    createdAt: "2026-10-01T09:30:00.000Z",
    updatedAt: "2026-10-02T09:30:00.000Z",
    ...overrides,
  };
}

function qualification(overrides: Partial<Qualification> = {}): Qualification {
  return {
    id: "66f0000000000000000000q1",
    code: "Q-ELEC-L4",
    name: "Electrician L4",
    sector: "Electronics",
    ratioClass: "manufacturing",
    defaultBatchType: null,
    passCriteriaMode: null,
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    maxMarks: null,
    nos: [
      {
        nosId: "NOS-01",
        code: "N01",
        name: "Safety",
        maxMarks: null,
        pcs: [{ pcId: "PC-01", code: "P1", name: "PPE", passMark: null, maxMark: null }],
      },
    ],
    pcPassMarksRequired: false,
    createdAt: "2026-10-01T09:30:00.000Z",
    updatedAt: "2026-10-02T09:30:00.000Z",
    ...overrides,
  };
}

async function fillQualification(user: ReturnType<typeof userEvent.setup>, withNos = true) {
  const dialog = screen.getByRole("dialog", { name: "Create qualification" });
  await user.type(within(dialog).getByLabelText("Code"), "Q-ELEC-L4");
  await user.type(within(dialog).getByLabelText("Name"), "Electrician L4");
  await user.selectOptions(within(dialog).getByLabelText("Sector"), "Electronics");
  await user.selectOptions(within(dialog).getByLabelText("Ratio class"), "manufacturing");
  await user.type(within(dialog).getByLabelText("Theory pass mark"), "50");
  await user.type(within(dialog).getByLabelText("Practical pass mark"), "50");
  await user.type(within(dialog).getByLabelText("Viva pass mark"), "50");
  if (withNos) {
    await user.click(within(dialog).getByRole("button", { name: "Add NOS" }));
    await user.type(within(dialog).getByLabelText("NOS 1 id"), "NOS-01");
    await user.type(within(dialog).getByLabelText("NOS 1 code"), "N01");
    await user.type(within(dialog).getByLabelText("NOS 1 name"), "Safety");
    await user.click(within(dialog).getByRole("button", { name: "Add performance criterion to NOS 1" }));
    await user.type(within(dialog).getByLabelText("Performance criterion 1 id for NOS 1"), "PC-01");
    await user.type(within(dialog).getByLabelText("Performance criterion 1 code for NOS 1"), "P1");
    await user.type(within(dialog).getByLabelText("Performance criterion 1 name for NOS 1"), "PPE");
  }
  return dialog;
}

it.each(ROLES)("shows master data only to roles the server can serve (%s)", async (role) => {
  const fetchMock = installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor(role));
  renderApp("/master-data");

  const links = SUBNAV[role];
  if (!links) {
    expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Master data" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    return;
  }

  expect(await screen.findByRole("heading", { name: links[0] ?? "" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Master data" })).toHaveAttribute("aria-current", "page");
  expect(
    within(screen.getByRole("navigation", { name: "Master data" }))
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(links);
  expect(screen.getByText(/may not include every record/)).toBeInTheDocument();
  const createLabel = CREATE_LABEL[role] ?? "";
  if (WRITERS.includes(role)) expect(screen.getByRole("button", { name: createLabel })).toBeInTheDocument();
  else expect(screen.queryByRole("button", { name: createLabel })).not.toBeInTheDocument();
});

it("keeps a collection the role cannot read off the server", async () => {
  const fetchMock = installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor("ab_reviewer"));
  renderApp("/master-data/learners");

  expect(await screen.findByRole("heading", { name: "Learners" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("This list is not available for your role.");
  expect(screen.queryByRole("button", { name: "Create learner" })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    within(screen.getByRole("navigation", { name: "Master data" }))
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Awarding bodies", "Qualifications"]);
});

it("shows awarding bodies, qualifications, and learners as read-only when the role cannot write", async () => {
  installFetch(async (url) => {
    if (url.pathname.endsWith("/qualifications")) return jsonResponse(200, listBody([qualification()]));
    if (url.pathname.endsWith("/learners")) return jsonResponse(200, listBody([learner()]));
    return jsonResponse(200, listBody([awardingBody()]));
  });

  setSession(sessionFor("ncvet_viewer"));
  renderApp("/master-data/awarding-bodies");
  const awardingRow = await screen.findByRole("row", { name: /Sample Body/ });
  expect(within(awardingRow).queryAllByRole("button")).toEqual([]);
  expect(screen.queryByRole("button", { name: "Create awarding body" })).not.toBeInTheDocument();
  expect(screen.getByText(/cannot create, edit, or remove/)).toBeInTheDocument();

  cleanup();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/master-data/qualifications");
  const qualificationRow = await screen.findByRole("row", { name: /Electrician L4/ });
  expect(within(qualificationRow).queryAllByRole("button")).toEqual([]);
  expect(screen.queryByRole("button", { name: "Create qualification" })).not.toBeInTheDocument();

  cleanup();
  setSession(sessionFor("candidate"));
  renderApp("/master-data/learners");
  const learnerRow = await screen.findByRole("row", { name: /Asha Devi/ });
  expect(within(learnerRow).queryAllByRole("button")).toEqual([]);
  expect(screen.queryByRole("button", { name: "Create learner" })).not.toBeInTheDocument();
});

it("pages awarding bodies with the returned page, pageSize, and total", async () => {
  const user = userEvent.setup();
  const rows = ["One", "Two", "Three", "Four", "Five"].map((name, index) =>
    awardingBody({
      id: `66f00000000000000000000${index + 1}`,
      name: `Body ${name}`,
      code: `AB-${index + 1}`,
      notificationEmails: [`body${index + 1}@example.com`],
    }),
  );
  const fetchMock = installFetch(async (url) => {
    const page = Number(url.searchParams.get("page") ?? "1");
    const start = (page - 1) * 2;
    return jsonResponse(200, listBody(rows.slice(start, start + 2), { page, pageSize: 2, total: rows.length }));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/master-data/awarding-bodies");

  expect(await screen.findByText("Page 1 of 3. 2 per page. 5 awarding bodies.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("cell", { name: "Body Three" })).toBeInTheDocument();
  const params = requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams;
  expect(params.get("page")).toBe("2");
  expect(params.get("pageSize")).toBe("20");
  expect(params.get("q")).toBeNull();
});

it("filters awarding bodies by status and shows an empty filter result", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url) => {
    if (url.searchParams.get("active") === "false") return jsonResponse(200, listBody([]));
    return jsonResponse(200, listBody([awardingBody()]));
  });
  setSession(sessionFor("mis"));
  renderApp("/master-data/awarding-bodies");
  expect(await screen.findByRole("cell", { name: "Sample Body" })).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Status"), "false");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No awarding bodies match these filters.")).toBeInTheDocument();
  expect(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams.get("active")).toBe("false");
});

it("creates, edits, and deactivates an awarding body", async () => {
  const user = userEvent.setup();
  const existing = awardingBody();
  const fetchMock = installFetch(async (_url, init) => {
    const method = methodOf(init);
    if (method === "POST") {
      return jsonResponse(201, awardingBody({ name: "New Body", code: null, notificationEmails: ["new@example.com"] }));
    }
    if (method === "PATCH") return jsonResponse(200, awardingBody({ name: "Renamed Body" }));
    if (method === "DELETE") return jsonResponse(200, awardingBody({ active: false }));
    return jsonResponse(200, listBody([existing]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/master-data/awarding-bodies");
  expect(await screen.findByRole("cell", { name: "Sample Body" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create awarding body" }));
  const createDialog = screen.getByRole("dialog", { name: "Create awarding body" });
  await user.type(within(createDialog).getByLabelText("Name"), "New Body");
  await user.type(within(createDialog).getByLabelText("Notification email 1"), "new@example.com");
  await user.click(within(createDialog).getByRole("button", { name: "Create awarding body" }));
  const createdNotice = await screen.findByText("New Body was created.");
  expect(createdNotice).toHaveAttribute("role", "status");
  const created = requestBody(calls(fetchMock, "POST", "/awarding-bodies").at(-1)?.[1]);
  expect(created).toEqual({ name: "New Body", notificationEmails: ["new@example.com"], active: true });

  await user.click(screen.getByRole("button", { name: "Edit Sample Body" }));
  const editDialog = screen.getByRole("dialog", { name: "Edit Sample Body" });
  await user.clear(within(editDialog).getByLabelText("Name"));
  await user.type(within(editDialog).getByLabelText("Name"), "Renamed Body");
  await user.click(within(editDialog).getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Renamed Body was saved.")).toBeInTheDocument();
  expect(requestBody(calls(fetchMock, "PATCH", `/awarding-bodies/${existing.id}`).at(-1)?.[1])).toMatchObject({
    name: "Renamed Body",
    code: "AB-SAMPLE",
    notificationEmails: ["notify@example.com"],
    active: true,
  });

  await user.click(screen.getByRole("button", { name: "Deactivate Sample Body" }));
  const confirm = screen.getByRole("dialog", { name: "Deactivate Sample Body?" });
  expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(within(confirm).getByRole("button", { name: "Deactivate" }));
  expect(await screen.findByText("Sample Body is now inactive.")).toBeInTheDocument();
  expect(calls(fetchMock, "DELETE", `/awarding-bodies/${existing.id}`)).toHaveLength(1);
});

it("shows DUPLICATE_RESOURCE on the awarding body form and restores focus when the dialog closes", async () => {
  const user = userEvent.setup();
  installFetch(async (_url, init) => {
    if (methodOf(init) === "POST") {
      return jsonResponse(409, {
        error: { code: "DUPLICATE_RESOURCE", message: "A record with this code already exists" },
      });
    }
    return jsonResponse(200, listBody([]));
  });
  setSession(sessionFor("mis"));
  renderApp("/master-data/awarding-bodies");
  await screen.findByRole("heading", { name: "Awarding bodies" });

  await user.click(screen.getByRole("button", { name: "Create awarding body" }));
  const dialog = screen.getByRole("dialog", { name: "Create awarding body" });
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create awarding body" })).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Create awarding body" }));
  const reopen = screen.getByRole("dialog", { name: "Create awarding body" });
  await user.type(within(reopen).getByLabelText("Name"), "New Body");
  await user.type(within(reopen).getByLabelText("Code"), "AB-SAMPLE");
  await user.type(within(reopen).getByLabelText("Notification email 1"), "new@example.com");
  await user.click(within(reopen).getByRole("button", { name: "Create awarding body" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("DUPLICATE_RESOURCE");
  expect(alert).toHaveTextContent("A record with this code already exists");
  expect(alert).toHaveFocus();
  expect(dialog).not.toBe(null);
});

it("requires a centre state and sends it with the training partner id", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (_url, init) => {
    if (methodOf(init) === "POST") {
      return jsonResponse(201, {
        id: "66f0000000000000000000c1",
        name: "Andheri Centre",
        code: null,
        tpId: "66f000000000000000000011",
        state: "Maharashtra",
        active: true,
        createdAt: "2026-10-01T09:30:00.000Z",
        updatedAt: "2026-10-01T09:30:00.000Z",
      });
    }
    return jsonResponse(200, listBody([]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/master-data/centres");
  await screen.findByRole("heading", { name: "Centres" });
  await user.click(screen.getByRole("button", { name: "Create centre" }));
  const dialog = screen.getByRole("dialog", { name: "Create centre" });
  await user.type(within(dialog).getByLabelText("Name"), "Andheri Centre");
  await user.type(within(dialog).getByLabelText("Training partner id"), "66f000000000000000000011");
  expect(within(dialog).getByRole("option", { name: "Maharashtra" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("option", { name: "manufacturing" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Create centre" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Choose a state.");
  expect(within(dialog).getByLabelText("State")).toHaveFocus();
  expect(calls(fetchMock, "POST", "/centres")).toHaveLength(0);

  await user.selectOptions(within(dialog).getByLabelText("State"), "Maharashtra");
  await user.click(within(dialog).getByRole("button", { name: "Create centre" }));
  expect(await screen.findByText("Andheri Centre was created.")).toBeInTheDocument();
  expect(requestBody(calls(fetchMock, "POST", "/centres").at(-1)?.[1])).toMatchObject({
    name: "Andheri Centre",
    tpId: "66f000000000000000000011",
    state: "Maharashtra",
    active: true,
  });
});

it("asks a centre writer for a training partner id and only offers that filter to roles who read every centre", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor("tp"));
  renderApp("/master-data/centres");
  expect(await screen.findByRole("heading", { name: "Centres" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Training partner id")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create centre" })).not.toBeInTheDocument();

  cleanup();
  setSession(sessionFor("aa_admin"));
  renderApp("/master-data/centres");
  expect(await screen.findByLabelText("Training partner id")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Training partner id"), "not-an-id");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("24-character id");
  expect(fetchMock.mock.calls.every((call) => !requestUrl(call[0]).searchParams.has("tpId"))).toBe(true);
});

it("creates, edits, and deletes a qualification, including NOS and performance criteria", async () => {
  const user = userEvent.setup();
  const existing = qualification();
  const fetchMock = installFetch(async (_url, init) => {
    const method = methodOf(init);
    if (method === "POST") return jsonResponse(201, qualification({ name: "Electrician L4" }));
    if (method === "PATCH") return jsonResponse(200, qualification({ name: "Renamed L4" }));
    if (method === "DELETE") return jsonResponse(204);
    return jsonResponse(200, listBody([existing]));
  });
  setSession(sessionFor("mis"));
  renderApp("/master-data/qualifications");
  expect(await screen.findByRole("cell", { name: "Electrician L4" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Electronics" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Manufacturing" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create qualification" }));
  const dialog = await fillQualification(user);
  await user.click(within(dialog).getByRole("button", { name: "Create qualification" }));
  expect(await screen.findByText("Electrician L4 was created.")).toBeInTheDocument();
  expect(requestBody(calls(fetchMock, "POST", "/qualifications").at(-1)?.[1])).toEqual({
    code: "Q-ELEC-L4",
    name: "Electrician L4",
    sector: "Electronics",
    ratioClass: "manufacturing",
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    nos: [{ nosId: "NOS-01", code: "N01", name: "Safety", pcs: [{ pcId: "PC-01", code: "P1", name: "PPE" }] }],
    pcPassMarksRequired: false,
  });

  await user.click(screen.getByRole("button", { name: "Edit Electrician L4" }));
  const editDialog = screen.getByRole("dialog", { name: "Edit Electrician L4" });
  expect(within(editDialog).getByLabelText("NOS 1 code")).toHaveValue("N01");
  expect(within(editDialog).getByLabelText("Performance criterion 1 name for NOS 1")).toHaveValue("PPE");
  await user.clear(within(editDialog).getByLabelText("Name"));
  await user.type(within(editDialog).getByLabelText("Name"), "Renamed L4");
  await user.click(within(editDialog).getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Renamed L4 was saved.")).toBeInTheDocument();
  expect(requestBody(calls(fetchMock, "PATCH", `/qualifications/${existing.id}`).at(-1)?.[1])).toMatchObject({
    name: "Renamed L4",
    code: "Q-ELEC-L4",
    nos: [{ nosId: "NOS-01", code: "N01", name: "Safety", pcs: [{ pcId: "PC-01", code: "P1", name: "PPE" }] }],
    maxMarks: null,
    defaultBatchType: null,
    passCriteriaMode: null,
  });

  await user.click(screen.getByRole("button", { name: "Delete Electrician L4" }));
  const confirm = screen.getByRole("dialog", { name: "Delete Electrician L4?" });
  await user.click(within(confirm).getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("Electrician L4 was deleted.")).toBeInTheDocument();
  expect(calls(fetchMock, "DELETE", `/qualifications/${existing.id}`)).toHaveLength(1);
});

it("shows RESULT_PASS_MARK_INVALID from the server and blocks a percent mark above 100 before submit", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (_url, init) => {
    if (methodOf(init) === "POST") {
      return jsonResponse(400, {
        error: {
          code: "RESULT_PASS_MARK_INVALID",
          message: "passMarks.theory must be at most 100 when passMarkUnit is percent",
          details: { field: "passMarks.theory" },
        },
      });
    }
    return jsonResponse(200, listBody([]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/master-data/qualifications");
  await screen.findByRole("heading", { name: "Qualifications" });

  await user.click(screen.getByRole("button", { name: "Create qualification" }));
  const dialog = await fillQualification(user, false);
  await user.clear(within(dialog).getByLabelText("Theory pass mark"));
  await user.type(within(dialog).getByLabelText("Theory pass mark"), "150");
  await user.click(within(dialog).getByRole("button", { name: "Create qualification" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("at most 100");
  expect(within(dialog).getByLabelText("Theory pass mark")).toHaveFocus();
  expect(calls(fetchMock, "POST", "/qualifications")).toHaveLength(0);

  await user.clear(within(dialog).getByLabelText("Theory pass mark"));
  await user.type(within(dialog).getByLabelText("Theory pass mark"), "50");
  await user.click(within(dialog).getByRole("button", { name: "Create qualification" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("RESULT_PASS_MARK_INVALID");
  expect(alert).toHaveTextContent("Field: passMarks.theory");
  expect(within(dialog).getByLabelText("Theory pass mark")).toHaveFocus();
  expect(calls(fetchMock, "POST", "/qualifications")).toHaveLength(1);
});

it("shows a qualification list error and a sector filter", async () => {
  const user = userEvent.setup();
  let fail = true;
  const fetchMock = installFetch(async (url) => {
    if (fail && url.pathname.endsWith("/qualifications")) {
      fail = false;
      return jsonResponse(500, { error: { code: "INTERNAL", message: "Internal server error" } });
    }
    return jsonResponse(200, listBody([], { total: 0 }));
  });
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/master-data/qualifications");
  expect(await screen.findByRole("alert")).toHaveTextContent("INTERNAL");
  expect(screen.getByRole("alert")).toHaveTextContent("Internal server error");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No qualifications are available for your account.")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Sector"), "Electronics");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No qualifications match these filters.")).toBeInTheDocument();
  expect(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams.get("sector")).toBe("Electronics");
});

it("keeps learner fields to the schema and does not offer delete or a national identity input", async () => {
  const user = userEvent.setup();
  const existing = learner();
  const fetchMock = installFetch(async (_url, init) => {
    if (methodOf(init) === "POST") {
      return jsonResponse(201, learner({ name: "New Learner", externalRef: "TP-REG-9", phone: "9999900000", accommodations: ["Reader"] }));
    }
    return jsonResponse(200, listBody([{ ...existing, aadhaar: "SECRET-AADHAAR", email: "hidden@example.com" }]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/master-data/learners");

  expect(await screen.findByRole("cell", { name: "Asha Devi" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "TP-REG-10021" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "9876543210" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Extra time" })).toBeInTheDocument();
  expect(screen.queryByText("SECRET-AADHAAR")).not.toBeInTheDocument();
  expect(screen.queryByText("hidden@example.com")).not.toBeInTheDocument();
  expect(document.body.textContent ?? "").not.toMatch(/aadhaar/i);
  expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument();
  expect(screen.getByText("Learners cannot be deleted.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create learner" }));
  const dialog = screen.getByRole("dialog", { name: "Create learner" });
  expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("External reference")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Phone")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Add accommodation" })).toBeInTheDocument();
  expect(within(dialog).queryByLabelText(/email/i)).not.toBeInTheDocument();

  await user.type(within(dialog).getByLabelText("Name"), "New Learner");
  await user.type(within(dialog).getByLabelText("External reference"), "TP-REG-9");
  await user.type(within(dialog).getByLabelText("Phone"), "9999900000");
  await user.click(within(dialog).getByRole("button", { name: "Add accommodation" }));
  await user.type(within(dialog).getByLabelText("Accommodation 1"), "Reader");
  await user.click(within(dialog).getByRole("button", { name: "Create learner" }));
  expect(await screen.findByText("New Learner was created.")).toBeInTheDocument();
  const created = requestBody(calls(fetchMock, "POST", "/learners").at(-1)?.[1]) as Record<string, unknown>;
  expect(created).toEqual({
    name: "New Learner",
    externalRef: "TP-REG-9",
    phone: "9999900000",
    accommodations: ["Reader"],
    active: true,
  });
  expect(Object.keys(created).sort()).toEqual(["accommodations", "active", "externalRef", "name", "phone"]);
});
