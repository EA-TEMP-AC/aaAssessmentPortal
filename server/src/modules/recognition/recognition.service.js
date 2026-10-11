import { RECOGNITION_KEY, AaRecognition } from "../../models/aa-recognition.model.js";
import { notFound, outsideRecognition } from "../../lib/errors.js";
import { istCalendarDate } from "../../lib/working-days.js";

function idOf(value) {
  return value.toString();
}

export function presentRecognition(doc) {
  return {
    id: idOf(doc._id),
    sectors: [...doc.sectors],
    panIndia: doc.panIndia,
    states: [...(doc.states ?? [])],
    startDate: doc.startDate,
    endDate: doc.endDate,
  };
}

/**
 * Misses against aaRecognition. docs/SCHEMA.md §4.3.
 * No row is `unconfigured` alone. Dates are today's IST civil date, inclusive.
 * @param {object|null} recognition
 * @param {{ sector: string, state: string, now: Date }} batch
 * @returns {string[]}
 */
export function recognitionFailures(recognition, { sector, state, now }) {
  if (!recognition) return ["unconfigured"];
  const checks = [];
  if (!recognition.sectors.includes(sector)) checks.push("sector");
  if (!recognition.panIndia && !recognition.states.includes(state)) checks.push("state");
  const today = istCalendarDate(now);
  if (today < recognition.startDate) checks.push("not_started");
  if (today > recognition.endDate) checks.push("expired");
  return checks;
}

/**
 * Null when the batch is inside recognition.
 * The override object when `aa_admin` supplies a reason for a miss.
 * Otherwise throws RULE_OUTSIDE_RECOGNITION. An `ab_reviewer` reason is ignored.
 */
export async function recognitionDecision({ sector, state, now, user, overrideReason }) {
  const recognition = await AaRecognition.findOne({ key: RECOGNITION_KEY }).lean();
  const checks = recognitionFailures(recognition, { sector, state, now });
  if (checks.length === 0) return null;
  const reason = typeof overrideReason === "string" ? overrideReason.trim() : "";
  if (user?.role === "aa_admin" && reason) {
    return { byUserId: user._id, reason, at: now, checks };
  }
  throw outsideRecognition(checks);
}

export async function getRecognition() {
  const doc = await AaRecognition.findOne({ key: RECOGNITION_KEY }).lean();
  if (!doc) throw notFound("Recognition is not configured");
  return presentRecognition(doc);
}

/**
 * Replace the singleton. Does not read or write batches.
 * @returns {Promise<{ before: object|null, recognition: object }>}
 */
export async function saveRecognition(body, user) {
  const existing = await AaRecognition.findOne({ key: RECOGNITION_KEY }).lean();
  const updated = await AaRecognition.findOneAndUpdate(
    { key: RECOGNITION_KEY },
    {
      $set: {
        key: RECOGNITION_KEY,
        sectors: body.sectors,
        panIndia: body.panIndia,
        states: body.states,
        startDate: body.startDate,
        endDate: body.endDate,
        updatedBy: user._id,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  return {
    before: existing ? presentRecognition(existing) : null,
    recognition: presentRecognition(updated),
  };
}
