import { expect, it, vi } from "vitest";
import type { FlagBody, ProctorTransport, SnapshotUpload } from "../proctoring/types";
import { submitFaceEvidence, type FaceStart } from "./faceEvidence";

const IDS = { sessionId: "ps1", attemptId: "att1", batchId: "b1" };
const jpeg = (text: string) => new Blob([text], { type: "image/jpeg" });

function fakeTransport(options: { failUploads?: boolean; failFlag?: boolean } = {}) {
  const calls: string[] = [];
  const uploads: SnapshotUpload[] = [];
  const flags: FlagBody[] = [];
  const transport: ProctorTransport = {
    uploadSnapshot: vi.fn(async (input) => {
      calls.push(`upload:${input.kind ?? "proctor_snapshot"}`);
      uploads.push(input);
      return options.failUploads ? null : `ev-${uploads.length}`;
    }),
    sendFlag: vi.fn(async (_sessionId, body) => {
      calls.push(`flag:${body.type}`);
      if (options.failFlag) throw new Error("down");
      flags.push(body);
    }),
    dispose: vi.fn(),
  };
  return { transport, calls, uploads, flags };
}

const face = (over: Partial<FaceStart> = {}): FaceStart => ({
  matcher: null,
  idJpeg: jpeg("id"),
  selfieJpeg: jpeg("selfie"),
  idOutcome: "match",
  ...over,
});

it("uploads the ID card as id_proof, then the selfie as proctor_snapshot, then posts the mismatch flag", async () => {
  const t = fakeTransport();
  const ok = await submitFaceEvidence(face({ idOutcome: "mismatch", idDistance: 0.913 }), IDS, {
    transport: t.transport,
    now: () => Date.parse("2026-10-16T05:00:00.000Z"),
  });
  expect(ok).toBe(true);
  expect(t.calls).toEqual(["upload:id_proof", "upload:proctor_snapshot", "flag:id_mismatch"]);
  expect(t.uploads.map((u) => [u.kind, u.sessionId, u.batchId])).toEqual([
    ["id_proof", "ps1", "b1"],
    ["proctor_snapshot", "ps1", "b1"],
  ]);
  expect(new Set(t.uploads.map((u) => u.clientEventId)).size).toBe(2);
  expect(t.flags).toHaveLength(1);
  expect(t.flags[0]).toMatchObject({
    type: "id_mismatch",
    evidenceId: "ev-1",
    capturedAt: "2026-10-16T05:00:00.000Z",
    detail: { label: "distance_91", count: 1 },
  });
});

it("posts id_unreadable for the by-hand fallback, with the ID photo's evidence id", async () => {
  const t = fakeTransport();
  await submitFaceEvidence(face({ idOutcome: "unreadable" }), IDS, { transport: t.transport });
  expect(t.calls).toEqual(["upload:id_proof", "upload:proctor_snapshot", "flag:id_unreadable"]);
  expect(t.flags[0].evidenceId).toBe("ev-1");
  expect(t.flags[0].detail).toBeUndefined();
});

it("posts no flag for a match", async () => {
  const t = fakeTransport();
  expect(await submitFaceEvidence(face(), IDS, { transport: t.transport })).toBe(true);
  expect(t.calls).toEqual(["upload:id_proof", "upload:proctor_snapshot"]);
});

it("skips photos that were never taken", async () => {
  const t = fakeTransport();
  await submitFaceEvidence(face({ idJpeg: null, selfieJpeg: null, idOutcome: "unreadable" }), IDS, {
    transport: t.transport,
  });
  expect(t.calls).toEqual(["flag:id_unreadable"]);
  expect(t.flags[0].evidenceId).toBeUndefined();
});

it("still posts the flag when an upload fails, and says so without throwing", async () => {
  const t = fakeTransport({ failUploads: true });
  const ok = await submitFaceEvidence(face({ idOutcome: "mismatch" }), IDS, { transport: t.transport });
  expect(ok).toBe(false);
  expect(t.flags).toHaveLength(1);
  expect(t.flags[0].evidenceId).toBeUndefined();
});

it("does not throw when the flag cannot be posted or the transport throws", async () => {
  const t = fakeTransport({ failFlag: true });
  expect(await submitFaceEvidence(face({ idOutcome: "mismatch" }), IDS, { transport: t.transport })).toBe(false);
  const broken: ProctorTransport = {
    uploadSnapshot: vi.fn(async () => {
      throw new Error("boom");
    }),
    sendFlag: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  expect(await submitFaceEvidence(face(), IDS, { transport: broken })).toBe(false);
});
