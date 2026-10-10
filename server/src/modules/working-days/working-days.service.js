import { compliance } from "../../config/compliance.js";
import { duplicateResource, notFound } from "../../lib/errors.js";
import { Holiday } from "../../models/holiday.model.js";
import { WORKING_DAY_CONFIG_KEY, WorkingDayConfig } from "../../models/working-day-config.model.js";

/**
 * Admin reads and writes for weekends and holidays.
 * Changing either does not recompute stored batch acceptDueAt / assignDueAt / resultDueAt.
 * docs/SCHEMA.md §2.2.
 */

export async function getWorkingDayConfig() {
  const doc = await WorkingDayConfig.findOne({ key: WORKING_DAY_CONFIG_KEY }).lean();
  return presentConfig(doc);
}

export async function saveWorkingDayConfig(body, actor) {
  const previous = await WorkingDayConfig.findOne({ key: WORKING_DAY_CONFIG_KEY }).lean();
  const doc = await WorkingDayConfig.findOneAndUpdate(
    { key: WORKING_DAY_CONFIG_KEY },
    {
      $set: { weekendDays: body.weekendDays, updatedBy: actor._id },
      $setOnInsert: { key: WORKING_DAY_CONFIG_KEY },
    },
    { upsert: true, new: true },
  ).lean();

  return {
    before: previous ? presentConfig(previous) : undefined,
    config: presentConfig(doc),
  };
}

export async function listHolidays(query) {
  const filter = {};
  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }
  if (query.region) filter.region = query.region;

  const docs = await Holiday.find(filter).sort({ date: 1, name: 1 }).lean();
  return { items: docs.map(presentHoliday) };
}

export async function createHoliday(body, actor) {
  try {
    const doc = await Holiday.create({
      date: body.date,
      name: body.name,
      region: body.region ?? null,
      createdBy: actor._id,
    });
    return presentHoliday(doc);
  } catch (err) {
    if (err?.code === 11000) {
      throw duplicateResource("A holiday already exists for this date and region");
    }
    throw err;
  }
}

export async function deleteHoliday(id) {
  const doc = await Holiday.findByIdAndDelete(id).lean();
  if (!doc) throw notFound();
  return presentHoliday(doc);
}

function presentConfig(doc) {
  if (!doc) {
    return {
      weekendDays: [...compliance.WEEKEND_DAYS],
      timezone: compliance.TIMEZONE,
    };
  }
  return {
    id: doc._id.toString(),
    weekendDays: [...doc.weekendDays],
    timezone: compliance.TIMEZONE,
  };
}

function presentHoliday(doc) {
  return {
    id: doc._id.toString(),
    date: doc.date,
    name: doc.name,
    region: doc.region ?? null,
  };
}
