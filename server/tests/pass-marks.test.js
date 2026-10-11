import { compliance } from "../src/config/compliance.js";
import { AppError } from "../src/lib/errors.js";
import { assertQualificationPassMarks } from "../src/modules/master-data/pass-marks.js";

function qualification(overrides = {}) {
  return {
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    maxMarks: null,
    nos: [
      {
        nosId: "NOS-01",
        code: "N01",
        name: "Safety",
        maxMarks: { theory: null, practical: null, viva: null },
        pcs: [{ pcId: "PC-01", code: "P1", name: "PPE" }],
      },
    ],
    pcPassMarksRequired: false,
    ...overrides,
  };
}

function expectInvalid(doc) {
  try {
    assertQualificationPassMarks(doc);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("RESULT_PASS_MARK_INVALID");
    expect(err.details.field).toEqual(expect.any(String));
    return;
  }
  throw new Error("expected RESULT_PASS_MARK_INVALID");
}

describe("qualification pass marks", () => {
  it("accepts the percent contract example and a perfect score", () => {
    assertQualificationPassMarks(qualification());
    assertQualificationPassMarks(
      qualification({
        passMarks: {
          theory: compliance.PASS_MARK_PERCENT_MAX,
          practical: compliance.PASS_MARK_MIN,
          viva: compliance.PASS_MARK_PERCENT_MAX,
        },
      }),
    );
  });

  it("rejects percent pass marks outside the named bounds", () => {
    expectInvalid(
      qualification({
        passMarks: {
          theory: compliance.PASS_MARK_PERCENT_MAX + 0.01,
          practical: 50,
          viva: 50,
        },
      }),
    );
    expectInvalid(
      qualification({
        passMarks: { theory: compliance.PASS_MARK_MIN - 1, practical: 50, viva: 50 },
      }),
    );
  });

  it("does not compare a percent threshold to a raw max mark", () => {
    assertQualificationPassMarks(
      qualification({
        maxMarks: { theory: 10, practical: 10, viva: 10 },
      }),
    );
  });

  it("rejects an absolute threshold above the qualification ceiling", () => {
    expectInvalid(
      qualification({
        passMarkUnit: "absolute",
        passMarks: { theory: 80, practical: 10, viva: 10 },
        maxMarks: { theory: 50, practical: 50, viva: 50 },
      }),
    );
  });

  it("accepts absolute marks within the qualification ceiling", () => {
    assertQualificationPassMarks(
      qualification({
        passMarkUnit: "absolute",
        passMarks: { theory: 20, practical: 30, viva: 10 },
        maxMarks: { theory: 40, practical: 60, viva: 20 },
        pcPassMarksRequired: true,
        nos: [
          {
            nosId: "NOS-W1",
            code: "NW1",
            name: "Joints",
            maxMarks: { theory: 40, practical: 60, viva: 20 },
            pcs: [{ pcId: "PC-W1", code: "PW1", name: "Bead", passMark: 10, maxMark: 20 }],
          },
        ],
      }),
    );
  });

  it("requires a NOS ceiling when the qualification ceiling for that component is null", () => {
    expectInvalid(
      qualification({
        passMarkUnit: "absolute",
        passMarks: { theory: 10, practical: 10, viva: 10 },
        maxMarks: null,
      }),
    );
    expectInvalid(
      qualification({
        passMarkUnit: "absolute",
        passMarks: { theory: 10, practical: 10, viva: 10 },
        maxMarks: null,
        nos: [],
      }),
    );
    assertQualificationPassMarks(
      qualification({
        passMarkUnit: "absolute",
        passMarks: { theory: 40, practical: 40, viva: 40 },
        maxMarks: null,
        nos: [
          {
            nosId: "NOS-01",
            code: "N01",
            name: "Safety",
            maxMarks: { theory: 10, practical: 10, viva: 10 },
            pcs: [],
          },
        ],
      }),
    );
  });

  it("rejects PC pass marks that break the same rules", () => {
    expectInvalid(
      qualification({
        passMarkUnit: "absolute",
        passMarks: { theory: 10, practical: 10, viva: 10 },
        maxMarks: { theory: 20, practical: 20, viva: 20 },
        nos: [
          {
            nosId: "NOS-01",
            code: "N01",
            name: "Safety",
            pcs: [{ pcId: "PC-01", code: "P1", name: "PPE", passMark: 8, maxMark: 5 }],
          },
        ],
      }),
    );
    expectInvalid(
      qualification({
        passMarkUnit: "absolute",
        passMarks: { theory: 10, practical: 10, viva: 10 },
        maxMarks: { theory: 20, practical: 20, viva: 20 },
        nos: [
          {
            nosId: "NOS-01",
            code: "N01",
            name: "Safety",
            pcs: [{ pcId: "PC-01", code: "P1", name: "PPE", passMark: 8 }],
          },
        ],
      }),
    );
    expectInvalid(
      qualification({
        pcPassMarksRequired: true,
      }),
    );
    expectInvalid(
      qualification({
        nos: [
          {
            nosId: "NOS-01",
            code: "N01",
            name: "Safety",
            pcs: [{ pcId: "PC-01", code: "P1", name: "PPE", passMark: 150 }],
          },
        ],
      }),
    );
    assertQualificationPassMarks(
      qualification({
        nos: [
          {
            nosId: "NOS-01",
            code: "N01",
            name: "Safety",
            pcs: [{ pcId: "PC-01", code: "P1", name: "PPE", passMark: 40 }],
          },
        ],
      }),
    );
  });
});
