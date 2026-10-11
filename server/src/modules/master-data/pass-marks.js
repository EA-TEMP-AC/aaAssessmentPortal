import { compliance } from "../../config/compliance.js";
import { passMarkInvalid } from "../../lib/errors.js";

/** Qualification and NOS mark components. NCVET:FR §F. docs/SCHEMA.md §3.7. */
export const MARK_COMPONENTS = Object.freeze(["theory", "practical", "viva"]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function problem(message, field) {
  return { message, details: { field } };
}

/**
 * Structural pass-mark rules for a qualification document.
 * Result scoring (B-05) compares awarded marks to these ceilings.
 * Returns null when the structure can be scored.
 *
 * Percent thresholds use PASS_MARK_MIN..PASS_MARK_PERCENT_MAX and are not
 * compared to raw maxMarks. Absolute thresholds need a ceiling on the same
 * object (qualification maxMarks, or every NOS maxMarks when that component
 * is null) and must not sit above that ceiling. A PC passMark is compared
 * only to that PC's maxMark.
 */
export function findPassMarkProblem(doc) {
  const unit = doc.passMarkUnit ?? compliance.DEFAULT_PASS_MARK_UNIT;
  const passMarks = doc.passMarks ?? {};
  const maxMarks = doc.maxMarks ?? null;
  const nos = Array.isArray(doc.nos) ? doc.nos : [];

  for (const component of MARK_COMPONENTS) {
    const passValue = passMarks[component];
    const label = `passMarks.${component}`;
    if (!finite(passValue) || passValue < compliance.PASS_MARK_MIN) {
      return problem(`${label} must be at least ${compliance.PASS_MARK_MIN}`, label);
    }
    if (unit === "percent" && passValue > compliance.PASS_MARK_PERCENT_MAX) {
      return problem(
        `${label} must be at most ${compliance.PASS_MARK_PERCENT_MAX} when passMarkUnit is percent`,
        label,
      );
    }

    const qualMax = maxMarks ? maxMarks[component] : null;
    if (qualMax != null) {
      if (!finite(qualMax) || qualMax < compliance.PASS_MARK_MIN) {
        return problem(
          `maxMarks.${component} must be at least ${compliance.PASS_MARK_MIN}`,
          `maxMarks.${component}`,
        );
      }
      if (unit === "absolute" && passValue > qualMax) {
        return problem(`${label} exceeds maxMarks.${component}`, label);
      }
    }

    if (unit === "absolute" && qualMax == null) {
      if (nos.length === 0) {
        return problem(`${label} needs maxMarks.${component} or a max mark on every NOS`, label);
      }
      for (const item of nos) {
        const nosMax = item.maxMarks ? item.maxMarks[component] : null;
        if (!finite(nosMax)) {
          return problem(
            `NOS ${item.code} is missing maxMarks.${component}`,
            `nos.${item.code}.maxMarks.${component}`,
          );
        }
      }
    }

    for (const item of nos) {
      if (!item.maxMarks || item.maxMarks[component] == null) continue;
      const nosMax = item.maxMarks[component];
      if (!finite(nosMax) || nosMax < compliance.PASS_MARK_MIN) {
        return problem(
          `NOS ${item.code} maxMarks.${component} must be at least ${compliance.PASS_MARK_MIN}`,
          `nos.${item.code}.maxMarks.${component}`,
        );
      }
    }
  }

  const requirePc = doc.pcPassMarksRequired === true;
  for (const item of nos) {
    for (const pc of item.pcs ?? []) {
      const field = `nos.${item.code}.pcs.${pc.code}.passMark`;
      if (requirePc && !finite(pc.passMark)) {
        return problem(`PC ${pc.code} requires passMark`, field);
      }
      if (pc.passMark != null && !finite(pc.passMark)) {
        return problem(`PC ${pc.code} passMark must be a number`, field);
      }
      if (finite(pc.passMark) && pc.passMark < compliance.PASS_MARK_MIN) {
        return problem(
          `PC ${pc.code} passMark must be at least ${compliance.PASS_MARK_MIN}`,
          field,
        );
      }
      if (
        unit === "percent" &&
        finite(pc.passMark) &&
        pc.passMark > compliance.PASS_MARK_PERCENT_MAX
      ) {
        return problem(
          `PC ${pc.code} passMark must be at most ${compliance.PASS_MARK_PERCENT_MAX} when passMarkUnit is percent`,
          field,
        );
      }
      if (pc.maxMark != null && (!finite(pc.maxMark) || pc.maxMark < compliance.PASS_MARK_MIN)) {
        return problem(
          `PC ${pc.code} maxMark must be at least ${compliance.PASS_MARK_MIN}`,
          `nos.${item.code}.pcs.${pc.code}.maxMark`,
        );
      }
      if (unit === "absolute" && finite(pc.passMark)) {
        if (!finite(pc.maxMark)) {
          return problem(`PC ${pc.code} needs maxMark when passMarkUnit is absolute`, field);
        }
        if (pc.passMark > pc.maxMark) {
          return problem(`PC ${pc.code} passMark exceeds maxMark`, field);
        }
      }
    }
  }

  return null;
}

export function assertQualificationPassMarks(doc) {
  const found = findPassMarkProblem(doc);
  if (found) throw passMarkInvalid(found.message, found.details);
}
