import { compliance } from "../../config/compliance.js";
import { ruleAssessorLanguage, ruleMaxAas, ruleRatio, ruleToaInvalid } from "../../lib/errors.js";

const RATIO_MAX_BY_CLASS = Object.freeze({
  manufacturing: compliance.RATIO_MAX_MANUFACTURING,
  services: compliance.RATIO_MAX_SERVICES,
  school_education: compliance.RATIO_MAX_SCHOOL_EDUCATION,
  other: compliance.RATIO_MAX_OTHER,
});

/**
 * Inclusive YYYY-MM-DD range. Dates are civil strings, not instants.
 * @param {string} start
 * @param {string} end
 * @returns {string[]}
 */
export function civilDateRange(start, end) {
  const dates = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addOneCivilDay(current);
  }
  return dates;
}

export function addOneCivilDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + 1));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * ToA must exist and cover every civil date in [start, end].
 * NCVET:FR §D. Missing or expired → RULE_TOA_INVALID.
 * @param {{ certNo?: string, issuedOn?: string, expiresOn?: string }|null|undefined} toa
 * @param {string} start
 * @param {string} end
 */
export function toaCoversRange(toa, start, end) {
  if (!toa?.certNo || !toa.issuedOn || !toa.expiresOn) return false;
  return toa.issuedOn <= start && toa.expiresOn >= end;
}

export function assertToaValid(toa, start, end) {
  if (!toaCoversRange(toa, start, end)) throw ruleToaInvalid();
}

/**
 * otherAaCount + 1 may not exceed MAX_AAS_PER_ASSESSOR unless this AA
 * already has the assessor on another live batch.
 * NCVET:FR §D.
 * @param {{ otherAaCount: number }} assessor
 * @param {boolean} alreadyLinked
 */
export function maxAasWouldExceed(assessor, alreadyLinked) {
  if (alreadyLinked) return false;
  return assessor.otherAaCount + 1 > compliance.MAX_AAS_PER_ASSESSOR;
}

export function assertMaxAas(assessor, alreadyLinked) {
  if (maxAasWouldExceed(assessor, alreadyLinked)) throw ruleMaxAas();
}

/**
 * Ratio uses ratioClass, never sector. `other` skips the rule.
 * @param {string} ratioClass
 * @param {number} candidateCount
 */
export function ratioLimit(ratioClass) {
  return RATIO_MAX_BY_CLASS[ratioClass] ?? null;
}

export function ratioExceeded(ratioClass, candidateCount) {
  const max = ratioLimit(ratioClass);
  if (max == null) return false;
  return candidateCount > max;
}

export function assertRatioOrOverride({ ratioClass, candidateCount, user, overrideReason, now }) {
  if (!ratioExceeded(ratioClass, candidateCount)) return null;
  const reason = typeof overrideReason === "string" ? overrideReason.trim() : "";
  if (user?.role === "aa_admin" && reason) {
    return { byUserId: user._id, reason, at: now };
  }
  throw ruleRatio("Candidate count exceeds the assessor ratio", {
    ratioClass,
    candidateCount,
    max: ratioLimit(ratioClass),
  });
}

export function languageMatches(languages, assessmentLanguage) {
  const needed = String(assessmentLanguage ?? "")
    .trim()
    .toLowerCase();
  if (!needed) return false;
  return (languages ?? []).some((item) => String(item).trim().toLowerCase() === needed);
}

export function assertLanguageOrOverride({ languages, assessmentLanguage, user, overrideReason }) {
  if (languageMatches(languages, assessmentLanguage)) return null;
  const reason = typeof overrideReason === "string" ? overrideReason.trim() : "";
  if (user?.role === "aa_admin" && reason) {
    return reason;
  }
  throw ruleAssessorLanguage();
}

/**
 * Non-blocking same-centre warning. Annexure IX(a) Assessment Delivery 9.
 * @param {number[]} candidateCounts
 */
export function sameCentreLowCandidateWarning(candidateCounts) {
  const threshold = compliance.SAME_CENTRE_LOW_CANDIDATE_THRESHOLD;
  if (!candidateCounts.some((count) => count < threshold)) return null;
  return {
    code: "SAME_CENTRE_LOW_CANDIDATES",
    message: `Same assessor has another batch at this centre on an overlapping day with fewer than ${threshold} candidates`,
    details: {
      threshold,
      candidateCounts,
    },
  };
}
