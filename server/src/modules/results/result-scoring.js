import { compliance } from "../../config/compliance.js";
import { passMarkInvalid } from "../../lib/errors.js";
import { RUBRIC_LEVELS } from "../../config/batch-settings.js";
import { MARK_COMPONENTS } from "../master-data/pass-marks.js";

/**
 * Used when a qualification has no `passCriteriaMode`. Open question 19 has
 * not picked a default; NOS-wise is the stricter of the two.
 */
export const DEFAULT_PASS_CRITERIA_MODE = "nos_wise";

function isMark(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function unitOf(qualification) {
  return qualification.passMarkUnit ?? compliance.DEFAULT_PASS_MARK_UNIT;
}

/**
 * Highest mark a NOS component can take. docs/SCHEMA.md §3.7: the NOS
 * `maxMarks`, else the qualification `maxMarks`. A percent qualification with
 * neither is marked out of PASS_MARK_PERCENT_MAX, so the mark is the percent.
 * Null means no ceiling is known (absolute only). 0 means not assessed.
 */
export function componentCeiling(qualification, nos, component) {
  const own = nos.maxMarks?.[component];
  if (own != null) return own;
  const shared = qualification.maxMarks?.[component];
  if (shared != null) return shared;
  return unitOf(qualification) === "percent" ? compliance.PASS_MARK_PERCENT_MAX : null;
}

/**
 * Marks above the ceiling are `400 RESULT_PASS_MARK_INVALID`.
 * @param {object} qualification
 * @param {string} candidateId
 * @param {Array<{ nosId: string, theory?: number|null, practical?: number|null, viva?: number|null }>} nosMarks
 */
export function assertMarksWithinCeilings(qualification, candidateId, nosMarks) {
  const byId = new Map((qualification.nos ?? []).map((nos) => [nos.nosId, nos]));
  for (const entry of nosMarks) {
    const nos = byId.get(entry.nosId);
    if (!nos) continue;
    for (const component of MARK_COMPONENTS) {
      const mark = entry[component];
      if (!isMark(mark)) continue;
      const max = componentCeiling(qualification, nos, component);
      if (max != null && mark > max) {
        throw passMarkInvalid(`${component} marks for NOS ${entry.nosId} exceed the maximum`, {
          candidateId,
          nosId: entry.nosId,
          component,
          max,
        });
      }
    }
  }
}

/** Percent compares value/ceiling to the threshold; absolute compares the raw value. */
function meets(unit, value, ceiling, threshold) {
  if (unit === "percent") return value * 100 >= threshold * ceiling;
  return value >= threshold;
}

/**
 * Pass or Fail from marks. docs/SCHEMA.md §3.7 and §3.14.
 * `nos_wise`: every assessed component of every NOS meets `passMarks`.
 * `overall`: per component, the marks summed over the NOS meet `passMarks`
 * (percent: against the summed ceilings).
 * Null when a mark is still missing, so a draft row has no outcome yet.
 * @returns {"Pass"|"Fail"|null}
 */
export function outcomeFromMarks(qualification, nosMarks) {
  const unit = unitOf(qualification);
  const mode = qualification.passCriteriaMode ?? DEFAULT_PASS_CRITERIA_MODE;
  const byId = new Map(nosMarks.map((entry) => [entry.nosId, entry]));

  const totals = Object.fromEntries(MARK_COMPONENTS.map((component) => [component, null]));
  let everyNosPassed = true;

  for (const nos of qualification.nos ?? []) {
    for (const component of MARK_COMPONENTS) {
      const ceiling = componentCeiling(qualification, nos, component);
      if (ceiling === 0) continue;
      const mark = byId.get(nos.nosId)?.[component];
      if (!isMark(mark)) return null;
      const total = (totals[component] ??= { marks: 0, ceiling: 0 });
      total.marks += mark;
      total.ceiling += ceiling ?? 0;
      if (!meets(unit, mark, ceiling, qualification.passMarks[component])) everyNosPassed = false;
    }
  }

  const assessed = MARK_COMPONENTS.filter((component) => totals[component]);
  if (assessed.length === 0) return null;
  if (mode === "nos_wise") return everyNosPassed ? "Pass" : "Fail";

  const passed = assessed.every((component) =>
    meets(
      unit,
      totals[component].marks,
      totals[component].ceiling,
      qualification.passMarks[component],
    ),
  );
  return passed ? "Pass" : "Fail";
}

/**
 * X-29. The qualification as this batch judges it. With `passCriteria: "qualification"` nothing
 * changes. Otherwise one percentage applies to theory, practical and viva, per NOS or on the sums.
 */
export function withBatchPassRule(qualification, settings) {
  if (!settings || settings.passCriteria === "qualification") return qualification;
  const p = settings.passPercentage;
  return {
    ...qualification,
    passCriteriaMode: settings.passCriteria,
    passMarkUnit: "percent",
    passMarks: { theory: p, practical: p, viva: p },
  };
}

/**
 * X-29. With rubric marking a practical or viva mark must be one of the three levels of its ceiling
 * (100%, 70% or 10%). Needs a known ceiling; without one the mark cannot be checked and is left alone.
 */
export function assertRubricMarks(qualification, candidateId, nosMarks, settings) {
  const rubric = {
    practical: settings.practicalMarking === "rubric",
    viva: settings.vivaMarking === "rubric",
  };
  if (!rubric.practical && !rubric.viva) return;
  const byId = new Map((qualification.nos ?? []).map((nos) => [nos.nosId, nos]));
  for (const entry of nosMarks) {
    const nos = byId.get(entry.nosId);
    if (!nos) continue;
    for (const component of ["practical", "viva"]) {
      const mark = entry[component];
      if (!rubric[component] || !isMark(mark)) continue;
      const max = componentCeiling(qualification, nos, component);
      if (max == null) continue;
      const allowed = RUBRIC_LEVELS.map((level) => (max * level.percent) / 100);
      if (!allowed.some((value) => Math.abs(value - mark) < 1e-9)) {
        throw passMarkInvalid(
          `${component} marks for NOS ${entry.nosId} must be one of the rubric levels`,
          { candidateId, nosId: entry.nosId, component, allowed },
        );
      }
    }
  }
}
