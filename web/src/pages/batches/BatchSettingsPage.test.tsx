import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_BATCH_SETTINGS,
  type BatchSettings,
} from "../../api/batchSettings";
import { setSession } from "../../api/session";
import { jsonResponse, sessionFor } from "../../test/fixtures";
import { renderApp } from "../../test/render";
import {
  buildPatch,
  describeChanges,
  toDraft,
  validateDraft,
} from "./settingsDraft";

const ID = "66f0000000000000000000b1";

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return { ...DEFAULT_BATCH_SETTINGS, ...over };
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function stub(handler: Handler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new URL(String(input), "http://localhost"), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** GET returns `current`; PATCH merges the body shallowly per group and echoes the result. */
function api(
  current: BatchSettings = settings(),
  onPatch?: (body: unknown) => Response | undefined,
) {
  return stub((u, init) => {
    if (!u.pathname.endsWith(`/batches/${ID}/settings`))
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
    if ((init?.method ?? "GET") === "PATCH") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const custom = onPatch?.(body);
      if (custom) return custom;
      const next = {
        ...current,
        ...body,
        flagPolicy: { ...current.flagPolicy, ...(body.flagPolicy as object) },
        imageCapture: {
          ...current.imageCapture,
          ...(body.imageCapture as object),
        },
        candidateInfoPopup: {
          ...current.candidateInfoPopup,
          ...(body.candidateInfoPopup as object),
        },
      };
      return jsonResponse(200, { batchId: ID, settings: next });
    }
    return jsonResponse(200, { batchId: ID, settings: current });
  });
}

const patches = (mock: ReturnType<typeof stub>) =>
  mock.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
  );

afterEach(() => vi.unstubAllGlobals());

it("loads the settings with today's behaviour as the defaults, grouped under six headings", async () => {
  api();
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${ID}/settings`);

  expect(
    await screen.findByRole("heading", { name: "Batch settings", level: 1 }),
  ).toBeInTheDocument();
  for (const group of [
    "Shuffling",
    "Result display",
    "Flags",
    "Camera images",
    "Candidate pop-up",
    "Location",
  ]) {
    expect(
      await screen.findByRole("group", { name: group }),
    ).toBeInTheDocument();
  }
  expect(
    screen.getByRole("checkbox", { name: "Shuffle the questions" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Shuffle the answer options" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Show marks to the candidate" }),
  ).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Record only" })).toBeChecked();
  expect(screen.getByLabelText(/Take a camera image every/)).toHaveValue("30");
  expect(
    screen.getByRole("checkbox", { name: "Capture the candidate's location" }),
  ).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  expect(screen.getByText("No changes to save.")).toBeInTheDocument();
  // Every toggle has its one-line help text linked to it.
  expect(
    screen.getByRole("checkbox", { name: "Shuffle the questions" }),
  ).toHaveAccessibleDescription(/own order/);
  expect(screen.getByRole("link", { name: "Back to batch" })).toHaveAttribute(
    "href",
    `/batches/${ID}`,
  );
});

it("shows a loading state and an error with a retry", async () => {
  let fail = true;
  stub(() =>
    fail
      ? jsonResponse(500, {
          error: { code: "INTERNAL", message: "Server broke" },
        })
      : jsonResponse(200, { batchId: ID, settings: settings() }),
  );
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp(`/batches/${ID}/settings`);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading batch settings",
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Server broke");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("group", { name: "Shuffling" }),
  ).toBeInTheDocument();
});

it.each([
  "mis",
  "tp",
  "proctor",
  "assessor",
  "ab_reviewer",
  "ncvet_viewer",
] as const)("does not load or change anything for %s", async (role) => {
  const mock = api();
  setSession(sessionFor(role));
  renderApp(`/batches/${ID}/settings`);
  expect(
    await screen.findByText("Only an AA admin can change batch settings."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save settings" }),
  ).not.toBeInTheDocument();
  expect(
    mock.mock.calls.filter((c) => String(c[0]).includes("/batches/")),
  ).toHaveLength(0);
});

it("confirms before saving, lists the changes, and sends only what changed", async () => {
  const mock = api();
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp(`/batches/${ID}/settings`);
  await screen.findByRole("group", { name: "Flags" });

  await user.click(
    screen.getByRole("checkbox", { name: "Show marks to the candidate" }),
  );
  await user.click(screen.getByRole("radio", { name: "Pause the exam" }));
  await user.clear(screen.getByLabelText(/Pause after this many flags/));
  await user.type(screen.getByLabelText(/Pause after this many flags/), "5");
  await user.click(
    screen.getByRole("radio", { name: "Medium and high flags" }),
  );
  await user.click(screen.getByRole("button", { name: "Save settings" }));

  const dialog = await screen.findByRole("dialog", {
    name: "Save batch settings?",
  });
  expect(patches(mock)).toHaveLength(0);
  const lines = within(dialog)
    .getAllByRole("listitem")
    .map((li) => li.textContent);
  expect(lines).toEqual([
    "Show marks to the candidate: Off to On",
    "When a flag is raised: Record only to Pause the exam",
    "Pause after: 3 flags to 5 flags",
    "Flags that count: medium and high",
  ]);

  await user.click(
    within(dialog).getByRole("button", { name: "Confirm and save" }),
  );
  expect(await screen.findByText("Batch settings saved.")).toBeInTheDocument();
  expect(JSON.parse(String((patches(mock)[0][1] as RequestInit).body))).toEqual(
    {
      showMarksToCandidate: true,
      flagPolicy: {
        action: "pause",
        pauseAfterFlags: 5,
        countSeverities: ["medium", "high"],
      },
    },
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
});

it("can be cancelled from the confirmation without saving", async () => {
  const mock = api();
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp(`/batches/${ID}/settings`);
  await screen.findByRole("group", { name: "Shuffling" });
  await user.click(
    screen.getByRole("checkbox", { name: "Shuffle the answer options" }),
  );
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(patches(mock)).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Save settings" })).toHaveFocus();
});

it("validates the numbers and the pop-up fields before the confirmation", async () => {
  const mock = api();
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp(`/batches/${ID}/settings`);
  await screen.findByRole("group", { name: "Camera images" });

  await user.click(screen.getByRole("radio", { name: "Pause the exam" }));
  await user.clear(screen.getByLabelText(/Pause after this many flags/));
  await user.type(screen.getByLabelText(/Pause after this many flags/), "21");
  await user.clear(screen.getByLabelText(/Take a camera image every/));
  await user.type(screen.getByLabelText(/Take a camera image every/), "5");
  await user.click(
    screen.getByRole("checkbox", {
      name: "Ask the candidate for their details before the exam",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Save settings" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Enter a whole number from 1 to 20.");
  expect(alert).toHaveTextContent(
    "Enter a whole number of seconds from 10 to 120.",
  );
  expect(alert).toHaveTextContent(
    "Choose at least one field, or turn the pop-up off.",
  );
  expect(screen.getByLabelText(/Pause after this many flags/)).toBeInvalid();
  expect(screen.getByLabelText(/Take a camera image every/)).toBeInvalid();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(patches(mock)).toHaveLength(0);

  // Fixing them lets the save through; national ID numbers are not offered.
  await user.clear(screen.getByLabelText(/Pause after this many flags/));
  await user.type(screen.getByLabelText(/Pause after this many flags/), "20");
  await user.clear(screen.getByLabelText(/Take a camera image every/));
  await user.type(screen.getByLabelText(/Take a camera image every/), "120");
  await user.click(screen.getByRole("checkbox", { name: "Email address" }));
  await user.click(screen.getByRole("checkbox", { name: "Date of birth" }));
  expect(
    screen.queryByRole("checkbox", { name: /aadhaar|pan|voter|passport/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/never asked for/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Confirm and save",
    }),
  );
  await screen.findByText("Batch settings saved.");
  expect(JSON.parse(String((patches(mock)[0][1] as RequestInit).body))).toEqual(
    {
      flagPolicy: { action: "pause", pauseAfterFlags: 20 },
      imageCapture: { intervalSeconds: 120 },
      candidateInfoPopup: { enabled: true, fields: ["email", "dateOfBirth"] },
    },
  );
});

it("shows a server error inside the confirmation and keeps the choices", async () => {
  api(settings(), () =>
    jsonResponse(400, {
      error: { code: "VALIDATION_ERROR", message: "Request validation failed" },
    }),
  );
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp(`/batches/${ID}/settings`);
  await screen.findByRole("group", { name: "Location" });
  await user.click(
    screen.getByRole("checkbox", { name: "Capture the candidate's location" }),
  );
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm and save" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Request validation failed",
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Confirm and save" }),
    ).toBeEnabled(),
  );
});

it("links to the settings page from the batch page for aa_admin only", async () => {
  const { batchRecord, IDS } = await import("../../test/batchFixtures");
  const route = (u: URL) => {
    if (u.pathname.endsWith(`/batches/${IDS.batch}`))
      return jsonResponse(200, batchRecord());
    if (u.pathname.endsWith("/candidates"))
      return jsonResponse(200, { items: [] });
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  };
  stub(route);
  setSession(sessionFor("aa_admin"));
  const first = renderApp(`/batches/${IDS.batch}`);
  expect(
    await screen.findByRole("link", { name: "Batch settings" }),
  ).toHaveAttribute("href", `/batches/${IDS.batch}/settings`);
  first.unmount();

  setSession(sessionFor("tp"));
  renderApp(`/batches/${IDS.batch}`);
  await screen.findByText("Assessment language");
  expect(
    screen.queryByRole("link", { name: "Batch settings" }),
  ).not.toBeInTheDocument();
});

it("builds the patch, the validation and the change lines from plain functions", () => {
  const saved = settings({
    candidateInfoPopup: { enabled: true, fields: ["email"] },
  });
  const draft = toDraft(saved);
  expect(buildPatch(saved, draft)).toEqual({});
  expect(describeChanges(saved, draft)).toEqual([]);
  expect(validateDraft(draft)).toEqual({});
  expect(
    validateDraft({
      ...draft,
      pauseAfterFlags: "0",
      intervalSeconds: "abc",
      popupFields: [],
    }),
  ).toEqual({
    pauseAfterFlags: "Enter a whole number from 1 to 20.",
    intervalSeconds: "Enter a whole number of seconds from 10 to 120.",
    popupFields: "Choose at least one field, or turn the pop-up off.",
  });
  expect(
    buildPatch(saved, { ...draft, popupFields: ["gender", "email"] }),
  ).toEqual({
    candidateInfoPopup: { fields: ["email", "gender"] },
  });
});

it("sends the pause clock, marks timing and location viewer choices (X-12)", async () => {
  const mock = api();
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp(`/batches/${ID}/settings`);
  await screen.findByRole("group", { name: "Flags" });

  await user.click(
    screen.getByRole("checkbox", {
      name: "Give back the paused time when the exam is unlocked",
    }),
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: "Show marks only after the awarding body validates the result",
    }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Assessor of this batch" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Training partner of this batch" }),
  );
  await user.click(screen.getByRole("button", { name: "Save settings" }));

  const dialog = await screen.findByRole("dialog", {
    name: "Save batch settings?",
  });
  const lines = within(dialog)
    .getAllByRole("listitem")
    .map((li) => li.textContent);
  expect(lines).toEqual([
    "Marks only after the result is validated: On to Off",
    "Give back the paused time when unlocked: Off to On",
    "Who can see the location: AA admin, Assessor of this batch, Proctor of this batch",
  ]);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm and save" }),
  );
  await screen.findByText("Batch settings saved.");
  expect(JSON.parse(String((patches(mock)[0][1] as RequestInit).body))).toEqual(
    {
      marksAfterValidation: false,
      flagPolicy: { extendOnUnlock: true },
      locationVisibleTo: ["assessor", "proctor"],
    },
  );
});

it("sends the looking-away and talking switches (X-16)", async () => {
  api();
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp(`/batches/${ID}/settings`);
  await screen.findByRole("group", { name: "Behaviour checks" });
  expect(screen.getByRole("checkbox", { name: "Check for looking away" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Check for talking" })).toBeChecked();

  await user.click(screen.getByRole("checkbox", { name: "Check for talking" }));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  const dialog = await screen.findByRole("dialog", { name: "Save batch settings?" });
  expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "Detect voice: On to Off",
  ]);
});

it("shows the ThinkExam switches with a Yes/No word and saves a change (X-28)", async () => {
  const mock = api();
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${ID}/settings`);
  const user = userEvent.setup();

  for (const group of [
    "Proctoring",
    "Practical and viva",
    "Assessor",
    "Student",
    "More than one language",
    "On-the-job training",
  ]) {
    expect(await screen.findByRole("group", { name: group })).toBeInTheDocument();
  }
  // Every option of the reference screens is there, none for a national ID.
  for (const name of [
    "Proctoring by AI",
    "Download session video",
    "Download flag video",
    "Take pictures during the exam",
    "Allow practical test video",
    "Allow viva test video",
    "Allow assessor geolocation",
    "Allow assessor Annexure M",
    "Allow assessor feedback",
    "Allow student attendance",
    "Allow student feedback",
    "Design the theory test in more than one language",
    "Design the practical test in more than one language",
    "Design the viva test in more than one language",
    "Allow upload of OJT pictures",
  ]) {
    expect(screen.getByRole("checkbox", { name })).toBeInTheDocument();
  }
  expect(screen.queryByRole("checkbox", { name: /aadhaar|aadhar|uidai/i })).toBeNull();
  expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked();
  expect(screen.getByLabelText(/Flags allowed after an unlock/)).toHaveValue("3");
  // The video options wait for the exam video.
  expect(screen.getByRole("checkbox", { name: "Download session video" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Video" })).toBeDisabled();

  await user.click(screen.getByRole("radio", { name: "Manual" }));
  await user.click(screen.getByRole("checkbox", { name: "Allow student attendance" }));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm and save" }),
  );
  await waitFor(() => expect(patches(mock)).toHaveLength(1));
  expect(JSON.parse(String((patches(mock)[0][1] as RequestInit).body))).toEqual({
    proctoringType: "manual",
    studentAttendance: false,
  });
});
