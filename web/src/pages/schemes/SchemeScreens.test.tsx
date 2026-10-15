import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../../api/session";
import { ROLE_LABELS, ROLES, type Role } from "../../routing/access";
import { jsonResponse, sessionFor } from "../../test/fixtures";
import { renderApp } from "../../test/render";

const SCHEME_ID = "66f0000000000000000000a1";
const PROJECT_ID = "66f0000000000000000000b1";
const STAMPS = { createdAt: "2026-10-01T09:30:00.000Z", updatedAt: "2026-10-02T09:30:00.000Z" };

const scheme = (over: Record<string, unknown> = {}) => ({
  id: SCHEME_ID,
  name: "State Skill Scheme",
  code: "SSS-01",
  fundingBody: "State Skill Mission",
  active: true,
  ...STAMPS,
  ...over,
});

const project = (over: Record<string, unknown> = {}) => ({
  id: PROJECT_ID,
  name: "Project One",
  code: "PRJ-01",
  schemeId: SCHEME_ID,
  startDate: "2026-04-01",
  endDate: null,
  active: true,
  ...STAMPS,
  ...over,
});

const signatory = (over: Record<string, unknown> = {}) => ({
  id: "66f0000000000000000000c1",
  name: "A. Signer",
  designation: "Director",
  scope: "scheme",
  schemeId: SCHEME_ID,
  projectId: null,
  validFrom: "2026-04-01",
  validTo: null,
  active: true,
  ...STAMPS,
  ...over,
});

function page(items: unknown[], extra: { page?: number; pageSize?: number; total?: number } = {}) {
  return { page: extra.page ?? 1, pageSize: extra.pageSize ?? 20, total: extra.total ?? items.length, items };
}

function url(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function method(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function body(init?: RequestInit): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}

type Handler = (u: URL, init?: RequestInit) => Response | undefined;

function installFetch(handler: Handler = () => undefined) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = url(input);
    const custom = handler(u, init);
    if (custom) return custom;
    if (u.pathname.endsWith("/schemes")) return jsonResponse(200, page([scheme()]));
    if (u.pathname.endsWith("/projects")) return jsonResponse(200, page([project()]));
    if (u.pathname.endsWith("/signatories")) return jsonResponse(200, page([signatory()]));
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Missing" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function listCalls(mock: ReturnType<typeof installFetch>, path: string, httpMethod = "GET") {
  return mock.mock.calls.filter((call) => url(call[0]).pathname.endsWith(path) && method(call[1]) === httpMethod);
}

const READERS: readonly Role[] = ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"];
const WRITERS: readonly Role[] = ["aa_admin", "mis"];
const OTHERS = ROLES.filter((role) => !READERS.includes(role));

const SCREENS = [
  { path: "/schemes", heading: "Schemes", create: "Create scheme", api: "/schemes" },
  { path: "/projects", heading: "Projects", create: "Create project", api: "/projects" },
  { path: "/signatories", heading: "Authorised signatories", create: "Create signatory", api: "/signatories" },
] as const;

for (const screen_ of SCREENS) {
  it.each(READERS)(`opens ${screen_.path} for %s and shows create only to writers`, async (role) => {
    installFetch();
    setSession(sessionFor(role));
    renderApp(screen_.path);
    expect(await screen.findByRole("heading", { name: screen_.heading })).toBeInTheDocument();
    await screen.findByRole("table");
    const create = screen.queryByRole("button", { name: screen_.create });
    if (WRITERS.includes(role)) {
      expect(create).toBeInTheDocument();
    } else {
      expect(create).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Deactivate / })).not.toBeInTheDocument();
      expect(screen.getByText(/Your role cannot create, edit, or remove/)).toBeInTheDocument();
    }
  });

  it.each(OTHERS)(`sends %s from ${screen_.path} to Home without any request`, async (role) => {
    const mock = installFetch();
    setSession(sessionFor(role));
    renderApp(screen_.path);
    expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: screen_.heading })).not.toBeInTheDocument();
    expect(listCalls(mock, screen_.api)).toHaveLength(0);
  });
}

it("links the three screens in the navigation for readers only", async () => {
  installFetch();
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/home");
  const nav = await screen.findByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Schemes" })).toHaveAttribute("href", "/schemes");
  expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
  expect(within(nav).getByRole("link", { name: "Signatories" })).toHaveAttribute("href", "/signatories");
});

it("lists schemes with a loading line, then the rows, and sends the active filter and page size", async () => {
  const mock = installFetch();
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  expect(await screen.findByRole("status")).toHaveTextContent("Loading schemes.");
  const table = await screen.findByRole("table");
  const row = within(table).getByRole("row", { name: /State Skill Scheme/ });
  expect(within(row).getByText("SSS-01")).toBeInTheDocument();
  expect(within(row).getByText("State Skill Mission")).toBeInTheDocument();
  expect(within(row).getByText("Active")).toBeInTheDocument();
  expect(listCalls(mock, "/schemes")[0]?.[0]).toContain("pageSize=20");

  await userEvent.selectOptions(screen.getByLabelText("Status"), "false");
  await userEvent.selectOptions(screen.getByLabelText("Page size"), "50");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => {
    const last = url(listCalls(mock, "/schemes").at(-1)?.[0] as string);
    expect(last.searchParams.get("active")).toBe("false");
    expect(last.searchParams.get("pageSize")).toBe("50");
    expect(last.searchParams.get("page")).toBe("1");
  });
});

it("shows an empty state, and a different one when filters are on", async () => {
  installFetch((u) => (u.pathname.endsWith("/schemes") ? jsonResponse(200, page([])) : undefined));
  setSession(sessionFor("mis"));
  renderApp("/schemes");
  expect(await screen.findByText("No schemes are available for your account.")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Status"), "true");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No schemes match these filters.")).toBeInTheDocument();
});

it("shows a list error with a retry that loads the rows", async () => {
  let fail = true;
  installFetch((u) => {
    if (!u.pathname.endsWith("/schemes")) return undefined;
    if (fail) return jsonResponse(500, { error: { code: "INTERNAL", message: "Database unavailable" } });
    return jsonResponse(200, page([scheme()]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Database unavailable");
  fail = false;
  await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
});

it("pages the list", async () => {
  const mock = installFetch((u) => {
    if (!u.pathname.endsWith("/schemes")) return undefined;
    const current = Number(u.searchParams.get("page"));
    return jsonResponse(200, page([scheme({ id: `s${current}`, name: `Scheme page ${current}` })], { page: current, total: 25 }));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  await screen.findByText("Scheme page 1");
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Scheme page 2");
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(listCalls(mock, "/schemes").some((call) => url(call[0]).searchParams.get("page") === "2")).toBe(true);
});

it("creates a scheme with the contract body and shows the notice", async () => {
  const mock = installFetch((u, init) =>
    u.pathname.endsWith("/schemes") && method(init) === "POST" ? jsonResponse(201, scheme({ name: "New Scheme", code: "NEW-1" })) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  await userEvent.click(await screen.findByRole("button", { name: "Create scheme" }));
  const dialog = screen.getByRole("dialog", { name: "Create scheme" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "New Scheme");
  await userEvent.type(within(dialog).getByLabelText("Code"), "NEW-1");
  await userEvent.type(within(dialog).getByLabelText("Funding body"), "State Skill Mission");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create scheme" }));
  expect(await screen.findByText("New Scheme was created.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(body(listCalls(mock, "/schemes", "POST")[0]?.[1])).toEqual({
    name: "New Scheme",
    code: "NEW-1",
    fundingBody: "State Skill Mission",
    active: true,
  });
});

it("checks required fields before any request and focuses the first bad one", async () => {
  const mock = installFetch();
  setSession(sessionFor("mis"));
  renderApp("/schemes");
  await userEvent.click(await screen.findByRole("button", { name: "Create scheme" }));
  const dialog = screen.getByRole("dialog", { name: "Create scheme" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Create scheme" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Name is required. Code is required. Funding body is required.");
  expect(within(dialog).getByLabelText("Name")).toHaveFocus();
  expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  expect(listCalls(mock, "/schemes", "POST")).toHaveLength(0);
});

it("puts a server field error on the field and keeps the form open", async () => {
  installFetch((u, init) =>
    u.pathname.endsWith("/schemes") && method(init) === "POST"
      ? jsonResponse(409, { error: { code: "DUPLICATE_RESOURCE", message: "A scheme with this code already exists", details: { field: "code" } } })
      : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  await userEvent.click(await screen.findByRole("button", { name: "Create scheme" }));
  const dialog = screen.getByRole("dialog", { name: "Create scheme" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "X");
  await userEvent.type(within(dialog).getByLabelText("Code"), "SSS-01");
  await userEvent.type(within(dialog).getByLabelText("Funding body"), "Y");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create scheme" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("DUPLICATE_RESOURCE");
  expect(within(dialog).getByLabelText("Code")).toHaveFocus();
  expect(within(dialog).getByLabelText("Code")).toHaveAttribute("aria-invalid", "true");
  expect(within(dialog).getByLabelText("Code")).toHaveAccessibleDescription(/Must be unique/);
  expect(screen.getByRole("dialog", { name: "Create scheme" })).toBeInTheDocument();
});

it("edits a scheme and sends the changed body to PATCH", async () => {
  const mock = installFetch((u, init) =>
    u.pathname.endsWith(`/schemes/${SCHEME_ID}`) && method(init) === "PATCH" ? jsonResponse(200, scheme({ name: "Renamed" })) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  await userEvent.click(await screen.findByRole("button", { name: "Edit State Skill Scheme" }));
  const dialog = screen.getByRole("dialog", { name: "Edit State Skill Scheme" });
  const name = within(dialog).getByLabelText("Name");
  expect(name).toHaveValue("State Skill Scheme");
  await userEvent.clear(name);
  await userEvent.type(name, "Renamed");
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Active" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Renamed was saved.")).toBeInTheDocument();
  expect(body(listCalls(mock, "/schemes/" + SCHEME_ID, "PATCH")[0]?.[1])).toEqual({
    name: "Renamed",
    code: "SSS-01",
    fundingBody: "State Skill Mission",
    active: false,
  });
});

it("deactivates after a confirmation and never offers delete", async () => {
  const mock = installFetch((u, init) =>
    u.pathname.endsWith(`/schemes/${SCHEME_ID}`) && method(init) === "DELETE" ? jsonResponse(200, scheme({ active: false })) : undefined,
  );
  setSession(sessionFor("mis"));
  renderApp("/schemes");
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Deactivate State Skill Scheme" }));
  const dialog = screen.getByRole("dialog", { name: "Deactivate State Skill Scheme?" });
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(listCalls(mock, "/schemes/" + SCHEME_ID, "DELETE")).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
  expect(await screen.findByText("State Skill Scheme is now inactive.")).toBeInTheDocument();
  expect(listCalls(mock, "/schemes/" + SCHEME_ID, "DELETE")).toHaveLength(1);
});

it("shows a deactivate error in the dialog", async () => {
  installFetch((u, init) =>
    u.pathname.endsWith(`/schemes/${SCHEME_ID}`) && method(init) === "DELETE"
      ? jsonResponse(500, { error: { code: "INTERNAL", message: "Could not save" } })
      : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  await userEvent.click(await screen.findByRole("button", { name: "Deactivate State Skill Scheme" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Could not save");
});

it("closes a dialog with Escape and returns focus to the button that opened it", async () => {
  installFetch();
  setSession(sessionFor("aa_admin"));
  renderApp("/schemes");
  const opener = await screen.findByRole("button", { name: "Create scheme" });
  await userEvent.click(opener);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("shows the scheme name on the projects list and filters by scheme", async () => {
  const mock = installFetch();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/projects");
  const table = await screen.findByRole("table");
  await within(table).findByText("State Skill Scheme (SSS-01)");
  expect(within(table).getByText("Open-ended")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Scheme"), SCHEME_ID);
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(url(listCalls(mock, "/projects").at(-1)?.[0] as string).searchParams.get("schemeId")).toBe(SCHEME_ID));
});

it("creates a project from the active schemes and sends the contract body", async () => {
  const mock = installFetch((u, init) =>
    u.pathname.endsWith("/projects") && method(init) === "POST" ? jsonResponse(201, project({ name: "Project Two" })) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/projects");
  await userEvent.click(await screen.findByRole("button", { name: "Create project" }));
  const dialog = screen.getByRole("dialog", { name: "Create project" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "Project Two");
  await userEvent.type(within(dialog).getByLabelText("Code"), "PRJ-02");
  await within(dialog).findByRole("option", { name: "State Skill Scheme (SSS-01)" });
  await userEvent.selectOptions(within(dialog).getByLabelText("Scheme"), SCHEME_ID);
  await userEvent.type(within(dialog).getByLabelText("Start date"), "2026-04-01");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  expect(await screen.findByText("Project Two was created.")).toBeInTheDocument();
  expect(body(listCalls(mock, "/projects", "POST")[0]?.[1])).toEqual({
    name: "Project Two",
    code: "PRJ-02",
    schemeId: SCHEME_ID,
    startDate: "2026-04-01",
    endDate: null,
    active: true,
  });
  const optionCall = listCalls(mock, "/schemes").find((call) => url(call[0]).searchParams.get("active") === "true");
  expect(optionCall).toBeDefined();
});

it("puts a server scheme error on the scheme field of the project form", async () => {
  installFetch((u, init) =>
    u.pathname.endsWith("/projects") && method(init) === "POST"
      ? jsonResponse(400, { error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: { schemeId: ["scheme must be active"] } } })
      : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/projects");
  await userEvent.click(await screen.findByRole("button", { name: "Create project" }));
  const dialog = screen.getByRole("dialog", { name: "Create project" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "P");
  await userEvent.type(within(dialog).getByLabelText("Code"), "C");
  await within(dialog).findByRole("option", { name: "State Skill Scheme (SSS-01)" });
  await userEvent.selectOptions(within(dialog).getByLabelText("Scheme"), SCHEME_ID);
  await userEvent.type(within(dialog).getByLabelText("Start date"), "2026-04-01");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("schemeId: scheme must be active");
  expect(within(dialog).getByLabelText("Scheme")).toHaveFocus();
  expect(within(dialog).getByLabelText("Scheme")).toHaveAttribute("aria-invalid", "true");
});

it("shows signatories with their scope and filters by scope", async () => {
  const mock = installFetch((u) =>
    u.pathname.endsWith("/signatories")
      ? jsonResponse(200, page([signatory(), signatory({ id: "x2", name: "B. Signer", scope: "agency", schemeId: null })]))
      : undefined,
  );
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/signatories");
  const table = await screen.findByRole("table");
  const first = await within(table).findByRole("row", { name: /A\. Signer/ });
  expect(within(first).getByText("Scheme")).toBeInTheDocument();
  expect(within(first).getByText("No end date")).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /B\. Signer/ })).toHaveTextContent("Whole agency");
  await userEvent.selectOptions(screen.getByLabelText("Scope"), "agency");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(url(listCalls(mock, "/signatories").at(-1)?.[0] as string).searchParams.get("scope")).toBe("agency"));
});

it("creates an agency signatory with no scheme or project", async () => {
  const mock = installFetch((u, init) =>
    u.pathname.endsWith("/signatories") && method(init) === "POST" ? jsonResponse(201, signatory({ scope: "agency", schemeId: null })) : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/signatories");
  await userEvent.click(await screen.findByRole("button", { name: "Create signatory" }));
  const dialog = screen.getByRole("dialog", { name: "Create signatory" });
  expect(within(dialog).queryByLabelText("Scheme")).not.toBeInTheDocument();
  expect(within(dialog).queryByLabelText("Project")).not.toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText("Name"), "A. Signer");
  await userEvent.type(within(dialog).getByLabelText("Designation"), "Director");
  await userEvent.type(within(dialog).getByLabelText("Valid from"), "2026-04-01");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create signatory" }));
  expect(await screen.findByText("A. Signer was created.")).toBeInTheDocument();
  expect(body(listCalls(mock, "/signatories", "POST")[0]?.[1])).toEqual({
    name: "A. Signer",
    designation: "Director",
    scope: "agency",
    schemeId: null,
    projectId: null,
    validFrom: "2026-04-01",
    validTo: null,
    active: true,
  });
});

it("asks for a project when the signatory scope is project", async () => {
  const mock = installFetch();
  setSession(sessionFor("mis"));
  renderApp("/signatories");
  await userEvent.click(await screen.findByRole("button", { name: "Create signatory" }));
  const dialog = screen.getByRole("dialog", { name: "Create signatory" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "A");
  await userEvent.type(within(dialog).getByLabelText("Designation"), "D");
  await userEvent.type(within(dialog).getByLabelText("Valid from"), "2026-04-01");
  await userEvent.selectOptions(within(dialog).getByLabelText("Scope"), "project");
  expect(within(dialog).queryByLabelText("Scheme")).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Create signatory" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose a project.");
  expect(within(dialog).getByLabelText("Project")).toHaveFocus();
  expect(listCalls(mock, "/signatories", "POST")).toHaveLength(0);
});
