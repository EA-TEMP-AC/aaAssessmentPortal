import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { ROLE_LABELS, type Role } from "../routing/access";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const DENIED: readonly Role[] = ["sme", "assessor", "proctor", "candidate", "tp", "ab_reviewer", "ncvet_viewer"];
const ALLOWED: readonly Role[] = ["aa_admin", "mis"];
const BASE = "/api/v1/admin/public-site";

type Item = Record<string, unknown>;

const DRAFT_PERSON: Item = {
  id: "66f0000000000000000000a1",
  kind: "assessor",
  registryId: "66f0000000000000000000b1",
  name: "Asha Rao",
  roleLabel: "Lead assessor",
  sector: null,
  published: false,
  archived: false,
  sortOrder: 0,
  consentRecorded: false,
  consentNote: null,
  updatedAt: "2026-10-01T10:00:00.000Z",
};

const LIVE_PERSON: Item = {
  ...DRAFT_PERSON,
  id: "66f0000000000000000000a2",
  name: "Ravi Menon",
  published: true,
  consentRecorded: true,
};

function url(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function method(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function body(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

type Handler = (u: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

function install(items: Item[], extra?: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = url(input);
    const special = await extra?.(u, init);
    if (special) return special;
    if (u.pathname.startsWith(BASE) && method(init) === "GET") {
      const archived = u.searchParams.get("archived") === "true";
      const rows = items.filter((item) => (item.archived === true) === archived);
      return jsonResponse(200, { page: 1, pageSize: 20, total: rows.length, items: rows });
    }
    return jsonResponse(500, { error: { code: "INTERNAL", message: "Unexpected request" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof install>, verb: string) {
  return fetchMock.mock.calls.filter((call) => method(call[1]) === verb);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(DENIED)("sends %s to Home without a request", async (role) => {
  const fetchMock = install([]);
  setSession(sessionFor(role));
  renderApp("/admin/public-site");

  expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Public site" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Public site" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.filter((call) => url(call[0] ?? "").pathname.startsWith(BASE))).toHaveLength(0);
});

it.each(ALLOWED)("shows the Public site link and sections to %s", async (role) => {
  install([]);
  setSession(sessionFor(role));
  renderApp("/admin/public-site");

  expect(await screen.findByRole("heading", { name: "Public site" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Public site" })).toHaveAttribute("aria-current", "page");
  const sections = within(screen.getByRole("navigation", { name: "Public site sections" })).getAllByRole("link");
  expect(sections.map((link) => link.textContent)).toEqual([
    "Team members",
    "Organogram",
    "People",
    "Sample papers",
    "Industry linkages",
    "Grievance",
    "POSH",
    "Office documents",
    "Events",
  ]);
});

it("shows a loading state, then an empty state", async () => {
  install([]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site");

  expect(screen.getByText("Loading team members.")).toBeInTheDocument();
  expect(await screen.findByText(/No team members yet/)).toBeInTheDocument();
});

it("shows a load error with a retry that recovers", async () => {
  let fail = true;
  install([DRAFT_PERSON], () =>
    fail ? jsonResponse(500, { error: { code: "INTERNAL", message: "Database is down" } }) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Database is down");
  fail = false;
  await user.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("rowheader", { name: "Asha Rao" })).toBeInTheDocument();
});

it("shows aa_admin publish, unpublish and archive buttons with status", async () => {
  install([DRAFT_PERSON, LIVE_PERSON]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");

  expect(await screen.findByRole("button", { name: "Publish Asha Rao" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Unpublish Ravi Menon" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Archive Asha Rao" })).toBeEnabled();
  expect(screen.getByRole("row", { name: /Asha Rao/ })).toHaveTextContent("Draft");
  expect(screen.getByRole("row", { name: /Ravi Menon/ })).toHaveTextContent("Published");
});

it("gives mis drafts only and explains why publishing is off", async () => {
  install([DRAFT_PERSON, LIVE_PERSON]);
  setSession(sessionFor("mis"));
  renderApp("/admin/public-site?section=people");

  const reason = await screen.findByText(/Only an AA admin can publish/);
  await screen.findByRole("rowheader", { name: "Asha Rao" });
  expect(screen.queryByRole("button", { name: /^Publish / })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Unpublish / })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Archive / })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Asha Rao" })).toBeEnabled();
  const locked = screen.getByRole("button", { name: "Edit Ravi Menon" });
  expect(locked).toBeDisabled();
  expect(locked).toHaveAccessibleDescription(reason.textContent ?? "");
  expect(screen.getByRole("button", { name: "Add person" })).toBeEnabled();
});

it("publishes a draft with a PATCH and confirms it", async () => {
  const fetchMock = install([DRAFT_PERSON], (_u, init) =>
    method(init) === "PATCH" ? jsonResponse(200, { ...DRAFT_PERSON, published: true }) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Publish Asha Rao" }));

  expect(await screen.findByText("Asha Rao is now published.")).toBeInTheDocument();
  const [call] = calls(fetchMock, "PATCH");
  expect(url(call![0]).pathname).toBe(`${BASE}/people/${DRAFT_PERSON.id}`);
  expect(body(call![1])).toEqual({ published: true });
});

it("explains CONSENT_REQUIRED in plain words when publishing without consent", async () => {
  install([DRAFT_PERSON], (_u, init) =>
    method(init) === "PATCH"
      ? jsonResponse(409, { error: { code: "CONSENT_REQUIRED", message: "Consent must be recorded before publishing" } })
      : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Publish Asha Rao" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Consent has not been recorded, so this cannot be published yet.");
  expect(alert).not.toHaveTextContent("CONSENT_REQUIRED");
  expect(screen.getByRole("row", { name: /Asha Rao/ })).toHaveTextContent("Draft");
});

it("saves a new person as a draft with the consent checkbox and note", async () => {
  const fetchMock = install([], (_u, init) =>
    method(init) === "POST" ? jsonResponse(201, { ...DRAFT_PERSON, consentRecorded: true }) : undefined,
  );
  setSession(sessionFor("mis"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Add person" }));
  const dialog = await screen.findByRole("dialog", { name: "Add person" });
  await user.type(within(dialog).getByLabelText(/Registry id/), "66f0000000000000000000b1");
  await user.type(within(dialog).getByLabelText(/Role label/), "Lead assessor");
  await user.click(within(dialog).getByRole("checkbox", { name: "Consent has been recorded" }));
  await user.type(within(dialog).getByLabelText("Consent note"), "Signed form 12 Oct");
  await user.click(within(dialog).getByRole("button", { name: "Save draft" }));

  expect(await screen.findByText("Asha Rao was saved as a draft.")).toBeInTheDocument();
  const [call] = calls(fetchMock, "POST");
  expect(body(call![1])).toEqual({
    kind: "assessor",
    registryId: "66f0000000000000000000b1",
    roleLabel: "Lead assessor",
    consentRecorded: true,
    consentNote: "Signed form 12 Oct",
    published: false,
  });
});

it("asks for required fields before sending anything", async () => {
  const fetchMock = install([]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Add team member" }));
  const dialog = await screen.findByRole("dialog", { name: "Add team member" });
  await user.click(within(dialog).getByRole("button", { name: "Save draft" }));

  const name = within(dialog).getByLabelText(/^Name/);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveFocus();
  expect(within(dialog).getByText("Enter name.")).toBeInTheDocument();
  expect(calls(fetchMock, "POST")).toHaveLength(0);
});

it("shows server validation errors next to the fields they name", async () => {
  install([], (_u, init) =>
    method(init) === "POST"
      ? jsonResponse(400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: { websiteUrl: ["Use an http or https address"] },
          },
        })
      : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=industry-linkages");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Add industry linkage" }));
  const dialog = await screen.findByRole("dialog", { name: "Add industry linkage" });
  await user.type(within(dialog).getByLabelText(/^Name/), "Acme Industries");
  await user.type(within(dialog).getByLabelText("Website"), "ftp://acme");
  await user.click(within(dialog).getByRole("button", { name: "Save draft" }));

  const site = await within(dialog).findByLabelText("Website");
  await waitFor(() => expect(site).toHaveAttribute("aria-invalid", "true"));
  expect(site).toHaveFocus();
  expect(site).toHaveAccessibleDescription(/Use an http or https address/);
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Website: Use an http or https address");
});

it("archives after confirmation and never calls it delete", async () => {
  const fetchMock = install([DRAFT_PERSON], (_u, init) =>
    method(init) === "DELETE" ? jsonResponse(204) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Archive Asha Rao" }));
  const dialog = await screen.findByRole("dialog", { name: "Archive Asha Rao?" });
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Archive" }));

  expect(await screen.findByText(/Asha Rao was archived/)).toBeInTheDocument();
  const [call] = calls(fetchMock, "DELETE");
  expect(url(call![0]).pathname).toBe(`${BASE}/people/${DRAFT_PERSON.id}`);
});

it("cancels an archive without a request", async () => {
  const fetchMock = install([DRAFT_PERSON]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Archive Asha Rao" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls(fetchMock, "DELETE")).toHaveLength(0);
});

it("lists archived items only when Show archived is ticked, without actions", async () => {
  const archived = { ...DRAFT_PERSON, id: "66f0000000000000000000a3", name: "Old Person", archived: true };
  const fetchMock = install([DRAFT_PERSON, archived]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  expect(await screen.findByRole("rowheader", { name: "Asha Rao" })).toBeInTheDocument();
  expect(screen.queryByRole("rowheader", { name: "Old Person" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Show archived" }));

  expect(await screen.findByRole("rowheader", { name: "Old Person" })).toBeInTheDocument();
  expect(screen.queryByRole("rowheader", { name: "Asha Rao" })).not.toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Old Person/ })).toHaveTextContent("Archived");
  expect(screen.queryByRole("button", { name: /Archive Old Person|Edit Old Person|Publish Old Person/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add person" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some((call) => url(call[0]).searchParams.get("archived") === "true")).toBe(true);
});

it("filters by status with the published parameter", async () => {
  const fetchMock = install([DRAFT_PERSON]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=people");
  const user = userEvent.setup();

  await screen.findByRole("rowheader", { name: "Asha Rao" });
  await user.selectOptions(screen.getByLabelText("Status"), "published");

  await waitFor(() =>
    expect(fetchMock.mock.calls.some((call) => url(call[0]).searchParams.get("published") === "true")).toBe(true),
  );
});

it("warns on office documents that bills are never shown publicly", async () => {
  install([]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=office-documents");
  const user = userEvent.setup();

  expect(await screen.findAllByText(/Bills are never shown publicly/)).toHaveLength(1);
  await user.click(await screen.findByRole("button", { name: "Add office document" }));
  expect(await within(await screen.findByRole("dialog")).findByText(/Bills are never shown publicly/)).toBeInTheDocument();
});

it("keeps other sections free of the bills warning", async () => {
  install([]);
  setSession(sessionFor("aa_admin"));
  renderApp("/admin/public-site?section=events");

  await screen.findByText(/No events yet/);
  expect(screen.queryByText(/Bills are never shown publicly/)).not.toBeInTheDocument();
});
