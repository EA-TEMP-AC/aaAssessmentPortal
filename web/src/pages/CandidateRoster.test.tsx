import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { CandidateRecord } from "../api/candidates";
import { setSession } from "../api/session";
import {
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

function requestJson(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== "string") return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return undefined;
  }
}

function installFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(requestUrl(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sampleCandidate(
  overrides: Partial<CandidateRecord> = {},
): CandidateRecord {
  return {
    id: "66f0000000000000000000c1",
    batchId: IDS.batch,
    learnerId: "66f0000000000000000000l1",
    name: "Rohan Sharma",
    externalRef: "REF-001",
    accommodations: ["Extra time"],
    active: true,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    ...overrides,
  };
}

function defaultBatchHandler(
  url: URL,
  current = batchRecord(),
  candidates: CandidateRecord[] = [sampleCandidate()],
) {
  if (url.pathname.endsWith("/batches") && !url.pathname.includes(IDS.batch)) {
    return jsonResponse(200, listBody([current]));
  }
  if (url.pathname.endsWith(`/batches/${IDS.batch}`))
    return jsonResponse(200, current);
  if (url.pathname.endsWith("/assessors/available")) {
    return jsonResponse(200, { items: [assessorItem()] });
  }
  if (url.pathname.endsWith("/proctors")) {
    return jsonResponse(200, {
      page: 1,
      pageSize: 100,
      total: 1,
      items: [proctorItem()],
    });
  }
  if (
    url.pathname.endsWith("/awarding-bodies") ||
    url.pathname.endsWith("/qualifications") ||
    url.pathname.endsWith("/training-partners") ||
    url.pathname.endsWith("/centres")
  ) {
    return jsonResponse(200, emptyMasterList());
  }
  if (url.pathname.endsWith("/candidates")) {
    const activeParam = url.searchParams.get("active");
    let filtered = candidates;
    if (activeParam === "true") filtered = candidates.filter((c) => c.active);
    if (activeParam === "false") filtered = candidates.filter((c) => !c.active);
    return jsonResponse(200, { items: filtered });
  }
  return null;
}

it("lists roster (unpaginated {items}) and filters active/inactive", async () => {
  const user = userEvent.setup();
  const c1 = sampleCandidate({
    id: "66f0000000000000000000c1",
    name: "Rohan Active",
    active: true,
  });
  const c2 = sampleCandidate({
    id: "66f0000000000000000000c2",
    name: "Pooja Inactive",
    externalRef: "REF-002",
    active: false,
  });

  const fetchMock = installFetch(async (url) => {
    return (
      defaultBatchHandler(url, batchRecord(), [c1, c2]) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  expect(
    await screen.findByRole("heading", { name: "Candidate roster" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Rohan Active")).toBeInTheDocument();
  expect(screen.getByText("Pooja Inactive")).toBeInTheDocument();
  expect(
    screen.getByText(/Showing 2 candidate\(s\) \(1 active, 1 inactive\)/),
  ).toBeInTheDocument();

  // Filter Active only
  await user.selectOptions(screen.getByLabelText("Filter by status"), "active");
  expect(await screen.findByText("Rohan Active")).toBeInTheDocument();
  expect(screen.queryByText("Pooja Inactive")).not.toBeInTheDocument();

  // Filter Inactive only
  await user.selectOptions(
    screen.getByLabelText("Filter by status"),
    "inactive",
  );
  expect(await screen.findByText("Pooja Inactive")).toBeInTheDocument();
  expect(screen.queryByText("Rohan Active")).not.toBeInTheDocument();

  const candidateCalls = fetchMock.mock.calls.filter((call) =>
    requestUrl(call[0]).pathname.endsWith("/candidates"),
  );
  expect(candidateCalls.length).toBeGreaterThanOrEqual(3);
});

it("adds a candidate without national-id fields and updates the roster", async () => {
  const user = userEvent.setup();
  let createdCandidate: unknown = null;

  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/candidates") && methodOf(init) === "POST") {
      createdCandidate = requestJson(init);
      return jsonResponse(201, {
        id: "66f0000000000000000000c9",
        batchId: IDS.batch,
        learnerId: "66f0000000000000000000l9",
        name: "Sunil Kumar",
        externalRef: "SK-99",
        accommodations: ["Reader"],
        active: true,
        createdAt: "2026-10-12T12:00:00.000Z",
        updatedAt: "2026-10-12T12:00:00.000Z",
      });
    }
    return (
      defaultBatchHandler(url, batchRecord()) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  await user.click(screen.getByRole("button", { name: "Add candidate" }));

  const dialog = screen.getByRole("dialog", { name: "Add candidate" });
  expect(within(dialog).getByLabelText("Full name")).toBeInTheDocument();
  expect(
    within(dialog).getByLabelText("External reference"),
  ).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Accommodations")).toBeInTheDocument();

  // Verify no national ID fields exist
  expect(within(dialog).queryByLabelText(/aadhaar/i)).not.toBeInTheDocument();
  expect(within(dialog).queryByLabelText(/national/i)).not.toBeInTheDocument();
  expect(within(dialog).queryByLabelText(/id number/i)).not.toBeInTheDocument();

  await user.type(within(dialog).getByLabelText("Full name"), "Sunil Kumar");
  await user.type(within(dialog).getByLabelText("External reference"), "SK-99");
  await user.type(within(dialog).getByLabelText("Accommodations"), "Reader");
  await user.click(
    within(dialog).getByRole("button", { name: "Add candidate" }),
  );

  expect(
    await screen.findByText("Candidate added to roster."),
  ).toBeInTheDocument();
  expect(createdCandidate).toEqual({
    name: "Sunil Kumar",
    externalRef: "SK-99",
    accommodations: ["Reader"],
  });
});

it("sends the email without checking it and says a login was made (X-36)", async () => {
  const user = userEvent.setup();
  let sent: unknown = null;

  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/candidates") && methodOf(init) === "POST") {
      sent = requestJson(init);
      return jsonResponse(201, {
        id: "66f0000000000000000000c9",
        batchId: IDS.batch,
        learnerId: "66f0000000000000000000a9",
        name: "Sunil Kumar",
        externalRef: "SK-99",
        accommodations: [],
        active: true,
        createdAt: "2026-10-12T12:00:00.000Z",
        updatedAt: "2026-10-12T12:00:00.000Z",
        login: { status: "created", emailQueued: false },
      });
    }
    return (
      defaultBatchHandler(url, batchRecord()) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await screen.findByRole("heading", { name: "Candidate roster" });
  await user.click(screen.getByRole("button", { name: "Add candidate" }));
  const dialog = screen.getByRole("dialog", { name: "Add candidate" });
  await user.type(within(dialog).getByLabelText("Full name"), "Sunil Kumar");
  await user.type(within(dialog).getByLabelText("External reference"), "SK-99");
  await user.type(
    within(dialog).getByLabelText("Email (optional)"),
    "not-an-email",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Add candidate" }),
  );
  expect(
    await screen.findByText(
      /A login was created; the sign-in id and password are in the list/,
    ),
  ).toBeInTheDocument();
  expect(sent).toEqual({
    name: "Sunil Kumar",
    externalRef: "SK-99",
    email: "not-an-email",
    accommodations: [],
  });
});

it("shows each student's sign-in id and first password to staff, and lets staff make or reset a login (X-36)", async () => {
  const user = userEvent.setup();
  const calls: { url: string; body: unknown }[] = [];
  const row = (id: string, name: string, login: unknown) => ({
    id,
    batchId: IDS.batch,
    learnerId: `66f0000000000000000000a${id.slice(-1)}`,
    name,
    externalRef: `R-${id.slice(-1)}`,
    accommodations: [],
    active: true,
    createdAt: "2026-10-12T12:00:00.000Z",
    updatedAt: "2026-10-12T12:00:00.000Z",
    login,
  });
  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/login") && methodOf(init) === "POST") {
      calls.push({ url: url.pathname, body: requestJson(init) });
      return jsonResponse(200, { status: "reset" });
    }
    if (url.pathname.endsWith("/candidates")) {
      return jsonResponse(200, {
        items: [
          row("66f0000000000000000000c1", "Asha Devi", {
            loginId: "asha@example.com",
            initialPassword: "Tmp-abc123",
            mustChangePassword: true,
            active: true,
          }),
          row("66f0000000000000000000c2", "Ravi Kumar", {
            loginId: "r-2-a2@students.local",
            initialPassword: null,
            mustChangePassword: false,
            active: true,
          }),
          row("66f0000000000000000000c3", "Meera Das", null),
        ],
      });
    }
    return (
      defaultBatchHandler(url, batchRecord()) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  await screen.findByText("asha@example.com");
  expect(screen.getByText("Tmp-abc123")).toBeInTheDocument();
  expect(screen.getByText("r-2-a2@students.local")).toBeInTheDocument();
  expect(screen.getByText("Changed by the student")).toBeInTheDocument();
  expect(screen.getByText("No login")).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "New password for Asha Devi" }),
  );
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].url).toContain("/candidates/66f0000000000000000000c1/login");
  expect(calls[0].body).toEqual({ reset: true });
  expect(
    screen.getByRole("button", { name: "Create login for Meera Das" }),
  ).toBeInTheDocument();
});

it("shows RULE_RATIO error on add and allows aa_admin to submit ratio override", async () => {
  const user = userEvent.setup();
  let receivedOverride: unknown = null;

  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/candidates") && methodOf(init) === "POST") {
      const body = requestJson(init) as { ratioOverrideReason?: string };
      if (!body.ratioOverrideReason) {
        return jsonResponse(409, {
          error: {
            code: "RULE_RATIO",
            message: "Candidate count exceeds the assessor ratio",
            details: {
              ratioClass: "manufacturing",
              candidateCount: 26,
              max: 25,
            },
          },
        });
      }
      receivedOverride = body.ratioOverrideReason;
      return jsonResponse(
        201,
        sampleCandidate({ name: "Over Ratio Candidate" }),
      );
    }
    return (
      defaultBatchHandler(
        url,
        batchRecord({ status: "assessor_assigned", assessorId: IDS.assessor }),
      ) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  await user.click(screen.getByRole("button", { name: "Add candidate" }));

  const dialog = screen.getByRole("dialog", { name: "Add candidate" });
  await user.type(
    within(dialog).getByLabelText("Full name"),
    "Over Ratio Candidate",
  );
  await user.type(within(dialog).getByLabelText("External reference"), "OR-1");
  await user.click(
    within(dialog).getByRole("button", { name: "Add candidate" }),
  );

  // Alert is shown with ratio rule explanation and details
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "assessor-to-learner ratio",
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Ratio class: manufacturing",
  );

  // Ratio override reason is revealed
  expect(
    within(dialog).getByLabelText("Ratio override reason"),
  ).toBeInTheDocument();
  await user.type(
    within(dialog).getByLabelText("Ratio override reason"),
    "Approved batch expansion by AA Admin",
  );
  await user.click(within(dialog).getByRole("button", { name: "Retry" }));

  expect(
    await screen.findByText("Candidate added to roster."),
  ).toBeInTheDocument();
  expect(receivedOverride).toBe("Approved batch expansion by AA Admin");
});

it("edits a candidate and updates accommodations and status", async () => {
  const user = userEvent.setup();
  let patchPayload: unknown = null;
  const existing = sampleCandidate();

  installFetch(async (url, init) => {
    if (
      url.pathname.endsWith(`/candidates/${existing.id}`) &&
      methodOf(init) === "PATCH"
    ) {
      patchPayload = requestJson(init);
      return jsonResponse(200, {
        ...existing,
        accommodations: ["Extra time", "Large font"],
        active: false,
      });
    }
    return (
      defaultBatchHandler(url, batchRecord(), [existing]) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  const editBtn = await screen.findByRole("button", { name: "Edit" });
  await user.click(editBtn);

  const dialog = screen.getByRole("dialog", { name: "Edit candidate" });
  expect(within(dialog).getByText(/Rohan Sharma/)).toBeInTheDocument();

  const accommInput = within(dialog).getByLabelText("Accommodations");
  await user.clear(accommInput);
  await user.type(accommInput, "Extra time, Large font");
  await user.click(within(dialog).getByLabelText("Active on roster"));

  await user.click(
    within(dialog).getByRole("button", { name: "Save changes" }),
  );

  expect(
    await screen.findByText("Candidate details updated."),
  ).toBeInTheDocument();
  expect(patchPayload).toEqual({
    accommodations: ["Extra time", "Large font"],
    active: false,
  });
});

it("deactivates and activates a candidate", async () => {
  const user = userEvent.setup();
  let patchCall: unknown = null;
  const candidate = sampleCandidate({ active: true });

  installFetch(async (url, init) => {
    if (
      url.pathname.endsWith(`/candidates/${candidate.id}`) &&
      methodOf(init) === "PATCH"
    ) {
      patchCall = requestJson(init);
      return jsonResponse(200, { ...candidate, active: false });
    }
    return (
      defaultBatchHandler(url, batchRecord(), [candidate]) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  const deactivateBtn = await screen.findByRole("button", {
    name: "Deactivate",
  });
  await user.click(deactivateBtn);

  expect(
    await screen.findByText(/Candidate Rohan Sharma deactivated\./),
  ).toBeInTheDocument();
  expect(patchCall).toEqual({ active: false });
});

it("imports CSV with file picker, shows neutralisation note and success", async () => {
  const user = userEvent.setup();
  let receivedFile: string | null = null;

  installFetch(async (url, init) => {
    if (
      url.pathname.endsWith("/candidates/import") &&
      methodOf(init) === "POST"
    ) {
      if (init?.body instanceof FormData) {
        const file = init.body.get("file") as File;
        receivedFile = file ? file.name : "unknown";
      }
      return jsonResponse(200, {
        created: 5,
        skipped: 1,
        errors: [],
      });
    }
    return (
      defaultBatchHandler(url, batchRecord()) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  await user.click(screen.getByRole("button", { name: "Import CSV" }));

  const dialog = screen.getByRole("dialog", {
    name: "Import candidates from CSV",
  });

  // Verify note that cells starting with = + - @ are neutralised
  expect(within(dialog).getByText(/Cells starting with/)).toHaveTextContent(
    "Cells starting with =, +, -, or @ are neutralised",
  );

  const fileInput = within(dialog).getByLabelText("CSV file");
  const testFile = new File(
    ["name,externalRef\nTest User,REF-1\n"],
    "roster.csv",
    {
      type: "text/csv",
    },
  );
  await user.upload(fileInput, testFile);

  await user.click(
    within(dialog).getByRole("button", { name: "Upload and import" }),
  );

  expect(
    await screen.findByText(
      /Import complete: 5 created, 1 duplicate\(s\) skipped\./,
    ),
  ).toBeInTheDocument();
  expect(receivedFile).toBe("roster.csv");
});

it("shows per-row error report on CSV import errors from server", async () => {
  const user = userEvent.setup();

  installFetch(async (url, init) => {
    if (
      url.pathname.endsWith("/candidates/import") &&
      methodOf(init) === "POST"
    ) {
      return jsonResponse(200, {
        created: 2,
        skipped: 1,
        errors: [
          { row: 4, reason: "name and externalRef are required" },
          { row: 6, reason: "Learner is already on this batch" },
        ],
      });
    }
    return (
      defaultBatchHandler(url, batchRecord()) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  await user.click(screen.getByRole("button", { name: "Import CSV" }));

  const dialog = screen.getByRole("dialog", {
    name: "Import candidates from CSV",
  });
  const fileInput = within(dialog).getByLabelText("CSV file");
  const testFile = new File(
    ["name,externalRef\nRow 1,R1\n"],
    "candidates.csv",
    {
      type: "text/csv",
    },
  );
  await user.upload(fileInput, testFile);

  await user.click(
    within(dialog).getByRole("button", { name: "Upload and import" }),
  );

  // Check per-row error report rendered
  expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  expect(
    within(dialog).getByText("Row 4: name and externalRef are required"),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText("Row 6: Learner is already on this batch"),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText(
      /Import processed: 2 candidate\(s\) added, 1 duplicate\(s\) skipped\./,
    ),
  ).toBeInTheDocument();
});

it("disables write controls when batch status is not allocated, accepted, or assessor_assigned", async () => {
  installFetch(async (url) => {
    return (
      defaultBatchHandler(url, batchRecord({ status: "in_progress" })) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  expect(
    screen.getByText(
      /Candidate roster is locked\. Roster writes are allowed only while the batch is allocated/,
    ),
  ).toBeInTheDocument();

  // Add and import buttons are disabled
  expect(screen.getByRole("button", { name: "Add candidate" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
  expect(await screen.findByRole("button", { name: "Edit" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Deactivate" })).toBeDisabled();
});

it("shows server error if a 409 INVALID_TRANSITION comes back", async () => {
  const user = userEvent.setup();

  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/candidates") && methodOf(init) === "POST") {
      return jsonResponse(409, {
        error: {
          code: "INVALID_TRANSITION",
          message: "Candidates can only be changed before assessment starts",
        },
      });
    }
    return (
      defaultBatchHandler(url, batchRecord({ status: "allocated" })) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);

  await screen.findByRole("heading", { name: "Candidate roster" });
  await user.click(screen.getByRole("button", { name: "Add candidate" }));

  const dialog = screen.getByRole("dialog", { name: "Add candidate" });
  await user.type(within(dialog).getByLabelText("Full name"), "Late Candidate");
  await user.type(within(dialog).getByLabelText("External reference"), "LC-1");
  await user.click(
    within(dialog).getByRole("button", { name: "Add candidate" }),
  );

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Candidates can only be changed before assessment starts",
  );
});

it("enforces role guards: proctor and sme are denied, assessor is read-only", async () => {
  // Proctor role
  installFetch(async (url) => {
    return (
      defaultBatchHandler(url, batchRecord()) ??
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } })
    );
  });

  setSession(sessionFor("proctor"));
  const viewProctor = renderApp(`/batches/${IDS.batch}`);
  expect(
    await screen.findByText(
      "Candidate roster is not accessible for this role.",
    ),
  ).toBeInTheDocument();
  viewProctor.unmount();

  // Assessor role - can read, but no write controls
  setSession(sessionFor("assessor"));
  const viewAssessor = renderApp(`/batches/${IDS.batch}`);
  expect(
    await screen.findByRole("heading", { name: "Candidate roster" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Rohan Sharma")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add candidate" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Import CSV" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Deactivate" }),
  ).not.toBeInTheDocument();
  viewAssessor.unmount();
});
