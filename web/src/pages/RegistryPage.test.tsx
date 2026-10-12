import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AssessorRecord, ProctorRecord } from "../api/assessors";
import { setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

function sampleAssessor(overrides: Partial<AssessorRecord> = {}): AssessorRecord {
  return {
    id: "66f0000000000000000000a1",
    name: "Ravi Assessor",
    code: "ASR-01",
    email: "ravi@aa.example",
    qualifications: ["Electrician L4"],
    yearsOfExperience: 5,
    languages: ["Hindi", "English"],
    toa: {
      certNo: "TOA-1",
      issuedOn: "2024-01-01",
      expiresOn: "2027-01-01",
    },
    otherAaCount: 1,
    undertaking: true,
    active: true,
    ...overrides,
  };
}

function sampleProctor(overrides: Partial<ProctorRecord> = {}): ProctorRecord {
  return {
    id: "66f0000000000000000000p1",
    name: "Priya Proctor",
    code: "PRC-01",
    email: "priya@aa.example",
    qualifications: ["Proctor L1"],
    languages: ["Hindi"],
    active: true,
    ...overrides,
  };
}

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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(requestUrl(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("lists assessors with search and status filtering", async () => {
  const user = userEvent.setup();
  setSession(sessionFor("aa_admin"));

  const a1 = sampleAssessor({ id: "1", name: "Ravi Assessor", code: "ASR-01", active: true });
  const a2 = sampleAssessor({
    id: "2",
    name: "Sunita Assessor",
    code: "ASR-02",
    email: "sunita@aa.example",
    languages: ["Tamil"],
    active: false,
  });

  installFetch((url) => {
    if (url.pathname === "/api/v1/assessors") {
      const activeParam = url.searchParams.get("active");
      const items =
        activeParam === "true"
          ? [a1]
          : activeParam === "false"
            ? [a2]
            : [a1, a2];
      return jsonResponse(200, { page: 1, pageSize: 100, total: items.length, items });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry/assessors");

  expect(await screen.findByRole("heading", { name: "Assessors" })).toBeInTheDocument();
  expect(await screen.findByText("Ravi Assessor")).toBeInTheDocument();
  expect(screen.getByText("Sunita Assessor")).toBeInTheDocument();

  // Client search filter
  const searchInput = screen.getByPlaceholderText(/Search by name, code/i);
  await user.type(searchInput, "Sunita");
  expect(screen.getByText("Sunita Assessor")).toBeInTheDocument();
  expect(screen.queryByText("Ravi Assessor")).not.toBeInTheDocument();

  await user.clear(searchInput);
  expect(screen.getByText("Ravi Assessor")).toBeInTheDocument();

  // Active status filter
  const statusFilter = screen.getByLabelText("Status");
  await user.selectOptions(statusFilter, "true");
  expect(await screen.findByText("Ravi Assessor")).toBeInTheDocument();
  expect(screen.queryByText("Sunita Assessor")).not.toBeInTheDocument();
});

it("creates an assessor with languages and ToA validity dates", async () => {
  const user = userEvent.setup();
  setSession(sessionFor("aa_admin"));

  let postBody: unknown = null;
  const list: AssessorRecord[] = [];

  installFetch((url, init) => {
    if (url.pathname === "/api/v1/assessors" && methodOf(init) === "GET") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: list.length, items: list });
    }
    if (url.pathname === "/api/v1/assessors" && methodOf(init) === "POST") {
      postBody = requestBody(init);
      const created = sampleAssessor({
        id: "new-id",
        name: (postBody as Record<string, unknown>).name as string,
      });
      list.push(created);
      return jsonResponse(201, created);
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry/assessors");

  await user.click(await screen.findByRole("button", { name: "Add assessor" }));

  const dialog = screen.getByRole("dialog", { name: "Add assessor" });
  expect(dialog).toBeInTheDocument();

  await user.type(within(dialog).getByLabelText(/Full name/i), "Vikram Singh");
  await user.type(within(dialog).getByLabelText(/Assessor code/i), "ASR-VS");
  await user.type(within(dialog).getByLabelText(/Contact email/i), "vikram@example.com");
  await user.type(
    within(dialog).getByLabelText(/Qualifications \/ Sector/i),
    "Automotive L4, Automotive",
  );

  // Editable multi-select languages
  await user.click(within(dialog).getByLabelText("Hindi"));
  await user.click(within(dialog).getByLabelText("English"));

  // Add custom language
  await user.type(within(dialog).getByLabelText("Add custom language"), "Bhojpuri");
  await user.click(within(dialog).getByRole("button", { name: "Add language" }));
  expect(within(dialog).getByLabelText("Bhojpuri")).toBeChecked();

  // ToA validity dates
  await user.click(within(dialog).getByLabelText("Has ToA certificate"));
  await user.type(within(dialog).getByLabelText(/Certificate number/i), "TOA-999");
  await user.type(within(dialog).getByLabelText(/Issued on/i), "2025-01-01");
  await user.type(within(dialog).getByLabelText(/Expires on/i), "2028-01-01");

  await user.click(within(dialog).getByRole("button", { name: "Create assessor" }));

  expect(postBody).toMatchObject({
    name: "Vikram Singh",
    code: "ASR-VS",
    email: "vikram@example.com",
    qualifications: ["Automotive L4", "Automotive"],
    languages: ["Hindi", "English", "Bhojpuri"],
    toa: {
      certNo: "TOA-999",
      issuedOn: "2025-01-01",
      expiresOn: "2028-01-01",
    },
    active: true,
  });

  expect(await screen.findByRole("status")).toHaveTextContent("Assessor Vikram Singh created.");
});

it("edits an assessor including modifying the language list", async () => {
  const user = userEvent.setup();
  setSession(sessionFor("aa_admin"));

  const initial = sampleAssessor({
    id: "asr-1",
    name: "Ravi Assessor",
    languages: ["Hindi", "English"],
  });
  let patchBody: unknown = null;

  installFetch((url, init) => {
    if (url.pathname === "/api/v1/assessors" && methodOf(init) === "GET") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 1, items: [initial] });
    }
    if (url.pathname === "/api/v1/assessors/asr-1" && methodOf(init) === "PATCH") {
      patchBody = requestBody(init);
      return jsonResponse(200, { ...initial, ...(patchBody as object) });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry/assessors");

  expect(await screen.findByText("Ravi Assessor")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit" }));

  const dialog = screen.getByRole("dialog", { name: "Edit assessor" });
  expect(dialog).toBeInTheDocument();

  // Edit language list: uncheck English, check Marathi
  await user.click(within(dialog).getByLabelText("English"));
  await user.click(within(dialog).getByLabelText("Marathi"));

  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

  expect(patchBody).toMatchObject({
    languages: ["Hindi", "Marathi"],
  });

  expect(await screen.findByRole("status")).toHaveTextContent("Assessor Ravi Assessor updated.");
});

it("shows validation errors for required fields and invalid ToA expiry dates", async () => {
  const user = userEvent.setup();
  setSession(sessionFor("aa_admin"));

  installFetch((url) => {
    if (url.pathname === "/api/v1/assessors") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 0, items: [] });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry/assessors");

  await user.click(await screen.findByRole("button", { name: "Add assessor" }));
  const dialog = screen.getByRole("dialog", { name: "Add assessor" });

  // Missing name
  await user.click(within(dialog).getByRole("button", { name: "Create assessor" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter a name.");

  // Fill name
  await user.type(within(dialog).getByLabelText(/Full name/i), "Test Assessor");

  // Invalid ToA: expiresOn before issuedOn
  await user.click(within(dialog).getByLabelText("Has ToA certificate"));
  await user.type(within(dialog).getByLabelText(/Certificate number/i), "TOA-1");
  await user.type(within(dialog).getByLabelText(/Issued on/i), "2026-05-01");
  await user.type(within(dialog).getByLabelText(/Expires on/i), "2025-05-01");

  await user.click(within(dialog).getByRole("button", { name: "Create assessor" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Expiry date must be on or after issued date.",
  );
});

it("shows server error alerts inside the dialog without closing", async () => {
  const user = userEvent.setup();
  setSession(sessionFor("aa_admin"));

  installFetch((url, init) => {
    if (url.pathname === "/api/v1/assessors" && methodOf(init) === "GET") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 0, items: [] });
    }
    if (url.pathname === "/api/v1/assessors" && methodOf(init) === "POST") {
      return jsonResponse(409, {
        error: { code: "DUPLICATE_RESOURCE", message: "A record with this code already exists" },
      });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry/assessors");

  await user.click(await screen.findByRole("button", { name: "Add assessor" }));
  const dialog = screen.getByRole("dialog", { name: "Add assessor" });

  await user.type(within(dialog).getByLabelText(/Full name/i), "Duplicate Code Assessor");
  await user.type(within(dialog).getByLabelText(/Assessor code/i), "ASR-DUP");

  await user.click(within(dialog).getByRole("button", { name: "Create assessor" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "A record with this code already exists",
  );
  expect(dialog).toBeInTheDocument();
});

it("deactivates an assessor upon confirmation", async () => {
  const user = userEvent.setup();
  setSession(sessionFor("aa_admin"));

  const assessor = sampleAssessor({ id: "asr-del", name: "Ravi Deactivate", active: true });
  let deleteCalled = false;

  installFetch((url, init) => {
    if (url.pathname === "/api/v1/assessors" && methodOf(init) === "GET") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 1, items: [assessor] });
    }
    if (url.pathname === "/api/v1/assessors/asr-del" && methodOf(init) === "DELETE") {
      deleteCalled = true;
      return jsonResponse(200, { ...assessor, active: false });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry/assessors");

  expect(await screen.findByText("Ravi Deactivate")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Deactivate" }));

  const confirmDialog = screen.getByRole("dialog", { name: "Deactivate assessor" });
  expect(confirmDialog).toBeInTheDocument();
  expect(within(confirmDialog).getByText(/Are you sure you want to deactivate/)).toBeInTheDocument();

  await user.click(within(confirmDialog).getByRole("button", { name: "Deactivate assessor" }));

  expect(deleteCalled).toBe(true);
  expect(await screen.findByRole("status")).toHaveTextContent("Assessor Ravi Deactivate deactivated.");
});

it("switches to the Proctors tab, lists, creates, and edits a proctor", async () => {
  const user = userEvent.setup();
  setSession(sessionFor("mis"));

  const p1 = sampleProctor({ id: "prc-1", name: "Priya Proctor", code: "PRC-01" });
  let postBody: unknown = null;

  installFetch((url, init) => {
    if (url.pathname === "/api/v1/assessors") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 0, items: [] });
    }
    if (url.pathname === "/api/v1/proctors" && methodOf(init) === "GET") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 1, items: [p1] });
    }
    if (url.pathname === "/api/v1/proctors" && methodOf(init) === "POST") {
      postBody = requestBody(init);
      return jsonResponse(201, sampleProctor({ id: "prc-2", ...(postBody as object) }));
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry");

  // Subnav tab switch to Proctors
  await user.click(await screen.findByRole("link", { name: "Proctors" }));

  expect(await screen.findByRole("heading", { name: "Proctors" })).toBeInTheDocument();
  expect(await screen.findByText("Priya Proctor")).toBeInTheDocument();

  // Create proctor
  await user.click(screen.getByRole("button", { name: "Add proctor" }));
  const dialog = screen.getByRole("dialog", { name: "Add proctor" });

  await user.type(within(dialog).getByLabelText(/Full name/i), "Deepak Proctor");
  await user.type(within(dialog).getByLabelText(/Proctor code/i), "PRC-02");
  await user.click(within(dialog).getByLabelText("Hindi"));

  await user.click(within(dialog).getByRole("button", { name: "Create proctor" }));

  expect(postBody).toMatchObject({
    name: "Deepak Proctor",
    code: "PRC-02",
    languages: ["Hindi"],
  });

  expect(await screen.findByRole("status")).toHaveTextContent("Proctor Deepak Proctor created.");
});

it("renders read-only views for ncvet_viewer with no Add or Edit buttons", async () => {
  setSession(sessionFor("ncvet_viewer"));

  const assessor = sampleAssessor();
  installFetch((url) => {
    if (url.pathname === "/api/v1/assessors") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 1, items: [assessor] });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry/assessors");

  expect(await screen.findByText("Ravi Assessor")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add assessor" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
});

it("scopes assessor and proctor role subnav views to their own collection", async () => {
  // Assessor user: only Assessors tab in subnav
  setSession(sessionFor("assessor"));

  installFetch((url) => {
    if (url.pathname === "/api/v1/assessors") {
      return jsonResponse(200, { page: 1, pageSize: 100, total: 0, items: [] });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  renderApp("/registry");

  const registryNav = await screen.findByRole("navigation", { name: "Registry" });
  expect(within(registryNav).getByRole("link", { name: "Assessors" })).toBeInTheDocument();
  expect(within(registryNav).queryByRole("link", { name: "Proctors" })).not.toBeInTheDocument();
});
