import { IDS } from "./batchFixtures";

export const QUAL = {
  id: IDS.qualification,
  code: "Q-ELEC-L4",
  name: "Electrician Level 4",
  sector: "Electronics",
  ratioClass: "manufacturing",
  defaultBatchType: "STT",
  passCriteriaMode: null,
  passMarkUnit: "percent",
  passMarks: { theory: 40, practical: 40, viva: 40 },
  maxMarks: null,
  pcPassMarksRequired: false,
  nos: [
    {
      nosId: "NOS-01",
      code: "N0101",
      name: "Wiring",
      pcs: [
        { pcId: "PC-01", code: "PC1.1", name: "Inspect", passMark: null, maxMark: null },
        { pcId: "PC-02", code: "PC1.2", name: "Repair", passMark: null, maxMark: null },
      ],
    },
    {
      nosId: "NOS-02",
      code: "N0102",
      name: "Safety",
      pcs: [{ pcId: "PC-03", code: "PC2.1", name: "Gear", passMark: null, maxMark: null }],
    },
  ],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const QUESTION_ID = "66f0000000000000000000e1";
export const PAPER_ID = "66f0000000000000000000f1";

export function questionDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: QUESTION_ID,
    qualificationId: IDS.qualification,
    nosId: "NOS-01",
    pcId: "PC-01",
    type: "mcq",
    language: "en",
    difficulty: "medium",
    bloomLevel: "apply",
    stem: "Which tool measures current?",
    options: [
      { key: "A", text: "Ammeter" },
      { key: "B", text: "Voltmeter" },
    ],
    correctAnswer: "A",
    marks: 2,
    status: "draft",
    version: 1,
    isLatest: true,
    ...overrides,
  };
}

export function questionPage(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, pageSize: 50, totalPages: 1, ...overrides };
}

export function qualificationList() {
  return { page: 1, pageSize: 100, total: 1, items: [QUAL] };
}

export function paperDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: PAPER_ID,
    name: "Electrician mock paper",
    qualificationId: IDS.qualification,
    status: "draft",
    seed: 77,
    rules: { language: "en", totalMarks: null, quotas: [{ nosId: "NOS-01", type: "mcq", count: 2 }] },
    totalMarks: 4,
    complete: true,
    shortages: [],
    durationMinutes: 60,
    items: [
      { questionId: QUESTION_ID, version: 1, nosId: "NOS-01", pcId: "PC-01", type: "mcq", marks: 2 },
      { questionId: "66f0000000000000000000e2", version: 1, nosId: "NOS-01", pcId: "PC-02", type: "mcq", marks: 2 },
    ],
    ...overrides,
  };
}
