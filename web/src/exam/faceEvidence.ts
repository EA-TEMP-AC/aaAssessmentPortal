import { createTransport } from "../proctoring/transport";
import type { FlagBody, ProctorTransport } from "../proctoring/types";
import type { FaceMatcher } from "../proctoring/face";

/**
 * What the camera check hands to the exam (P-09). Everything here lives in memory only, from the
 * camera check until the exam page uploads the two photos right after Start. Descriptors never
 * leave the matcher: they are not in this object, not uploaded and not logged.
 */
export type IdOutcome = "match" | "mismatch" | "unreadable";

export type FaceStart = {
  /** Holds the selfie reference. Null when there is no selfie (the by-hand fallback). */
  matcher: FaceMatcher | null;
  /** JPEG of the ID card still, or null when none was taken. */
  idJpeg: Blob | null;
  /** JPEG of the selfie, or null when none was taken. */
  selfieJpeg: Blob | null;
  idOutcome: IdOutcome;
  /** Rounded distance of the ID check, for the flag detail. Never a descriptor. */
  idDistance?: number;
};

export const FACE_EVIDENCE_NOTICE =
  "Some ID check photos could not be sent. You can carry on with the exam; a proctor will check by hand.";

function randomPart(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export type SubmitDeps = { transport?: ProctorTransport; now?: () => number };

/**
 * After the proctoring session exists: upload the ID card photo (id_proof) and the selfie
 * (proctor_snapshot), then post id_mismatch or id_unreadable with the ID photo's evidence id.
 * Never throws. Returns false when a photo or the flag could not be sent, so the page can show a
 * notice; the exam goes on either way.
 */
export async function submitFaceEvidence(
  face: FaceStart,
  ids: { sessionId: string; attemptId: string; batchId: string },
  deps: SubmitDeps = {},
): Promise<boolean> {
  const transport = deps.transport ?? createTransport();
  const now = deps.now ?? (() => Date.now());
  const capturedAt = () => new Date(now()).toISOString();
  const eventId = (prefix: string) => `${ids.attemptId.slice(0, 60)}-${prefix}-${randomPart()}`.slice(0, 200);
  let ok = true;

  async function upload(blob: Blob | null, kind: "id_proof" | "proctor_snapshot", prefix: string) {
    if (!blob) return null;
    try {
      const id = await transport.uploadSnapshot({
        batchId: ids.batchId,
        sessionId: ids.sessionId,
        clientEventId: eventId(prefix),
        capturedAt: capturedAt(),
        blob,
        kind,
      });
      if (!id) ok = false;
      return id;
    } catch {
      ok = false;
      return null;
    }
  }

  const idEvidenceId = await upload(face.idJpeg, "id_proof", "idc");
  await upload(face.selfieJpeg, "proctor_snapshot", "slf");

  if (face.idOutcome !== "match") {
    const type = face.idOutcome === "mismatch" ? "id_mismatch" : "id_unreadable";
    const body: FlagBody = {
      clientEventId: eventId("idf"),
      type,
      capturedAt: capturedAt(),
    };
    if (face.idOutcome === "mismatch") {
      // Same mapping the engine uses: label carries the distance in hundredths, count the samples.
      body.detail = {
        label: typeof face.idDistance === "number" ? `distance_${Math.round(face.idDistance * 100)}` : type,
        count: 1,
      };
    }
    if (idEvidenceId) body.evidenceId = idEvidenceId;
    try {
      await transport.sendFlag(ids.sessionId, body);
    } catch {
      ok = false;
    }
  }
  return ok;
}
