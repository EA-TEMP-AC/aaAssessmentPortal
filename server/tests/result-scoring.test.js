import {
  assertMarksWithinCeilings,
  componentCeiling,
  outcomeFromMarks,
  assertRubricMarks,
  withBatchPassRule,
} from "../src/modules/results/result-scoring.js";

const nos = (nosId, maxMarks) => ({ nosId, code: nosId, name: nosId, maxMarks, pcs: [] });

function qualification(overrides = {}) {
  return {
    passMarkUnit: "percent",
    passCriteriaMode: "nos_wise",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    maxMarks: null,
    nos: [nos("NOS-01"), nos("NOS-02")],
    ...overrides,
  };
}

const marks = (nosId, theory, practical, viva) => ({ nosId, theory, practical, viva });

describe("result scoring", () => {
  it("picks the NOS ceiling, then the qualification ceiling, then 100 for percent", () => {
    const q = qualification({ maxMarks: { theory: 80, practical: null, viva: null } });
    const own = nos("NOS-01", { theory: 40, practical: null, viva: null });
    expect(componentCeiling(q, own, "theory")).toBe(40);
    expect(componentCeiling(q, nos("NOS-02"), "theory")).toBe(80);
    expect(componentCeiling(q, nos("NOS-02"), "viva")).toBe(100);
    expect(componentCeiling({ ...q, passMarkUnit: "absolute" }, nos("NOS-02"), "viva")).toBeNull();
  });

  it("percent, NOS-wise: every component of every NOS must reach the pass mark", () => {
    const q = qualification();
    expect(outcomeFromMarks(q, [marks("NOS-01", 50, 80, 75), marks("NOS-02", 60, 60, 60)])).toBe(
      "Pass",
    );
    expect(outcomeFromMarks(q, [marks("NOS-01", 49.5, 80, 75), marks("NOS-02", 90, 90, 90)])).toBe(
      "Fail",
    );
  });

  it("percent uses the ceiling when one is set", () => {
    const q = qualification({
      nos: [nos("NOS-01", { theory: 40, practical: 20, viva: 10 })],
    });
    expect(outcomeFromMarks(q, [marks("NOS-01", 20, 10, 5)])).toBe("Pass");
    expect(outcomeFromMarks(q, [marks("NOS-01", 19, 10, 5)])).toBe("Fail");
  });

  it("overall sums each component across the NOS", () => {
    const q = qualification({ passCriteriaMode: "overall" });
    // Theory 30 + 70 = 100 of 200 → 50%. NOS-wise this row fails.
    const row = [marks("NOS-01", 30, 60, 60), marks("NOS-02", 70, 60, 60)];
    expect(outcomeFromMarks(q, row)).toBe("Pass");
    expect(outcomeFromMarks({ ...q, passCriteriaMode: "nos_wise" }, row)).toBe("Fail");
    expect(outcomeFromMarks(q, [marks("NOS-01", 30, 60, 60), marks("NOS-02", 69, 60, 60)])).toBe(
      "Fail",
    );
  });

  it("absolute compares raw marks to the pass mark", () => {
    const q = qualification({
      passMarkUnit: "absolute",
      passMarks: { theory: 20, practical: 15, viva: 5 },
      maxMarks: { theory: 40, practical: 30, viva: 10 },
      nos: [nos("NOS-01")],
    });
    expect(outcomeFromMarks(q, [marks("NOS-01", 20, 15, 5)])).toBe("Pass");
    expect(outcomeFromMarks(q, [marks("NOS-01", 20, 14, 5)])).toBe("Fail");
  });

  it("has no outcome while a mark is missing, and skips a component with ceiling 0", () => {
    const q = qualification();
    expect(outcomeFromMarks(q, [marks("NOS-01", 70, 70, 70)])).toBeNull();
    expect(
      outcomeFromMarks(q, [marks("NOS-01", 70, null, 70), marks("NOS-02", 70, 70, 70)]),
    ).toBeNull();
    expect(outcomeFromMarks(qualification({ nos: [] }), [])).toBeNull();

    const noViva = qualification({
      nos: [nos("NOS-01", { theory: null, practical: null, viva: 0 })],
    });
    expect(outcomeFromMarks(noViva, [{ nosId: "NOS-01", theory: 70, practical: 70 }])).toBe("Pass");
  });

  it("rejects a mark above the ceiling", () => {
    const q = qualification({ nos: [nos("NOS-01", { theory: 40, practical: null, viva: null })] });
    expect(() => assertMarksWithinCeilings(q, "k1", [marks("NOS-01", 40, 100, 100)])).not.toThrow();
    try {
      assertMarksWithinCeilings(q, "k1", [marks("NOS-01", 41, 100, 100)]);
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe("RESULT_PASS_MARK_INVALID");
      expect(err.details).toEqual({
        candidateId: "k1",
        nosId: "NOS-01",
        component: "theory",
        max: 40,
      });
    }
    expect(() => assertMarksWithinCeilings(q, "k1", [marks("NOS-01", 10, 101, 10)])).toThrow();
  });
});

describe("batch pass rule and rubric marking (X-29)", () => {
  const defaults = {
    passCriteria: "qualification",
    passPercentage: 50,
    practicalMarking: "marks",
    vivaMarking: "marks",
  };

  it("leaves the qualification alone unless the batch has its own rule", () => {
    const q = qualification();
    expect(withBatchPassRule(q, defaults)).toBe(q);
  });

  it("judges by the batch percentage, NOS-wise or overall, for all three components", () => {
    const q = qualification({ passMarks: { theory: 90, practical: 90, viva: 90 } });
    const rows = [marks("NOS-01", 70, 70, 70), marks("NOS-02", 40, 40, 40)];
    expect(outcomeFromMarks(q, rows)).toBe("Fail");
    const overall = withBatchPassRule(q, {
      ...defaults,
      passCriteria: "overall",
      passPercentage: 55,
    });
    expect(overall.passMarks).toEqual({ theory: 55, practical: 55, viva: 55 });
    expect(outcomeFromMarks(overall, rows)).toBe("Pass");
    const nosWise = withBatchPassRule(q, {
      ...defaults,
      passCriteria: "nos_wise",
      passPercentage: 55,
    });
    expect(outcomeFromMarks(nosWise, rows)).toBe("Fail");
    expect(q.passMarks.theory).toBe(90);
  });

  it("accepts only the three rubric levels when the batch marks practical or viva by rubric", () => {
    const q = qualification();
    const rubric = { ...defaults, practicalMarking: "rubric", vivaMarking: "rubric" };
    expect(() =>
      assertRubricMarks(
        q,
        "c1",
        [marks("NOS-01", 33, 100, 70), marks("NOS-02", 99, 10, 10)],
        rubric,
      ),
    ).not.toThrow();
    expect(() => assertRubricMarks(q, "c1", [marks("NOS-01", 50, 69, 70)], rubric)).toThrow(
      /rubric levels/,
    );
    expect(() => assertRubricMarks(q, "c1", [marks("NOS-01", 50, 100, 71)], rubric)).toThrow(
      /rubric levels/,
    );
    // Theory is never a rubric; typed marks stay free when the batch marks by number.
    expect(() => assertRubricMarks(q, "c1", [marks("NOS-01", 51, 69, 71)], defaults)).not.toThrow();
    const ofTwenty = qualification({
      nos: [nos("NOS-01", { theory: 10, practical: 20, viva: 10 })],
    });
    expect(() =>
      assertRubricMarks(ofTwenty, "c1", [marks("NOS-01", 5, 14, 7)], rubric),
    ).not.toThrow();
    expect(() => assertRubricMarks(ofTwenty, "c1", [marks("NOS-01", 5, 15, 7)], rubric)).toThrow();
  });
});
