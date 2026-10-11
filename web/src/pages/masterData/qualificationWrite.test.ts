import { expect, it } from "vitest";
import {
  blankNos,
  blankPc,
  buildQualification,
  emptyQualificationDraft,
  type QualificationDraft,
} from "./qualificationWrite";

function draft(overrides: Partial<QualificationDraft> = {}): QualificationDraft {
  return {
    ...emptyQualificationDraft(),
    code: "Q-ELEC-L4",
    name: "Electrician L4",
    sector: "manufacturing",
    passMarks: { theory: "50", practical: "50", viva: "50" },
    ...overrides,
  };
}

function marks(theory: string, practical = theory, viva = theory) {
  return { theory, practical, viva };
}

it("accepts a percent qualification without comparing pass marks to max marks", () => {
  const result = buildQualification(draft({ maxMarks: marks("10", "", "") }), "create");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.body.passMarkUnit).toBe("percent");
  expect(result.body.maxMarks).toEqual({ theory: 10, practical: null, viva: null });
  expect(result.body.defaultBatchType).toBeUndefined();
  expect(result.body.passCriteriaMode).toBeUndefined();
});

it("rejects a percent pass mark above 100 and a negative mark", () => {
  const high = buildQualification(draft({ passMarks: marks("101", "50", "50") }), "create");
  expect(high.ok).toBe(false);
  if (!high.ok) {
    expect(high.message).toContain("passMarks.theory must be at most 100");
    expect(high.fields).toEqual(["passMarks.theory"]);
  }

  const low = buildQualification(draft({ passMarks: marks("-1", "0", "0") }), "create");
  expect(low.ok).toBe(false);
  if (!low.ok) expect(low.message).toContain("passMarks.theory must be at least 0");
});

it("checks absolute ceilings on the qualification, and requires a NOS ceiling when that max is blank", () => {
  const within = buildQualification(
    draft({ passMarkUnit: "absolute", passMarks: marks("40"), maxMarks: marks("50") }),
    "create",
  );
  expect(within.ok).toBe(true);

  const above = buildQualification(
    draft({ passMarkUnit: "absolute", passMarks: marks("80"), maxMarks: marks("50") }),
    "create",
  );
  expect(above.ok).toBe(false);
  if (!above.ok) expect(above.message).toContain("passMarks.theory exceeds maxMarks.theory");

  const missing = buildQualification(draft({ passMarkUnit: "absolute", passMarks: marks("40") }), "create");
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.message).toContain("needs maxMarks.theory or a max mark on every NOS");

  const nosCeiling = buildQualification(
    draft({
      passMarkUnit: "absolute",
      passMarks: marks("200"),
      nos: [{ ...blankNos("n1"), nosId: "NOS-01", code: "N01", name: "Safety", maxMarks: marks("100") }],
    }),
    "create",
  );
  expect(nosCeiling.ok).toBe(true);
});

it("compares a performance criterion pass mark only with that criterion max mark", () => {
  const nos = {
    ...blankNos("n1"),
    nosId: "NOS-01",
    code: "N01",
    name: "Safety",
    pcs: [{ ...blankPc("p1"), pcId: "PC-01", code: "P1", name: "PPE", passMark: "10", maxMark: "5" }],
  };
  const above = buildQualification(
    draft({ passMarkUnit: "absolute", passMarks: marks("40"), maxMarks: marks("50"), nos: [nos] }),
    "create",
  );
  expect(above.ok).toBe(false);
  if (!above.ok) {
    expect(above.message).toContain("PC P1 passMark exceeds maxMark");
    expect(above.fields).toEqual(["nos.0.pcs.0.passMark"]);
  }

  const required = buildQualification(
    draft({
      pcPassMarksRequired: true,
      nos: [
        {
          ...blankNos("n1"),
          nosId: "NOS-01",
          code: "N01",
          name: "Safety",
          pcs: [{ ...blankPc("p1"), pcId: "PC-01", code: "P1", name: "PPE", passMark: "", maxMark: "" }],
        },
      ],
    }),
    "create",
  );
  expect(required.ok).toBe(false);
  if (!required.ok) expect(required.message).toContain("PC P1 requires passMark");
});

it("rejects duplicate NOS and performance criterion identifiers", () => {
  const result = buildQualification(
    draft({
      nos: [
        { ...blankNos("a"), nosId: "NOS-01", code: "N01", name: "Safety" },
        { ...blankNos("b"), nosId: "NOS-01", code: "N02", name: "Tools" },
      ],
    }),
    "create",
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain("nosId values must be unique");
});

it("clears optional qualification fields on edit and omits them on create", () => {
  const created = buildQualification(draft(), "create");
  expect(created.ok).toBe(true);
  if (created.ok) expect(created.body.maxMarks).toBeUndefined();

  const edited = buildQualification(draft(), "edit");
  expect(edited.ok).toBe(true);
  if (!edited.ok) return;
  expect(edited.body.maxMarks).toBeNull();
  expect(edited.body.defaultBatchType).toBeNull();
  expect(edited.body.passCriteriaMode).toBeNull();
});
