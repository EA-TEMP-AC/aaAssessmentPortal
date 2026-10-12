import { describe, expect, it } from "@jest/globals";
import {
  type AssignedBatch,
  isAttendanceComplete,
  missingAttendanceCandidateIds,
  type RosterCandidate,
} from "../domain/batch";
import { MemoryStorage } from "./memoryStorage";
import { createBatchStore } from "./batchStore";

const sampleBatch: AssignedBatch = {
  id: "66f000000000000000000001",
  type: "STT",
  mode: "offline",
  status: "in_progress",
  statusVersion: 1,
  assessmentStartDate: "2026-11-20",
  assessmentEndDate: "2026-11-21",
  assessmentLanguage: "Hindi",
  candidateCount: 2,
  abId: "ab-001",
};

const sampleRoster: RosterCandidate[] = [
  {
    id: "cand-001",
    batchId: sampleBatch.id,
    learnerId: "lrn-001",
    name: "Asha Devi",
    externalRef: "R-1",
    active: true,
  },
  {
    id: "cand-002",
    batchId: sampleBatch.id,
    learnerId: "lrn-002",
    name: "Bala Kumar",
    externalRef: "R-2",
    active: true,
  },
  {
    id: "cand-003",
    batchId: sampleBatch.id,
    learnerId: "lrn-003",
    name: "Deactivated Student",
    externalRef: "R-3",
    active: false,
  },
];

describe("batchStore offline caching", () => {
  it("caches assigned batch and its roster for offline use", async () => {
    const storage = new MemoryStorage();
    const store = createBatchStore(storage);

    const cached = await store.saveBatch(sampleBatch, sampleRoster);
    expect(cached.batch.id).toBe(sampleBatch.id);
    expect(cached.roster).toHaveLength(3);
    expect(cached.downloadedAt).toBeDefined();

    // Re-instantiate from the same storage to verify persistence
    const reloadedStore = createBatchStore(storage);
    const retrieved = await reloadedStore.getBatch();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.batch.id).toBe(sampleBatch.id);
    expect(retrieved?.batch.assessmentLanguage).toBe("Hindi");
    expect(retrieved?.roster.map((c) => c.name)).toEqual([
      "Asha Devi",
      "Bala Kumar",
      "Deactivated Student",
    ]);
  });

  it("saves attendance offline and retrieves cached attendance records", async () => {
    const storage = new MemoryStorage();
    const store = createBatchStore(storage);
    await store.saveBatch(sampleBatch, sampleRoster);

    const updated = await store.saveAttendance(sampleBatch.id, [
      { candidateId: "cand-001", present: true, idVerified: true, note: "Verified with Aadhaar" },
      { candidateId: "cand-002", present: false, note: "Absent" },
    ]);

    expect(updated.attendance["cand-001"]?.present).toBe(true);
    expect(updated.attendance["cand-001"]?.idVerified).toBe(true);
    expect(updated.attendance["cand-002"]?.present).toBe(false);

    // Verify persisted across reload
    const reloaded = await createBatchStore(storage).getBatch(sampleBatch.id);
    expect(reloaded?.attendance["cand-001"]?.note).toBe("Verified with Aadhaar");
    expect(reloaded?.attendance["cand-002"]?.present).toBe(false);
  });

  it("saves equipment checklist and completes assessment status offline", async () => {
    const storage = new MemoryStorage();
    const store = createBatchStore(storage);
    await store.saveBatch(sampleBatch, sampleRoster);

    const updated = await store.saveChecklist(
      sampleBatch.id,
      [
        { key: "cctv", label: "CCTV Setup", available: true },
        { key: "biometric", label: "Biometric Scanner", available: false, note: "Battery issue" },
      ],
      true,
    );

    expect(updated.assessmentCompleted).toBe(true);
    expect(updated.batch.status).toBe("assessment_completed");
    expect(updated.checklist[1]?.available).toBe(false);
    expect(updated.checklist[1]?.note).toBe("Battery issue");
  });
});

describe("attendance completion gate validation", () => {
  it("blocks completion when active candidates are missing attendance", () => {
    const attendance = {
      "cand-001": { candidateId: "cand-001", present: true },
    };

    expect(isAttendanceComplete(sampleRoster, attendance)).toBe(false);
    expect(missingAttendanceCandidateIds(sampleRoster, attendance)).toEqual(["cand-002"]);
  });

  it("allows completion once every active candidate has attendance (ignoring inactive)", () => {
    const attendance = {
      "cand-001": { candidateId: "cand-001", present: true },
      "cand-002": { candidateId: "cand-002", present: false, note: "Unreported" },
    };

    // cand-003 is active: false, so it does not block completion
    expect(isAttendanceComplete(sampleRoster, attendance)).toBe(true);
    expect(missingAttendanceCandidateIds(sampleRoster, attendance)).toEqual([]);
  });

  it("allows completion on an empty roster", () => {
    expect(isAttendanceComplete([], {})).toBe(true);
    expect(missingAttendanceCandidateIds([], {})).toEqual([]);
  });
});
