import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  DEFAULT_BATCH_SETTINGS,
  type BatchSettings,
} from "../api/batchSettings";
import type { BatchRecord } from "../api/batches";
import type { ResultRecord, ResultRow } from "../api/results";
import { setSession } from "../api/session";
import type { Role } from "../routing/access";
import { IDS, batchRecord } from "../test/batchFixtures";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const ASHA = "66f0000000000000000000k1";
const BALA = "66f0000000000000000000k2";
const CHITRA = "66f0000000000000000000k3";
const RESULT_ID = "66f0000000000000000000r1";

/** One NOS: theory out of 40, practical out of 100 (percent default), viva not assessed. */
const qualification = {
  id: IDS.qualification,
  code: "Q-ELEC-L4",
  name: "Electrician L4",
  sector: "Electronics",
  ratioClass: "manufacturing",
  defaultBatchType: null,
  passCriteriaMode: "nos_wise",
  passMarkUnit: "percent",
  passMarks: { theory: 50, practical: 50, viva: 50 },
  maxMarks: null,
  nos: [
    {
      nosId: "NOS-01",
      code: "N01",
      name: "Safety",
      maxMarks: { theory: 40, practical: null, viva: 0 },
      pcs: [],
    },
  ],
  pcPassMarksRequired: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function candidate(id: string, name: string, active = true) {
  return {
    id,
    batchId: IDS.batch,
    learnerId: null,
    name,
    externalRef: null,
    accommodations: [],
    active,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
  };
}

const roster = [
  candidate(ASHA, "Asha Devi"),
  candidate(BALA, "Bala Kumar"),
  candidate(CHITRA, "Chitra Rao"),
];

function attendanceRow(candidateId: string, present: boolean) {
  return {
    id: `att-${candidateId}`,
    batchId: IDS.batch,
    candidateId,
    present,
    idVerified: null,
    note: null,
    capturedAt: "2026-11-20T05:00:00.000Z",
  };
}

const marks = (theory: number | null, practical: number | null) => [
  { nosId: "NOS-01", theory, practical, viva: null },
];

function resultRecord(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    id: RESULT_ID,
    batchId: IDS.batch,
    status: "draft",
    rows: [
      { candidateId: ASHA, absent: false, outcome: "Pass", nos: marks(30, 70) },
      { candidateId: BALA, absent: true, outcome: "Absent", nos: [] },
      {
        candidateId: CHITRA,
        absent: false,
        outcome: "Fail",
        nos: marks(10, 70),
      },
    ],
    submittedAt: null,
    submittedBy: null,
    validatedAt: null,
    validatedBy: null,
    publishedAt: null,
    publishedBy: null,
    createdAt: "2026-11-23T06:00:00.000Z",
    updatedAt: "2026-11-23T06:00:00.000Z",
    ...overrides,
  };
}

type Call = { method: string; path: string; body: unknown };

type World = {
  batch: BatchRecord;
  result: ResultRecord | null;
  attendance: ReturnType<typeof attendanceRow>[];
  /** X-29: the batch's settings; none means the settings call fails and the plain grid shows. */
  settings?: BatchSettings;
  /** A response for a write, or undefined to fall through to the default. */
  onWrite?: (call: Call, world: World) => Response | undefined;
  calls: Call[];
};

const notFound = () =>
  jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });

function install(world: World) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.pathname.replace(/^.*\/api\/v1/, "");
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      world.calls.push({ method, path, body });
      const base = `/batches/${IDS.batch}`;
      if (method !== "GET") {
        return world.onWrite?.({ method, path, body }, world) ?? notFound();
      }
      if (path === base) return jsonResponse(200, world.batch);
      if (path === `${base}/candidates`)
        return jsonResponse(200, { items: roster });
      if (path === `${base}/attendance`)
        return jsonResponse(200, { items: world.attendance });
      if (path === `${base}/settings`)
        return world.settings
          ? jsonResponse(200, { batchId: IDS.batch, settings: world.settings })
          : notFound();
      if (path === `${base}/results`)
        return world.result ? jsonResponse(200, world.result) : notFound();
      if (path === `/qualifications/${IDS.qualification}`)
        return jsonResponse(200, qualification);
      return notFound();
    }),
  );
}

function makeWorld(overrides: Partial<World> = {}): World {
  return {
    batch: batchRecord({
      status: "assessment_completed",
      statusVersion: 5,
      candidateCount: 3,
    }),
    result: null,
    attendance: [
      attendanceRow(ASHA, true),
      attendanceRow(BALA, false),
      attendanceRow(CHITRA, true),
    ],
    calls: [],
    ...overrides,
  };
}

function open(role: Role, world: World) {
  install(world);
  setSession(sessionFor(role));
  renderApp(`/batches/${IDS.batch}`);
}

async function resultRegion() {
  return screen.findByRole("region", { name: "Result" });
}

function writes(world: World) {
  return world.calls.filter((call) => call.method !== "GET");
}

function rowOf(region: HTMLElement, name: string) {
  return within(region).getByRole("row", { name: new RegExp(name) });
}

it("shows a marks grid with ceilings, keeps Absent candidates closed, and warns on a partly filled row", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    onWrite: (call, w) => {
      if (call.method !== "PUT") return undefined;
      const rows = (
        call.body as {
          rows: Array<{ candidateId: string; nos: ResultRow["nos"] }>;
        }
      ).rows;
      w.result = resultRecord({
        updatedAt: "2026-11-23T07:00:00.000Z",
        rows: rows.map((row) => ({
          candidateId: row.candidateId,
          absent: row.candidateId === BALA,
          outcome: row.candidateId === BALA ? "Absent" : null,
          nos: row.nos,
        })),
      });
      return jsonResponse(200, w.result);
    },
  });
  open("aa_admin", world);
  const region = await resultRegion();

  expect(
    await within(region).findByText(/Result status: Not started/),
  ).toBeInTheDocument();
  expect(
    await within(region).findByRole("columnheader", {
      name: "Theory (max 40)",
    }),
  ).toBeInTheDocument();
  expect(
    within(region).getByText(
      /Pass marks for Q-ELEC-L4 are in percent of the ceiling/,
    ),
  ).toBeInTheDocument();
  expect(
    within(region).getByRole("columnheader", { name: "Practical (max 100)" }),
  ).toBeInTheDocument();
  expect(
    within(region).getByRole("columnheader", { name: "Viva (not assessed)" }),
  ).toBeInTheDocument();

  // Absent from attendance: shown as Absent, with no inputs.
  const bala = rowOf(region, "Bala Kumar");
  expect(bala).toHaveTextContent("Absent in attendance");
  expect(within(bala).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(
    within(region).queryByLabelText("Asha Devi, N01 Safety, Viva"),
  ).not.toBeInTheDocument();

  const submit = within(region).getByRole("button", { name: "Submit result" });
  expect(submit).toBeDisabled();
  expect(
    within(region).getByText("Save a draft before you submit."),
  ).toBeInTheDocument();

  await user.type(
    within(region).getByLabelText("Asha Devi, N01 Safety, Theory"),
    "30",
  );
  const asha = rowOf(region, "Asha Devi");
  expect(asha).toHaveTextContent("Incomplete: 1 of 2 marks missing.");
  expect(asha).toHaveTextContent("Not saved");
  expect(asha).not.toHaveTextContent(/Pass|Fail/);

  await user.type(
    within(region).getByLabelText("Change reason (optional)"),
    "First marks sheet",
  );
  await user.click(within(region).getByRole("button", { name: "Save draft" }));
  expect(await within(region).findByText("Draft saved.")).toBeInTheDocument();

  expect(writes(world)).toEqual([
    {
      method: "PUT",
      path: `/batches/${IDS.batch}/results`,
      body: {
        rows: [
          {
            candidateId: ASHA,
            nos: [{ nosId: "NOS-01", theory: 30, practical: null, viva: null }],
          },
          { candidateId: BALA, nos: [] },
          {
            candidateId: CHITRA,
            nos: [
              { nosId: "NOS-01", theory: null, practical: null, viva: null },
            ],
          },
        ],
        changeReason: "First marks sheet",
      },
    },
  ]);

  // The saved, partly filled row has no outcome and still blocks Submit.
  const savedAsha = rowOf(region, "Asha Devi");
  expect(savedAsha).toHaveTextContent("No outcome");
  expect(savedAsha).toHaveTextContent("Incomplete: 1 of 2 marks missing.");
  expect(rowOf(region, "Bala Kumar")).toHaveTextContent("Absent");
  expect(
    within(region).getByRole("button", { name: "Submit result" }),
  ).toBeDisabled();
  expect(
    within(region).getByText(/2 candidate\(s\) still have marks missing/),
  ).toBeInTheDocument();
  expect(
    within(region).getByLabelText("Asha Devi, N01 Safety, Theory"),
  ).toHaveValue(30);
}, 15000);

it("flags a mark above the ceiling and does not send it", async () => {
  const user = userEvent.setup();
  const world = makeWorld();
  open("aa_admin", world);
  const region = await resultRegion();

  const theory = await within(region).findByLabelText(
    "Asha Devi, N01 Safety, Theory",
  );
  await user.type(theory, "41");
  expect(theory).toHaveAttribute("aria-invalid", "true");
  expect(rowOf(region, "Asha Devi")).toHaveTextContent(
    "1 mark(s) above the ceiling or not valid.",
  );

  await user.click(within(region).getByRole("button", { name: "Save draft" }));
  expect(await within(region).findByRole("alert")).toHaveTextContent(
    "above the ceiling or not valid",
  );
  expect(writes(world)).toEqual([]);
});

it("lets a candidate with no attendance row be marked absent", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    attendance: [attendanceRow(ASHA, true), attendanceRow(BALA, false)],
    onWrite: () => jsonResponse(200, resultRecord()),
  });
  open("aa_admin", world);
  const region = await resultRegion();

  const chitra = await within(region).findByRole("row", { name: /Chitra Rao/ });
  await user.click(
    within(chitra).getByRole("checkbox", { name: /Absent: Chitra Rao/ }),
  );
  expect(
    within(rowOf(region, "Chitra Rao")).queryByRole("spinbutton"),
  ).not.toBeInTheDocument();
  // Attendance already decided the other two, so they get no checkbox.
  expect(
    within(rowOf(region, "Asha Devi")).queryByRole("checkbox"),
  ).not.toBeInTheDocument();

  await user.click(within(region).getByRole("button", { name: "Save draft" }));
  await within(region).findByText("Draft saved.");
  const sent = writes(world)[0].body as { rows: unknown[] };
  expect(sent.rows[2]).toEqual({ candidateId: CHITRA, absent: true, nos: [] });
});

it("submits a complete draft and asks for a late reason on SLA_RESULT_EXPIRED", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    result: resultRecord(),
    onWrite: (call, w) => {
      if (!call.path.endsWith("/submit-result")) return undefined;
      if (!(call.body as { lateReason?: string }).lateReason) {
        return jsonResponse(409, {
          error: {
            code: "SLA_RESULT_EXPIRED",
            message: "lateReason is required after resultDueAt",
          },
        });
      }
      w.batch = { ...w.batch, status: "result_submitted", statusVersion: 6 };
      w.result = resultRecord({
        status: "submitted",
        submittedAt: "2026-11-26T06:00:00.000Z",
      });
      return jsonResponse(200, {
        ...w.result,
        batchStatus: "result_submitted",
        batchStatusVersion: 6,
      });
    },
  });
  open("aa_admin", world);
  const region = await resultRegion();

  expect(
    await within(region).findByRole("row", { name: /Asha Devi/ }),
  ).toHaveTextContent("Pass");
  expect(rowOf(region, "Chitra Rao")).toHaveTextContent("Fail");
  expect(
    within(region).queryByLabelText("Late reason"),
  ).not.toBeInTheDocument();

  const submit = within(region).getByRole("button", { name: "Submit result" });
  expect(submit).toBeEnabled();
  await user.click(submit);

  expect(await within(region).findByRole("alert")).toHaveTextContent(
    "lateReason is required after resultDueAt",
  );
  const late = within(region).getByLabelText("Late reason");
  await user.type(late, "Marks verification took an extra day");
  await user.click(
    within(region).getByRole("button", { name: "Submit result" }),
  );

  expect(
    await within(region).findByText("Result submitted to the awarding body."),
  ).toBeInTheDocument();
  expect(writes(world).map((call) => call.body)).toEqual([
    {},
    { lateReason: "Marks verification took an extra day" },
  ]);
  // Marks are closed once submitted.
  expect(
    await within(region).findByText(/Result status: Submitted/),
  ).toBeInTheDocument();
  expect(within(region).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(
    within(region).queryByRole("button", { name: "Save draft" }),
  ).not.toBeInTheDocument();
  expect(
    within(region).getByText(
      "Marks are read only once the result is submitted.",
    ),
  ).toBeInTheDocument();
}, 15000);

it("shows the RESULT_INCOMPLETE message from the server with candidate names", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    result: resultRecord(),
    onWrite: () =>
      jsonResponse(409, {
        error: {
          code: "RESULT_INCOMPLETE",
          message: "Every active candidate needs a complete result row",
          details: { missingCandidates: [BALA], incompleteMarks: [CHITRA] },
        },
      }),
  });
  open("aa_admin", world);
  const region = await resultRegion();

  await user.click(
    await within(region).findByRole("button", { name: "Submit result" }),
  );
  const alert = await within(region).findByRole("alert");
  expect(alert).toHaveTextContent("RESULT_INCOMPLETE");
  expect(alert).toHaveTextContent(
    "Every active candidate needs a complete result row",
  );
  expect(alert).toHaveTextContent("No row for: Bala Kumar.");
  expect(alert).toHaveTextContent("Marks missing for: Chitra Rao.");
  expect(within(region).getByText(/Result status: Draft/)).toBeInTheDocument();
});

it("lets the AB reviewer validate then publish, and offers Return for correction until published", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    batch: batchRecord({ status: "result_submitted", statusVersion: 6 }),
    result: resultRecord({
      status: "submitted",
      submittedAt: "2026-11-24T06:00:00.000Z",
    }),
    onWrite: (call, w) => {
      if (call.path.endsWith("/validate")) {
        w.batch = { ...w.batch, status: "ab_validated", statusVersion: 7 };
        w.result = resultRecord({
          status: "validated",
          validatedAt: "2026-11-25T06:00:00.000Z",
        });
        return jsonResponse(200, {
          ...w.result,
          batchStatus: "ab_validated",
          batchStatusVersion: 7,
        });
      }
      if (call.path.endsWith("/publish")) {
        w.batch = { ...w.batch, status: "published", statusVersion: 8 };
        w.result = resultRecord({
          status: "published",
          publishedAt: "2026-11-26T06:00:00.000Z",
        });
        return jsonResponse(200, {
          ...w.result,
          batchStatus: "published",
          batchStatusVersion: 8,
        });
      }
      return undefined;
    },
  });
  open("ab_reviewer", world);
  const region = await resultRegion();

  expect(
    await within(region).findByRole("row", { name: /Asha Devi/ }),
  ).toHaveTextContent("Pass");
  expect(within(region).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(
    within(region).queryByRole("button", { name: "Save draft" }),
  ).not.toBeInTheDocument();
  expect(
    within(region).queryByRole("button", { name: "Submit result" }),
  ).not.toBeInTheDocument();

  expect(
    within(region).getByRole("button", { name: "Return for correction" }),
  ).toBeEnabled();

  await user.type(
    within(region).getByLabelText("Reason (optional)"),
    "Checked against the marks sheet",
  );
  await user.click(
    within(region).getByRole("button", { name: "Validate result" }),
  );
  expect(
    await within(region).findByText("Result validated."),
  ).toBeInTheDocument();

  await user.click(
    await within(region).findByRole("button", { name: "Publish result" }),
  );
  expect(
    await within(region).findByText("Result published."),
  ).toBeInTheDocument();
  expect(
    await within(region).findByText(/Result status: Published/),
  ).toBeInTheDocument();

  expect(writes(world)).toEqual([
    {
      method: "POST",
      path: `/batches/${IDS.batch}/validate`,
      body: { reason: "Checked against the marks sheet" },
    },
    { method: "POST", path: `/batches/${IDS.batch}/publish`, body: {} },
  ]);
  expect(
    world.calls.some((call) => call.path.includes("return-for-correction")),
  ).toBe(false);
  // Published: nothing left for the reviewer to do.
  expect(
    within(region).queryByRole("button", { name: "Publish result" }),
  ).not.toBeInTheDocument();
  expect(
    within(region).queryByRole("button", { name: "Return for correction" }),
  ).not.toBeInTheDocument();
}, 15000);

it("shows a reviewer the server's refusal", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    batch: batchRecord({ status: "result_submitted" }),
    result: resultRecord({ status: "submitted" }),
    onWrite: () =>
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "Not your awarding body" },
      }),
  });
  open("ab_reviewer", world);
  const region = await resultRegion();
  await user.click(
    await within(region).findByRole("button", { name: "Validate result" }),
  );
  expect(await within(region).findByRole("alert")).toHaveTextContent(
    "Not your awarding body",
  );
});

it.each(["mis", "ncvet_viewer", "assessor"] as const)(
  "gives %s a read-only view",
  async (role) => {
    const world = makeWorld({ result: resultRecord() });
    open(role, world);
    const region = await resultRegion();

    expect(
      await within(region).findByRole("row", { name: /Chitra Rao/ }),
    ).toHaveTextContent("Fail");
    expect(rowOf(region, "Bala Kumar")).toHaveTextContent("Absent");
    expect(
      within(region).getByText("This view is read only."),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(region).queryAllByRole("button")).toEqual([]);
    expect(writes(world)).toEqual([]);
    // An assessor cannot read qualifications, so the screen does not ask.
    const askedQualification = world.calls.some((call) =>
      call.path.startsWith("/qualifications/"),
    );
    expect(askedQualification).toBe(role !== "assessor");
  },
);

it("shows tp nothing until the result is published", async () => {
  // The server answers 404 to this role while the result is unpublished.
  const hidden = makeWorld({
    batch: batchRecord({ status: "ab_validated" }),
    result: null,
  });
  open("tp", hidden);
  const region = await resultRegion();
  expect(
    await within(region).findByText("No published result for this batch."),
  ).toBeInTheDocument();
  expect(within(region).queryByRole("table")).not.toBeInTheDocument();
  expect(within(region).queryByText(/Result status/)).not.toBeInTheDocument();
  expect(within(region).queryAllByRole("button")).toEqual([]);
});

it("shows tp the published result, read only", async () => {
  const world = makeWorld({
    batch: batchRecord({ status: "published" }),
    result: resultRecord({
      status: "published",
      publishedAt: "2026-11-26T06:00:00.000Z",
    }),
  });
  open("tp", world);
  const region = await resultRegion();
  expect(
    await within(region).findByText(/Result status: Published/),
  ).toBeInTheDocument();
  expect(
    await within(region).findByRole("row", { name: /Asha Devi/ }),
  ).toHaveTextContent("Pass");
  expect(within(region).queryAllByRole("button")).toEqual([]);
});

it("does not ask for results before the assessment is completed, or for a role that cannot read them", async () => {
  const early = makeWorld({ batch: batchRecord({ status: "in_progress" }) });
  open("aa_admin", early);
  const region = await resultRegion();
  expect(
    within(region).getByText(
      "Marks can be entered once the assessment is completed.",
    ),
  ).toBeInTheDocument();
  expect(early.calls.some((call) => call.path.endsWith("/results"))).toBe(
    false,
  );
});

it("tells a proctor that results are not available", async () => {
  const world = makeWorld({ result: resultRecord() });
  open("proctor", world);
  const region = await resultRegion();
  expect(
    within(region).getByText("Results are not available for this role."),
  ).toBeInTheDocument();
  expect(world.calls.some((call) => call.path.endsWith("/results"))).toBe(
    false,
  );
});

/** A reviewer's batch with a submitted result; `return-for-correction` answers through `respond`. */
function returnWorld(
  respond: (call: Call, world: World) => Response | undefined,
) {
  return makeWorld({
    batch: batchRecord({ status: "result_submitted", statusVersion: 6 }),
    result: resultRecord({
      status: "submitted",
      submittedAt: "2026-11-24T06:00:00.000Z",
    }),
    onWrite: (call, w) =>
      call.path.endsWith("/return-for-correction")
        ? respond(call, w)
        : undefined,
  });
}

async function openReturnDialog(user: ReturnType<typeof userEvent.setup>) {
  const region = await resultRegion();
  await user.click(
    await within(region).findByRole("button", {
      name: "Return for correction",
    }),
  );
  return {
    region,
    dialog: await screen.findByRole("dialog", {
      name: "Return for correction",
    }),
  };
}

it("returns a submitted result for correction with a reason, then reloads the batch and the result", async () => {
  const user = userEvent.setup();
  const world = returnWorld((_call, w) => {
    w.batch = { ...w.batch, status: "assessment_completed", statusVersion: 7 };
    w.result = resultRecord({
      status: "draft",
      updatedAt: "2026-11-25T06:00:00.000Z",
    });
    return jsonResponse(200, {
      ...w.result,
      batchStatus: "assessment_completed",
      batchStatusVersion: 7,
    });
  });
  open("ab_reviewer", world);
  const { region, dialog } = await openReturnDialog(user);

  await user.type(
    within(dialog).getByLabelText("Reason"),
    "  NOS-01 theory marks do not match the marks sheet  ",
  );
  const before = world.calls.length;
  await user.click(
    within(dialog).getByRole("button", { name: "Return result" }),
  );

  expect(
    await within(region).findByText("Result returned for correction."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(writes(world)).toEqual([
    {
      method: "POST",
      path: `/batches/${IDS.batch}/return-for-correction`,
      body: { reason: "NOS-01 theory marks do not match the marks sheet" },
    },
  ]);

  // Both the batch and the result are read again, and the review actions go away.
  expect(
    await within(region).findByText(/Result status: Draft/),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(region).queryByRole("button", { name: "Return for correction" }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      within(region).queryByRole("button", { name: "Validate result" }),
    ).not.toBeInTheDocument(),
  );
  const reloaded = world.calls
    .slice(before)
    .filter((call) => call.method === "GET");
  expect(reloaded.some((call) => call.path === `/batches/${IDS.batch}`)).toBe(
    true,
  );
  expect(
    reloaded.some((call) => call.path === `/batches/${IDS.batch}/results`),
  ).toBe(true);
}, 15000);

it("offers Return for correction on a validated result", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    batch: batchRecord({ status: "ab_validated", statusVersion: 7 }),
    result: resultRecord({
      status: "validated",
      validatedAt: "2026-11-25T06:00:00.000Z",
    }),
  });
  open("ab_reviewer", world);
  const { dialog } = await openReturnDialog(user);
  expect(within(dialog).getByLabelText("Reason")).toBeRequired();
});

it("blocks a blank reason and sends nothing", async () => {
  const user = userEvent.setup();
  const world = returnWorld(() =>
    jsonResponse(500, {
      error: { code: "INTERNAL", message: "Should not be called" },
    }),
  );
  open("ab_reviewer", world);
  const { region, dialog } = await openReturnDialog(user);

  await user.click(
    within(dialog).getByRole("button", { name: "Return result" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Enter a reason of 1 to 2000 characters.",
  );

  await user.type(within(dialog).getByLabelText("Reason"), "   ");
  await user.click(
    within(dialog).getByRole("button", { name: "Return result" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Enter a reason of 1 to 2000 characters.",
  );
  expect(within(dialog).getByLabelText("Reason")).toHaveAttribute(
    "maxlength",
    "2000",
  );
  expect(writes(world)).toEqual([]);

  // Cancel closes the dialog and leaves the result as it was.
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    within(region).getByRole("button", { name: "Return for correction" }),
  ).toHaveFocus();
  expect(
    within(region).getByText(/Result status: Submitted/),
  ).toBeInTheDocument();
});

it.each([
  [403, "FORBIDDEN", "Role or row scope denied"],
  [409, "INVALID_TRANSITION", "Illegal status change"],
] as const)(
  "shows the server's message when the return is refused with %i",
  async (status, code, message) => {
    const user = userEvent.setup();
    const world = returnWorld(() =>
      jsonResponse(status, { error: { code, message } }),
    );
    open("ab_reviewer", world);
    const { region, dialog } = await openReturnDialog(user);

    await user.type(
      within(dialog).getByLabelText("Reason"),
      "Marks do not match",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Return result" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    // The dialog stays open with the reason, and nothing is announced as returned.
    expect(within(dialog).getByLabelText("Reason")).toHaveValue(
      "Marks do not match",
    );
    expect(
      within(dialog).getByRole("button", { name: "Return result" }),
    ).toBeEnabled();
    expect(
      within(region).queryByText("Result returned for correction."),
    ).not.toBeInTheDocument();
  },
);

it("hides Return for correction once the result is published", async () => {
  const world = makeWorld({
    batch: batchRecord({ status: "published", statusVersion: 8 }),
    result: resultRecord({
      status: "published",
      publishedAt: "2026-11-26T06:00:00.000Z",
    }),
  });
  open("ab_reviewer", world);
  const region = await resultRegion();
  expect(
    await within(region).findByText(/Result status: Published/),
  ).toBeInTheDocument();
  expect(
    await within(region).findByRole("row", { name: /Asha Devi/ }),
  ).toBeInTheDocument();
  expect(
    within(region).queryByRole("button", { name: "Return for correction" }),
  ).not.toBeInTheDocument();
  expect(within(region).queryAllByRole("button")).toEqual([]);
});

it.each(["aa_admin", "mis", "ncvet_viewer"] as const)(
  "does not offer Return for correction to %s",
  async (role) => {
    const world = makeWorld({
      batch: batchRecord({ status: "result_submitted", statusVersion: 6 }),
      result: resultRecord({ status: "submitted" }),
    });
    open(role, world);
    const region = await resultRegion();
    expect(
      await within(region).findByText(/Result status: Submitted/),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("button", { name: "Return for correction" }),
    ).not.toBeInTheDocument();
  },
);

it.each(["ab_validated", "published"] as const)(
  "hides the whole Result section from a candidate (batch %s)",
  async (status) => {
    const world = makeWorld({
      batch: batchRecord({ status }),
      result: resultRecord({
        status: status === "published" ? "published" : "validated",
      }),
    });
    open("candidate", world);
    // The rest of the batch page still renders for the candidate.
    expect(
      await screen.findByRole("heading", { name: "SLA timeline" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Result" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Result" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Result status/)).not.toBeInTheDocument();
    expect(world.calls.some((call) => call.path.endsWith("/results"))).toBe(
      false,
    );
  },
);

it("marks practical by three levels when the batch says so, and shows the batch's own pass rule (X-29)", async () => {
  const user = userEvent.setup();
  const world = makeWorld({
    settings: {
      ...DEFAULT_BATCH_SETTINGS,
      passCriteria: "overall",
      passPercentage: 60,
      practicalMarking: "rubric",
    },
    onWrite: (call, w) => {
      if (call.method !== "PUT") return undefined;
      w.result = resultRecord();
      return jsonResponse(200, w.result);
    },
  });
  open("aa_admin", world);
  const region = await resultRegion();

  expect(
    await within(region).findByText(
      /This batch has its own pass rule: 60 percent/,
    ),
  ).toBeInTheDocument();
  const pick = await within(region).findByRole("combobox", {
    name: "Asha Devi, N01 Safety, Practical",
  });
  expect(
    within(pick)
      .getAllByRole("option")
      .map((o) => o.textContent),
  ).toEqual(["Choose a level", "Good (100)", "Satisfactory (70)", "Poor (10)"]);
  // Theory stays a typed mark.
  expect(
    within(region).getByLabelText("Asha Devi, N01 Safety, Theory"),
  ).toHaveAttribute("type", "number");
  await user.selectOptions(pick, "satisfactory");
  await user.click(within(region).getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(writes(world)).toHaveLength(1));
  const sent = writes(world)[0].body as {
    rows: Array<{ candidateId: string; nos: ResultRow["nos"] }>;
  };
  expect(sent.rows.find((r) => r.candidateId === ASHA)?.nos[0].practical).toBe(
    70,
  );
}, 15000);
