import { namesForBatches } from "../../lib/display-names.js";
import { batchQueryFilter } from "../../middleware/scope.js";
import { Batch } from "../../models/batch.model.js";
import { LoginEvent } from "../../models/login-event.model.js";
import { User } from "../../models/user.model.js";
import { istCalendarDate } from "../../lib/working-days.js";

/**
 * X-49. Users log report and punch details in one place, built on loginEvents. Names are
 * personal data (the route logs the read). Exact coordinates and device ids are never returned:
 * only whether the place was captured.
 */
const PAGE_SIZE = 50;
const PUNCH_EVENT_CAP = 5000;

async function scopedBatchIds(user, { sector, batchId, examDate }) {
  const filter = { ...batchQueryFilter(user) };
  if (sector) filter.sector = sector;
  if (batchId) {
    if (filter._id) filter.$and = [{ _id: batchId }];
    else filter._id = batchId;
  }
  if (examDate) {
    filter.assessmentStartDate = { $lte: examDate };
    filter.assessmentEndDate = { $gte: examDate };
  }
  return Batch.distinct("_id", filter);
}

function eventFilter(batchIds, query) {
  const filter = { batchId: { $in: batchIds } };
  if (query.role) filter.actorType = query.role;
  if (query.userId) filter.userId = query.userId;
  if (query.type) filter.type = query.type;
  return filter;
}

async function userNames(events) {
  const ids = [...new Set(events.map((e) => String(e.userId)))];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } })
    .select("name")
    .lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

export async function loginHistory(user, query = {}) {
  const batchIds = await scopedBatchIds(user, query);
  const filter = eventFilter(batchIds, query);
  const page = query.page ?? 1;
  const [total, events] = await Promise.all([
    LoginEvent.countDocuments(filter),
    LoginEvent.find(filter)
      .sort({ capturedAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
  ]);
  const [names, batches] = await Promise.all([
    userNames(events),
    Batch.find({ _id: { $in: [...new Set(events.map((e) => String(e.batchId)))] } }).lean(),
  ]);
  const labels = await namesForBatches(batches);
  const batchOf = new Map(batches.map((b) => [String(b._id), b]));
  return {
    page,
    pageSize: PAGE_SIZE,
    total,
    items: events.map((e) => {
      const batch = batchOf.get(String(e.batchId));
      return {
        id: String(e._id),
        userId: String(e.userId),
        userName: names.get(String(e.userId)) ?? null,
        role: e.actorType,
        type: e.type,
        capturedAt: e.capturedAt.toISOString(),
        batchId: e.batchId ? String(e.batchId) : null,
        qualification: labels.get(String(e.batchId))?.qualificationName ?? null,
        sector: batch?.sector ?? null,
        platform: e.device?.platform ?? null,
        locationCaptured: e.locationStatus === "captured" && !e.noGpsFix,
        lateSync: e.lateSync,
      };
    }),
  };
}

/** One row per user and IST day: first login, last logout and the number of events. */
export async function punchDetails(user, query = {}) {
  const batchIds = await scopedBatchIds(user, query);
  const events = await LoginEvent.find(eventFilter(batchIds, query))
    .sort({ capturedAt: 1 })
    .limit(PUNCH_EVENT_CAP)
    .select("userId actorType type capturedAt batchId")
    .lean();
  const names = await userNames(events);
  const days = new Map();
  for (const e of events) {
    const date = istCalendarDate(e.capturedAt);
    const key = `${e.userId}|${e.batchId}|${date}`;
    const row = days.get(key) ?? {
      userId: String(e.userId),
      userName: names.get(String(e.userId)) ?? null,
      role: e.actorType,
      batchId: e.batchId ? String(e.batchId) : null,
      date,
      firstLogin: null,
      lastLogout: null,
      events: 0,
    };
    row.events += 1;
    const at = e.capturedAt.toISOString();
    if (e.type === "login" && !row.firstLogin) row.firstLogin = at;
    if (e.type === "logout") row.lastLogout = at;
    days.set(key, row);
  }
  const items = [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { truncated: events.length >= PUNCH_EVENT_CAP, items };
}
