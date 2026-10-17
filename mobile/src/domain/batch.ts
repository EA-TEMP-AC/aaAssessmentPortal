export type BatchType = "STT" | "LTT";
export type BatchMode = "offline" | "online" | "blended";

export type AssignedBatch = {
  id: string;
  type: BatchType;
  mode: BatchMode;
  status: string;
  statusVersion: number;
  assessmentStartDate: string;
  assessmentEndDate: string;
  assessmentLanguage: string;
  candidateCount: number;
  abId: string;
  tpId?: string;
  centreId?: string;
  qualificationId?: string;
  sector?: string;
  state?: string;
};

export type RosterCandidate = {
  id: string;
  batchId: string;
  learnerId: string;
  name: string;
  externalRef: string | null;
  active: boolean;
  accommodations?: string[];
  /** The student's sign-in id and first password, shown to the assessor on exam day (X-39). */
  login?: { loginId: string; initialPassword: string | null; mustChangePassword: boolean } | null;
};

export type AttendanceRecordState = {
  candidateId: string;
  present: boolean;
  idVerified?: boolean;
  note?: string;
  capturedAt?: string;
};

export type ChecklistItem = {
  key: string;
  label: string;
  available: boolean;
  note?: string;
};

export type CachedBatchData = {
  batch: AssignedBatch;
  roster: RosterCandidate[];
  downloadedAt: string;
  attendance: Record<string, AttendanceRecordState>;
  checklist: ChecklistItem[];
  assessmentCompleted: boolean;
};

export const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: "cctv", label: "CCTV recording setup", available: true },
  { key: "biometric", label: "Biometric authentication device", available: true },
  { key: "terminals", label: "Candidate exam terminals", available: true },
  { key: "internet", label: "High-speed internet connection", available: true },
  { key: "power-backup", label: "Power backup / UPS", available: true },
  { key: "first-aid", label: "First-aid & safety equipment", available: true },
];

/**
 * Checks if every active candidate on the roster has an attendance record marked (present: true or false).
 * Deactivated candidates are excluded from this requirement.
 */
export function isAttendanceComplete(
  roster: RosterCandidate[],
  attendance: Record<string, AttendanceRecordState>,
): boolean {
  const activeCandidates = roster.filter((c) => c.active);
  if (activeCandidates.length === 0) return true;
  return activeCandidates.every((c) => {
    const record = attendance[c.id];
    return record !== undefined && typeof record.present === "boolean";
  });
}

/**
 * Returns candidate IDs of active roster candidates who do not have an attendance record yet.
 */
export function missingAttendanceCandidateIds(
  roster: RosterCandidate[],
  attendance: Record<string, AttendanceRecordState>,
): string[] {
  return roster
    .filter((c) => c.active && (attendance[c.id] === undefined || typeof attendance[c.id]?.present !== "boolean"))
    .map((c) => c.id);
}
