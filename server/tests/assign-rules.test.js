import { compliance } from "../src/config/compliance.js";
import { AppError } from "../src/lib/errors.js";
import {
  assertLanguageOrOverride,
  assertMaxAas,
  assertRatioOrOverride,
  assertToaValid,
  civilDateRange,
  languageMatches,
  maxAasWouldExceed,
  ratioExceeded,
  sameCentreLowCandidateWarning,
  toaCoversRange,
} from "../src/modules/batches/assign-rules.js";

const validToa = {
  certNo: "TOA-1",
  issuedOn: "2026-01-01",
  expiresOn: "2028-12-31",
};

describe("assign rules", () => {
  it("enumerates inclusive civil dates", () => {
    expect(civilDateRange("2026-11-20", "2026-11-22")).toEqual([
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
  });

  it("blocks a missing or expired ToA and passes a covering one", () => {
    expect(toaCoversRange(null, "2026-11-20", "2026-11-21")).toBe(false);
    expect(toaCoversRange({ certNo: "X" }, "2026-11-20", "2026-11-21")).toBe(false);
    expect(
      toaCoversRange({ ...validToa, expiresOn: "2026-11-19" }, "2026-11-20", "2026-11-21"),
    ).toBe(false);
    expect(
      toaCoversRange({ ...validToa, issuedOn: "2026-11-21" }, "2026-11-20", "2026-11-21"),
    ).toBe(false);
    expect(toaCoversRange(validToa, "2026-11-20", "2026-11-21")).toBe(true);
    expect(() => assertToaValid(null, "2026-11-20", "2026-11-21")).toThrow(AppError);
    try {
      assertToaValid({ ...validToa, expiresOn: "2026-01-01" }, "2026-11-20", "2026-11-21");
    } catch (err) {
      expect(err.code).toBe("RULE_TOA_INVALID");
    }
    expect(() => assertToaValid(validToa, "2026-11-20", "2026-11-21")).not.toThrow();
  });

  it("blocks otherAaCount + 1 above the max unless already linked", () => {
    expect(maxAasWouldExceed({ otherAaCount: compliance.MAX_AAS_PER_ASSESSOR }, false)).toBe(true);
    expect(maxAasWouldExceed({ otherAaCount: compliance.MAX_AAS_PER_ASSESSOR - 1 }, false)).toBe(
      false,
    );
    expect(maxAasWouldExceed({ otherAaCount: compliance.MAX_AAS_PER_ASSESSOR }, true)).toBe(false);
    try {
      assertMaxAas({ otherAaCount: 4 }, false);
    } catch (err) {
      expect(err.code).toBe("RULE_MAX_AAS");
    }
    expect(() => assertMaxAas({ otherAaCount: 4 }, true)).not.toThrow();
  });

  it("skips ratio for other and blocks manufacturing over the cap without override", () => {
    expect(ratioExceeded("other", 400)).toBe(false);
    expect(ratioExceeded("manufacturing", compliance.RATIO_MAX_MANUFACTURING)).toBe(false);
    expect(ratioExceeded("manufacturing", compliance.RATIO_MAX_MANUFACTURING + 1)).toBe(true);
    expect(
      assertRatioOrOverride({
        ratioClass: "other",
        candidateCount: 400,
        user: { role: "aa_admin", _id: "u1" },
        now: new Date(),
      }),
    ).toBeNull();
    try {
      assertRatioOrOverride({
        ratioClass: "manufacturing",
        candidateCount: 26,
        user: { role: "aa_admin", _id: "u1" },
        now: new Date(),
      });
    } catch (err) {
      expect(err.code).toBe("RULE_RATIO");
    }
    const override = assertRatioOrOverride({
      ratioClass: "manufacturing",
      candidateCount: 26,
      user: { role: "aa_admin", _id: "u1" },
      overrideReason: "AB approved larger cohort",
      now: new Date("2026-10-11T00:00:00.000Z"),
    });
    expect(override.reason).toBe("AB approved larger cohort");
    expect(override.byUserId).toBe("u1");
  });

  it("matches languages trim and case-insensitive", () => {
    expect(languageMatches(["Hindi", "English"], "hindi")).toBe(true);
    expect(languageMatches(["  Hindi  "], "HINDI")).toBe(true);
    expect(languageMatches(["English"], "Hindi")).toBe(false);
    expect(() =>
      assertLanguageOrOverride({
        languages: ["English"],
        assessmentLanguage: "Hindi",
        user: { role: "aa_admin" },
      }),
    ).toThrow(AppError);
    expect(
      assertLanguageOrOverride({
        languages: ["English"],
        assessmentLanguage: "Hindi",
        user: { role: "aa_admin" },
        overrideReason: "Briefed by a Hindi speaker",
      }),
    ).toBe("Briefed by a Hindi speaker");
    expect(
      assertLanguageOrOverride({
        languages: ["Hindi"],
        assessmentLanguage: "Hindi",
        user: { role: "aa_admin" },
      }),
    ).toBeNull();
  });

  it("warns when either same-centre batch is under the candidate threshold", () => {
    const threshold = compliance.SAME_CENTRE_LOW_CANDIDATE_THRESHOLD;
    expect(sameCentreLowCandidateWarning([threshold, threshold])).toBeNull();
    const warning = sameCentreLowCandidateWarning([threshold - 1, threshold + 2]);
    expect(warning.code).toBe("SAME_CENTRE_LOW_CANDIDATES");
    expect(warning.details.threshold).toBe(threshold);
  });
});
