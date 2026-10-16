import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { attempt, ATTEMPT_ID, BATCH_ID, callsTo, fakeStream, stubFetch, url } from "../test/examFixtures";
import { FakeFaceMatcher } from "../proctoring/face";
import { ExamScreen } from "./ExamScreen";
import type { FaceStart } from "./faceEvidence";
import { installProctorEngine, type ProctorEngine } from "./proctorBridge";

const SESSION = {
  id: "ps1",
  status: "active",
  config: { snapshotIntervalSeconds: 60, detectionIntervalMs: 800, flagCooldownSeconds: 20, sustainedSeconds: {} },
};

afterEach(() => {
  installProctorEngine(null);
});

function fakeEngine() {
  const engine: ProctorEngine = {
    start: vi.fn(async (o) => o.onStatus({ state: "running" })),
    stop: vi.fn(),
  };
  installProctorEngine(() => engine);
  return engine;
}

async function faceStart(over: Partial<Omit<FaceStart, "matcher">> = {}) {
  const matcher = new FakeFaceMatcher();
  await matcher.setReference({} as ImageBitmap);
  return {
    matcher,
    idJpeg: new Blob(["id"], { type: "image/jpeg" }),
    selfieJpeg: new Blob(["selfie"], { type: "image/jpeg" }),
    idOutcome: "mismatch" as FaceStart["idOutcome"],
    idDistance: 0.8,
    ...over,
  };
}

function server(options: { uploadFails?: boolean } = {}) {
  let uploads = 0;
  return stubFetch((u, init) => {
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/proctoring/sessions") && method === "POST") return jsonResponse(201, SESSION);
    if (u.pathname.endsWith(`/batches/${BATCH_ID}/evidence`) && method === "POST") {
      if (options.uploadFails) return jsonResponse(500, { error: { code: "SERVER_ERROR", message: "down" } });
      uploads += 1;
      return jsonResponse(201, { id: `ev${uploads}` });
    }
    if (u.pathname.endsWith("/flags") && method === "POST") return jsonResponse(201, { id: "f1" });
    if (u.pathname.endsWith("/heartbeat")) return jsonResponse(204);
    if (u.pathname.endsWith("/warnings")) return jsonResponse(200, { items: [] });
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });
}

function order(mock: ReturnType<typeof stubFetch>): string[] {
  return mock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === "POST")
    .map((call) => {
      const path = url(call[0] as string).pathname;
      const body = (call[1] as RequestInit).body;
      if (body instanceof FormData) return `${path.split("/").pop()}:${String(body.get("kind"))}`;
      return path.split("/").slice(-2).join("/");
    });
}

it("uploads the ID card and selfie after the session exists, then posts the flag, and starts the engine with the matcher", async () => {
  const engine = fakeEngine();
  const mock = server();
  const face = await faceStart();
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} face={face} onFinished={() => {}} />);

  await waitFor(() => expect(callsTo(mock, "/ps1/flags", "POST")).toHaveLength(1));
  expect(order(mock).filter((x) => /evidence|sessions|flags/.test(x))).toEqual([
    "proctoring/sessions",
    "evidence:id_proof",
    "evidence:proctor_snapshot",
    "ps1/flags",
  ]);
  const flag = JSON.parse((callsTo(mock, "/ps1/flags", "POST")[0][1] as RequestInit).body as string);
  expect(flag).toMatchObject({ type: "id_mismatch", evidenceId: "ev1", detail: { label: "distance_80", count: 1 } });
  const form = (callsTo(mock, `/batches/${BATCH_ID}/evidence`, "POST")[0][1] as RequestInit).body as FormData;
  expect(form.get("sessionId")).toBe("ps1");
  expect(engine.start).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "ps1", attemptId: ATTEMPT_ID, faceMatcher: face.matcher }),
  );
  expect(screen.queryByText("Proctoring unavailable.")).not.toBeInTheDocument();
});

it("sends no flag for a match but still uploads both photos", async () => {
  fakeEngine();
  const mock = server();
  render(
    <ExamScreen
      attempt={attempt()}
      stream={fakeStream().stream}
      face={await faceStart({ idOutcome: "match" })}
      onFinished={() => {}}
    />,
  );
  await waitFor(() => expect(callsTo(mock, `/batches/${BATCH_ID}/evidence`, "POST")).toHaveLength(2));
  expect(callsTo(mock, "/ps1/flags", "POST")).toHaveLength(0);
});

it("keeps the exam going with the unavailable notice when the photos cannot be uploaded", async () => {
  const engine = fakeEngine();
  const mock = server({ uploadFails: true });
  render(
    <ExamScreen
      attempt={attempt()}
      stream={fakeStream().stream}
      face={await faceStart({ idOutcome: "unreadable" })}
      onFinished={() => {}}
    />,
  );
  expect(await screen.findByText("Proctoring unavailable.")).toBeInTheDocument();
  expect(screen.getByText(/ID check photos could not be sent/)).toBeInTheDocument();
  expect(engine.start).toHaveBeenCalled();
  expect(screen.getByRole("radio", { name: /Pliers/ })).toBeEnabled();
  // The flag is still posted, without an evidence id.
  await waitFor(() => expect(callsTo(mock, "/ps1/flags", "POST").length).toBeGreaterThan(0));
  const flag = JSON.parse((callsTo(mock, "/ps1/flags", "POST")[0][1] as RequestInit).body as string);
  expect(flag).toMatchObject({ type: "id_unreadable" });
  expect(flag.evidenceId).toBeUndefined();
});

it("wipes the selfie reference when no session can be created", async () => {
  const engine = fakeEngine();
  stubFetch(() => jsonResponse(503, { error: { code: "UNAVAILABLE", message: "Down" } }));
  const face = await faceStart();
  render(<ExamScreen attempt={attempt()} stream={fakeStream().stream} face={face} onFinished={() => {}} />);
  expect(await screen.findByText("Proctoring unavailable.")).toBeInTheDocument();
  expect(engine.start).not.toHaveBeenCalled();
  expect(face.matcher.calls).toContain("clear");
});
