import type { BatchRecord, BatchStatus } from "../api/batches";

export const IDS = {
  batch: "66f0000000000000000000b1",
  ab: "66f0000000000000000000ab",
  qualification: "66f000000000000000000011",
  tp: "66f000000000000000000022",
  centre: "66f0000000000000000000c1",
  assessor: "66f0000000000000000000a1",
  assessor2: "66f0000000000000000000a2",
  proctor: "66f0000000000000000000d1",
};

export function batchRecord(overrides: Partial<BatchRecord> = {}): BatchRecord {
  const base: BatchRecord = {
    id: IDS.batch,
    abId: IDS.ab,
    qualificationId: IDS.qualification,
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId: IDS.tp,
    centreId: IDS.centre,
    schemeId: null,
    projectId: null,
    candidateCount: 24,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Hindi",
    state: "Maharashtra",
    learnerFeedback: null,
    recognitionOverride: null,
    status: "allocated",
    statusVersion: 1,
    assessorId: null,
    proctorId: null,
    resultId: null,
    rejectReason: null,
    cancelReason: null,
    isReassessment: false,
    reassessmentOf: null,
    firstAssessmentBatchId: IDS.batch,
    sla: {
      acceptDueAt: "2099-01-01T18:29:59.999Z",
      assignDueAt: "2099-01-08T18:29:59.999Z",
      resultDueAt: "2099-02-01T18:29:59.999Z",
      breached: [],
      lateActions: [],
    },
    ratioOverride: null,
    accommodations: [],
    allocatedAt: "2026-10-08T08:00:00.000Z",
    acceptedAt: null,
    assignedAt: null,
    cancelledAt: null,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T08:00:00.000Z",
  };
  const { sla: slaOverride, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    sla: {
      ...base.sla,
      ...slaOverride,
    },
  };
}

export function listBody(items: BatchRecord[], extra: { page?: number; pageSize?: number; total?: number } = {}) {
  return {
    page: extra.page ?? 1,
    pageSize: extra.pageSize ?? 20,
    total: extra.total ?? items.length,
    items,
  };
}

export function emptyMasterList() {
  return { page: 1, pageSize: 100, total: 0, items: [] };
}

export function assessorItem(id = IDS.assessor, name = "Asha Assessor") {
  return {
    id,
    name,
    code: "ASR-SAMPLE",
    email: "asha@example.com",
    qualifications: ["Electrician L4"],
    yearsOfExperience: 8,
    languages: ["Hindi", "English"],
    toa: { certNo: "TOA-1", issuedOn: "2025-01-01", expiresOn: "2027-01-01" },
    otherAaCount: 0,
    undertaking: true,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function proctorItem() {
  return {
    id: IDS.proctor,
    name: "Priya Proctor",
    code: "PRC-SAMPLE",
    email: "priya@example.com",
    qualifications: [],
    languages: ["Hindi"],
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export const ACTION_CASES: Array<{
  role: "aa_admin" | "mis" | "ab_reviewer" | "tp";
  status: BatchStatus;
  labels: readonly string[];
}> = [
  { role: "aa_admin", status: "allocated", labels: ["Accept", "Reject", "Cancel"] },
  { role: "aa_admin", status: "accepted", labels: ["Assign assessor", "Cancel"] },
  { role: "aa_admin", status: "assessor_assigned", labels: ["Reassign assessor", "Cancel"] },
  { role: "aa_admin", status: "in_progress", labels: ["Complete", "Cancel"] },
  { role: "aa_admin", status: "assessment_completed", labels: ["Cancel"] },
  { role: "aa_admin", status: "rejected", labels: [] },
  { role: "aa_admin", status: "published", labels: [] },
  { role: "mis", status: "allocated", labels: [] },
  { role: "ab_reviewer", status: "allocated", labels: [] },
  { role: "tp", status: "accepted", labels: [] },
];
