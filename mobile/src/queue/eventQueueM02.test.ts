import { describe, expect, it } from "@jest/globals";
import { createEventQueue } from "./eventQueue";
import { MemoryStorage } from "../storage/memoryStorage";
import { newEvent } from "../testing/fixtures";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("offline queue for attendance and checklist", () => {
  it("enqueues attendance with a unique idempotent clientEventId and preserves records", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    const event = await queue.enqueue({
      type: "attendance",
      userId: "user-1",
      batchId: "66f000000000000000000001",
      capturedAt: "2026-11-20T05:00:00.000Z",
      records: [
        { candidateId: "cand-1", present: true, idVerified: true },
        { candidateId: "cand-2", present: false, note: "Absent" },
      ],
    });

    expect(event.clientEventId).toMatch(UUID_V4);
    expect(event.type).toBe("attendance");
    expect(event.status).toBe("pending");
    expect(event.records).toHaveLength(2);
    expect(event.records[0]?.present).toBe(true);

    // Verify persistence across reload
    const reloaded = await createEventQueue(storage).list<typeof event>();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.clientEventId).toBe(event.clientEventId);
    expect(reloaded[0]?.records[1]?.note).toBe("Absent");
  });

  it("enqueues equipment checklist with a unique clientEventId and completeAssessment flag", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    const event = await queue.enqueue({
      type: "checklist",
      userId: "user-1",
      batchId: "66f000000000000000000001",
      capturedAt: "2026-11-20T05:00:00.000Z",
      items: [
        { key: "cctv", label: "CCTV", available: true },
        { key: "biometric", label: "Biometric", available: false, note: "Defective" },
      ],
      completeAssessment: true,
    });

    expect(event.clientEventId).toMatch(UUID_V4);
    expect(event.type).toBe("checklist");
    expect(event.completeAssessment).toBe(true);
    expect(event.items).toHaveLength(2);

    const reloaded = await createEventQueue(storage).list<typeof event>();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.completeAssessment).toBe(true);
  });

  it("attaches batch id to queued events once the batch is downloaded", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    // Initial login event queued before any batch was downloaded (batchId: null)
    const loginEvt = await queue.enqueue(newEvent({ batchId: null, userId: "user-asr" }));
    expect(loginEvt.batchId).toBeNull();

    // Another event for a different user
    const otherEvt = await queue.enqueue(newEvent({ batchId: null, userId: "user-other" }));

    // Assessor downloads batch #66f000000000000000000099
    const updatedCount = await queue.attachBatchId("66f000000000000000000099", "user-asr");
    expect(updatedCount).toBe(1);

    const events = await queue.list();
    const updatedLogin = events.find((e) => e.clientEventId === loginEvt.clientEventId);
    const updatedOther = events.find((e) => e.clientEventId === otherEvt.clientEventId);

    expect(updatedLogin?.batchId).toBe("66f000000000000000000099");
    expect(updatedOther?.batchId).toBeNull(); // Other user's event not modified
  });

  it("surfaces conflicts in snapshot with clientEventId and operation type", async () => {
    const storage = new MemoryStorage();
    const queue = createEventQueue(storage);

    const chk = await queue.enqueue({
      type: "checklist",
      userId: "user-1",
      batchId: "batch-1",
      capturedAt: "2026-11-20T05:00:00.000Z",
      items: [{ key: "cctv", available: true }],
      completeAssessment: false,
    });

    await queue.update({
      ...chk,
      status: "conflict",
      conflict: {
        code: "CONFLICT_IDEMPOTENT",
        message: "Same clientEventId with a different payload",
      },
    });

    const snapshot = await queue.snapshot();
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0]).toEqual({
      clientEventId: chk.clientEventId,
      type: "checklist",
      message: "Same clientEventId with a different payload",
    });
  });
});
