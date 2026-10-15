import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { IDS, batchRecord, emptyMasterList, listBody } from "../test/batchFixtures";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const SCHEME_A = "66f0000000000000000000a1";
const SCHEME_B = "66f0000000000000000000a2";
const PROJECT_A = "66f0000000000000000000d9";
const PROJECT_B = "66f0000000000000000000d8";
const STAMPS = { createdAt: "2026-10-01T09:30:00.000Z", updatedAt: "2026-10-02T09:30:00.000Z" };

const schemeRow = (id: string, name: string, code: string) => ({ id, name, code, fundingBody: "Body", active: true, ...STAMPS });
const projectRow = (id: string, schemeId: string, name: string, code: string) => ({
  id,
  name,
  code,
  schemeId,
  startDate: "2026-04-01",
  endDate: null,
  active: true,
  ...STAMPS,
});

const SCHEMES = [schemeRow(SCHEME_A, "Scheme Alpha", "SA"), schemeRow(SCHEME_B, "Scheme Beta", "SB")];
const PROJECTS = [projectRow(PROJECT_A, SCHEME_A, "Project Alpha", "PA"), projectRow(PROJECT_B, SCHEME_B, "Project Beta", "PB")];

function url(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function method(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function page(items: unknown[]) {
  return { page: 1, pageSize: 100, total: items.length, items };
}

function schemeData(u: URL, init?: RequestInit): Response | null {
  if (method(init) !== "GET") return null;
  if (u.pathname.endsWith("/schemes")) return jsonResponse(200, page(SCHEMES));
  if (u.pathname.endsWith("/projects")) {
    const scheme = u.searchParams.get("schemeId");
    return jsonResponse(200, page(PROJECTS.filter((item) => !scheme || item.schemeId === scheme)));
  }
  const scheme = SCHEMES.find((item) => u.pathname.endsWith(`/schemes/${item.id}`));
  if (scheme) return jsonResponse(200, scheme);
  const project = PROJECTS.find((item) => u.pathname.endsWith(`/projects/${item.id}`));
  if (project) return jsonResponse(200, project);
  return null;
}

function installFetch(handler: (u: URL, init?: RequestInit) => Response | undefined = () => undefined) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = url(input);
    const custom = handler(u, init);
    if (custom) return custom;
    const data = schemeData(u, init);
    if (data) return data;
    if (
      u.pathname.endsWith("/awarding-bodies") ||
      u.pathname.endsWith("/qualifications") ||
      u.pathname.endsWith("/training-partners") ||
      u.pathname.endsWith("/centres")
    ) {
      return jsonResponse(200, emptyMasterList());
    }
    if (u.pathname.endsWith("/batches")) return jsonResponse(200, listBody([]));
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Missing" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
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
  fireEvent.change(screen.getByLabelText("Assessment language"), { target: { value: "Hindi" } });
}

function batchPosts(mock: ReturnType<typeof installFetch>) {
  return mock.mock.calls.filter((call) => method(call[1]) === "POST" && url(call[0]).pathname.endsWith("/batches"));
}

function batchListCalls(mock: ReturnType<typeof installFetch>) {
  return mock.mock.calls.map((call) => url(call[0])).filter((u) => u.pathname.endsWith("/batches"));
}

it("asks only for active schemes and projects, and limits projects to the chosen scheme", async () => {
  const mock = installFetch();
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  const scheme = await screen.findByLabelText("Scheme (optional)");
  await within(scheme).findByRole("option", { name: "Scheme Alpha (SA)" });
  expect(
    mock.mock.calls.some((call) => url(call[0]).pathname.endsWith("/schemes") && url(call[0]).searchParams.get("active") === "true"),
  ).toBe(true);

  const project = screen.getByLabelText("Project (optional)");
  await within(project).findByRole("option", { name: "Project Beta (PB)" });
  await userEvent.selectOptions(scheme, SCHEME_A);
  await waitFor(() => expect(within(project).queryByRole("option", { name: "Project Beta (PB)" })).not.toBeInTheDocument());
  expect(within(project).getByRole("option", { name: "Project Alpha (PA)" })).toBeInTheDocument();
  const last = mock.mock.calls.filter((call) => url(call[0]).pathname.endsWith("/projects")).at(-1);
  expect(url(last?.[0] as string).searchParams.get("schemeId")).toBe(SCHEME_A);
  expect(url(last?.[0] as string).searchParams.get("active")).toBe("true");
});

it("clears the project when the scheme changes", async () => {
  installFetch();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/batches/new");
  const scheme = await screen.findByLabelText("Scheme (optional)");
  await within(scheme).findByRole("option", { name: "Scheme Alpha (SA)" });
  await userEvent.selectOptions(scheme, SCHEME_A);
  const project = screen.getByLabelText("Project (optional)");
  await within(project).findByRole("option", { name: "Project Alpha (PA)" });
  await userEvent.selectOptions(project, PROJECT_A);
  expect(project).toHaveValue(PROJECT_A);
  await userEvent.selectOptions(scheme, SCHEME_B);
  expect(screen.getByLabelText("Project (optional)")).toHaveValue("");
});

it("sends schemeId and projectId when chosen", async () => {
  const created = batchRecord({ schemeId: SCHEME_A, projectId: PROJECT_A });
  const mock = installFetch((u, init) => {
    if (method(init) === "POST" && u.pathname.endsWith("/batches")) return jsonResponse(201, created);
    if (u.pathname.endsWith(`/batches/${created.id}`)) return jsonResponse(200, created);
    return undefined;
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  await fillRequired();
  const scheme = screen.getByLabelText("Scheme (optional)");
  await within(scheme).findByRole("option", { name: "Scheme Alpha (SA)" });
  await userEvent.selectOptions(scheme, SCHEME_A);
  const project = screen.getByLabelText("Project (optional)");
  await within(project).findByRole("option", { name: "Project Alpha (PA)" });
  await userEvent.selectOptions(project, PROJECT_A);
  await userEvent.click(screen.getByRole("button", { name: "Create batch" }));
  expect(await screen.findByRole("heading", { name: `Batch ${created.id}` })).toBeInTheDocument();
  expect(JSON.parse(String(batchPosts(mock)[0]?.[1]?.body))).toMatchObject({ schemeId: SCHEME_A, projectId: PROJECT_A });
});

it("leaves both keys out when no scheme or project is chosen", async () => {
  const created = batchRecord();
  const mock = installFetch((u, init) => {
    if (method(init) === "POST" && u.pathname.endsWith("/batches")) return jsonResponse(201, created);
    if (u.pathname.endsWith(`/batches/${created.id}`)) return jsonResponse(200, created);
    return undefined;
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  await fillRequired();
  await userEvent.click(screen.getByRole("button", { name: "Create batch" }));
  await screen.findByRole("heading", { name: `Batch ${created.id}` });
  const sent = JSON.parse(String(batchPosts(mock)[0]?.[1]?.body)) as Record<string, unknown>;
  expect(sent).not.toHaveProperty("schemeId");
  expect(sent).not.toHaveProperty("projectId");
});

it("still allows creating a batch when the scheme lists cannot be loaded", async () => {
  installFetch((u) =>
    u.pathname.endsWith("/schemes") || u.pathname.endsWith("/projects")
      ? jsonResponse(500, { error: { code: "INTERNAL", message: "Down" } })
      : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  expect(await screen.findByText("Schemes could not be loaded. You can still create the batch without one.")).toBeInTheDocument();
  expect(screen.getByText("Projects could not be loaded. You can still create the batch without one.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create batch" })).toBeEnabled();
});

it("puts a server project error on the project field", async () => {
  installFetch((u, init) =>
    method(init) === "POST" && u.pathname.endsWith("/batches")
      ? jsonResponse(400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: { projectId: ["projectId must belong to the given scheme"] },
          },
        })
      : undefined,
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/batches/new");
  await fillRequired();
  const project = screen.getByLabelText("Project (optional)");
  await within(project).findByRole("option", { name: "Project Beta (PB)" });
  await userEvent.selectOptions(project, PROJECT_B);
  await userEvent.click(screen.getByRole("button", { name: "Create batch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Request validation failed");
  await waitFor(() => expect(screen.getByLabelText("Project (optional)")).toHaveFocus());
  expect(screen.getByLabelText("Project (optional)")).toHaveAttribute("aria-invalid", "true");
});

it("filters the batch list by scheme and project, and clears them", async () => {
  const mock = installFetch();
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/batches");
  const scheme = await screen.findByLabelText("Scheme");
  await within(scheme).findByRole("option", { name: "Scheme Alpha (SA)" });
  await userEvent.selectOptions(scheme, SCHEME_A);
  const project = screen.getByLabelText("Project");
  await waitFor(() => expect(within(project).queryByRole("option", { name: "Project Beta (PB)" })).not.toBeInTheDocument());
  await userEvent.selectOptions(project, PROJECT_A);
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => {
    const last = batchListCalls(mock).at(-1);
    expect(last?.searchParams.get("schemeId")).toBe(SCHEME_A);
    expect(last?.searchParams.get("projectId")).toBe(PROJECT_A);
  });
  expect(await screen.findByText("No batches match these filters.")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(batchListCalls(mock).at(-1)?.searchParams.has("schemeId")).toBe(false));
});

it("hides the scheme filters, and asks for no schemes, for a role that cannot read them", async () => {
  const mock = installFetch();
  setSession(sessionFor("tp"));
  renderApp("/batches");
  await screen.findByRole("heading", { name: "Batches" });
  expect(screen.queryByLabelText("Scheme")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
  expect(mock.mock.calls.some((call) => /\/(schemes|projects)$/.test(url(call[0]).pathname))).toBe(false);
});

it("shows scheme and project names on the batch detail page", async () => {
  const batch = batchRecord({ schemeId: SCHEME_A, projectId: PROJECT_A });
  installFetch((u) => (u.pathname.endsWith(`/batches/${batch.id}`) ? jsonResponse(200, batch) : undefined));
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${batch.id}`);
  expect(await screen.findByText("Scheme Alpha (SA)")).toBeInTheDocument();
  expect(screen.getByText("Project Alpha (PA)")).toBeInTheDocument();
});

it("shows None without a link, and the id when the role cannot read names", async () => {
  const plain = batchRecord();
  installFetch((u) => (u.pathname.endsWith(`/batches/${plain.id}`) ? jsonResponse(200, plain) : undefined));
  setSession(sessionFor("aa_admin"));
  const first = renderApp(`/batches/${plain.id}`);
  const scheme = (await screen.findByText("Scheme", { selector: "dt" })).parentElement as HTMLElement;
  expect(within(scheme).getByText("None")).toBeInTheDocument();
  const project = screen.getByText("Project", { selector: "dt" }).parentElement as HTMLElement;
  expect(within(project).getByText("None")).toBeInTheDocument();
  first.unmount();

  const linked = batchRecord({ schemeId: SCHEME_A, projectId: PROJECT_A });
  const mock = installFetch((u) => (u.pathname.endsWith(`/batches/${linked.id}`) ? jsonResponse(200, linked) : undefined));
  setSession(sessionFor("tp"));
  renderApp(`/batches/${linked.id}`);
  expect(await screen.findByText(SCHEME_A)).toBeInTheDocument();
  expect(screen.getByText(PROJECT_A)).toBeInTheDocument();
  expect(mock.mock.calls.some((call) => /\/(schemes|projects)\//.test(url(call[0]).pathname))).toBe(false);
});
