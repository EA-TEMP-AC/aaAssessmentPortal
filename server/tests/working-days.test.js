import mongoose from "mongoose";
import { compliance } from "../src/config/compliance.js";
import { Holiday } from "../src/models/holiday.model.js";
import {
  WORKING_DAY_CONFIG_KEY,
  WorkingDayConfig,
} from "../src/models/working-day-config.model.js";
import {
  acceptDueAt,
  addWorkingDays,
  assignDueAt,
  isCalendarDate,
  isWorkingDay,
  loadWorkingCalendar,
  resultDueAt,
  subtractWorkingDays,
} from "../src/lib/working-days.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";

const satSun = { weekendDays: [6, 0], holidays: [] };

function iso(date) {
  return date.toISOString();
}

describe("compliance constants", () => {
  it("matches SCHEMA §2 names and values, plus pass-mark bounds", () => {
    expect(compliance).toEqual({
      TIMEZONE: "Asia/Kolkata",
      WEEKEND_DAYS: [6, 0],
      ACCEPT_REJECT_WORKING_DAYS: 2,
      ASSIGN_AFTER_ALLOCATION_WD_STT: 7,
      ASSIGN_BEFORE_EXAM_WD_LTT: 30,
      RESULT_SUBMIT_WD_STT: 3,
      RESULT_SUBMIT_WD_LTT: 5,
      RESULT_SLA_ANCHOR_STT: "assessment_end_date",
      RESULT_SLA_ANCHOR_LTT: "exam_date",
      BATCH_ALLOCATE_LEAD_DAYS_STT: 15,
      TOA_VALIDITY_YEARS: 3,
      MAX_AAS_PER_ASSESSOR: 4,
      SAME_CENTRE_LOW_CANDIDATE_THRESHOLD: 10,
      RATIO_MAX_MANUFACTURING: 25,
      RATIO_MAX_SERVICES: 35,
      RATIO_MAX_SCHOOL_EDUCATION: 60,
      RATIO_MAX_OTHER: null,
      REASSESS_WINDOW_YEARS: 1,
      EVIDENCE_REQUIRED_FOR_RESULT: false,
      ASSESSOR_REACHABLE_HOURS: 24,
      MAX_CLOCK_SKEW_MS: 300_000,
      OFFLINE_SESSION_MAX_MS: 259_200_000,
      ACCESS_TOKEN_TTL_MS: 900_000,
      REFRESH_TOKEN_TTL_MS: 2_592_000_000,
      LOGIN_RATE_LIMIT_WINDOW_MS: 900_000,
      LOGIN_RATE_LIMIT_MAX: 20,
      PUBLIC_RATE_LIMIT_WINDOW_MS: 60_000,
      PUBLIC_RATE_LIMIT_MAX: 120,
      DEFAULT_PASS_MARK_UNIT: "percent",
      PASS_MARK_MIN: 0,
      PASS_MARK_PERCENT_MAX: 100,
      SECTOR_MIN_COVERAGE_PERCENT: 5,
      ATTEMPT_DEFAULT_DURATION_MINUTES: 60,
      ATTEMPT_GRACE_SECONDS: 30,
      QUESTION_REVIEW_INTERVAL_MONTHS: 12,
      QUESTION_REVIEW_INTERVAL_MIN_MONTHS: 1,
      QUESTION_REVIEW_INTERVAL_MAX_MONTHS: 60,
      QUESTION_MIN_APPROVED_PER_PC: 5,
    });
    expect(Object.isFrozen(compliance)).toBe(true);
    expect(Object.isFrozen(compliance.WEEKEND_DAYS)).toBe(true);
  });
});

describe("working-day calculator", () => {
  it("matches the SCHEMA §2.1 worked examples", async () => {
    const tuesday = await addWorkingDays("2026-10-06", 2, satSun);
    expect(iso(tuesday)).toBe("2026-10-08T18:29:59.999Z");

    const tuesdayInstant = await addWorkingDays(new Date("2026-10-06T04:30:00.000Z"), 2, satSun);
    expect(iso(tuesdayInstant)).toBe("2026-10-08T18:29:59.999Z");

    const beforeExam = await subtractWorkingDays("2026-11-20", 7, satSun);
    expect(iso(beforeExam)).toBe("2026-11-11T18:29:59.999Z");
  });

  it("skips weekends", async () => {
    expect(await isWorkingDay("2026-10-10", satSun)).toBe(false);
    expect(await isWorkingDay("2026-10-11", satSun)).toBe(false);
    expect(await isWorkingDay("2026-10-12", satSun)).toBe(true);

    const thursday = await addWorkingDays("2026-10-08", 2, satSun);
    expect(iso(thursday)).toBe("2026-10-12T18:29:59.999Z");
  });

  it("skips holidays", async () => {
    const calendar = { weekendDays: [6, 0], holidays: ["2026-10-07"] };
    expect(await isWorkingDay("2026-10-07", calendar)).toBe(false);
    expect(iso(await addWorkingDays("2026-10-06", 2, calendar))).toBe("2026-10-09T18:29:59.999Z");

    const examHoliday = { weekendDays: [6, 0], holidays: ["2026-11-20"] };
    expect(iso(await subtractWorkingDays("2026-11-20", 7, examHoliday))).toBe(
      "2026-11-11T18:29:59.999Z",
    );

    const countedHoliday = { weekendDays: [6, 0], holidays: ["2026-11-11"] };
    expect(iso(await subtractWorkingDays("2026-11-20", 7, countedHoliday))).toBe(
      "2026-11-10T18:29:59.999Z",
    );
  });

  it("does not count a holiday on the anchor day", async () => {
    const calendar = { weekendDays: [6, 0], holidays: ["2026-10-06"] };
    expect(await isWorkingDay("2026-10-06", calendar)).toBe(false);
    expect(iso(await addWorkingDays("2026-10-06", 2, calendar))).toBe("2026-10-08T18:29:59.999Z");
    expect(iso(await acceptDueAt("2026-10-06", calendar))).toBe("2026-10-08T18:29:59.999Z");
  });

  it("Friday anchor skips the weekend", async () => {
    expect(iso(await addWorkingDays("2026-10-09", 1, satSun))).toBe("2026-10-12T18:29:59.999Z");
    expect(iso(await addWorkingDays("2026-10-09", 2, satSun))).toBe("2026-10-13T18:29:59.999Z");
  });

  it("uses the IST calendar date across midnight", async () => {
    const beforeMidnight = new Date("2026-10-06T18:29:59.999Z");
    const afterMidnight = new Date("2026-10-06T18:30:00.000Z");

    expect(iso(await addWorkingDays(beforeMidnight, 2, satSun))).toBe("2026-10-08T18:29:59.999Z");
    expect(iso(await addWorkingDays(afterMidnight, 2, satSun))).toBe("2026-10-09T18:29:59.999Z");
    expect(iso(await acceptDueAt(beforeMidnight, satSun))).toBe("2026-10-08T18:29:59.999Z");
    expect(iso(await acceptDueAt(afterMidnight, satSun))).toBe("2026-10-09T18:29:59.999Z");
    expect(iso(await assignDueAt({ type: "STT", allocatedAt: beforeMidnight }, satSun))).toBe(
      "2026-10-15T18:29:59.999Z",
    );
    expect(iso(await assignDueAt({ type: "STT", allocatedAt: afterMidnight }, satSun))).toBe(
      "2026-10-16T18:29:59.999Z",
    );
  });

  it("reads weekendDays from the calendar instead of a fixed Saturday-Sunday set", async () => {
    const fridayOff = { weekendDays: [5], holidays: [] };
    expect(await isWorkingDay("2026-10-09", fridayOff)).toBe(false);
    expect(await isWorkingDay("2026-10-10", fridayOff)).toBe(true);
    expect(iso(await addWorkingDays("2026-10-08", 1, fridayOff))).toBe("2026-10-10T18:29:59.999Z");
  });

  it("applies AA-wide holidays and regional holidays only for that region", async () => {
    const holidays = [
      { date: "2026-10-07", region: null },
      { date: "2026-10-08", region: "MH" },
    ];
    const aaWide = { weekendDays: [6, 0], holidays, region: null };
    const maharashtra = { weekendDays: [6, 0], holidays, region: "MH" };

    expect(iso(await addWorkingDays("2026-10-06", 2, aaWide))).toBe("2026-10-09T18:29:59.999Z");
    expect(iso(await addWorkingDays("2026-10-06", 2, maharashtra))).toBe(
      "2026-10-12T18:29:59.999Z",
    );
  });

  it("rejects a non-positive working-day count and an impossible civil date", async () => {
    await expect(addWorkingDays("2026-10-06", 0, satSun)).rejects.toThrow(/positive integer/);
    await expect(subtractWorkingDays("2026-11-20", 1.5, satSun)).rejects.toThrow(
      /positive integer/,
    );
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    await expect(addWorkingDays("2026-02-31", 1, satSun)).rejects.toThrow(/Invalid anchor date/);
  });
});

describe("SLA due helpers", () => {
  it("stores the contract STT and LTT assign and result examples", async () => {
    const allocatedAt = new Date("2026-10-08T08:00:00.000Z");
    const sttAssign = await assignDueAt({ type: "STT", allocatedAt }, satSun);
    const lttAssign = await assignDueAt({ type: "LTT", assessmentStartDate: "2026-11-20" }, satSun);
    expect(iso(sttAssign)).toBe("2026-10-19T18:29:59.999Z");
    expect(iso(lttAssign)).toBe("2026-10-09T18:29:59.999Z");

    const sttResult = await resultDueAt({ type: "STT", assessmentEndDate: "2026-11-21" }, satSun);
    const lttResult = await resultDueAt({ type: "LTT", assessmentStartDate: "2026-11-20" }, satSun);
    expect(iso(sttResult)).toBe("2026-11-25T18:29:59.999Z");
    expect(iso(lttResult)).toBe("2026-11-27T18:29:59.999Z");
    expect(compliance.RESULT_SLA_ANCHOR_STT).toBe("assessment_end_date");
    expect(compliance.RESULT_SLA_ANCHOR_LTT).toBe("exam_date");
    expect(compliance.ASSIGN_SLA_MODE).toBeUndefined();
    expect(compliance.RESULT_SLA_ANCHOR).toBeUndefined();
  });

  it("rejects a missing anchor or an unknown batch type", async () => {
    await expect(assignDueAt({ type: "STT" }, satSun)).rejects.toThrow(/allocatedAt/);
    await expect(
      assignDueAt({ type: "LTT", allocatedAt: new Date("2026-10-08T08:00:00.000Z") }, satSun),
    ).rejects.toThrow(/assessmentStartDate/);
    await expect(
      assignDueAt({ type: "RPL", assessmentStartDate: "2026-11-20" }, satSun),
    ).rejects.toThrow(/Unknown batch type/);
    await expect(
      resultDueAt({ type: "STT", assessmentStartDate: "2026-11-20" }, satSun),
    ).rejects.toThrow(/assessmentEndDate/);
    await expect(
      resultDueAt({ type: "LTT", assessmentEndDate: "2026-11-21" }, satSun),
    ).rejects.toThrow(/assessmentStartDate/);
    await expect(
      resultDueAt({ type: "RPL", assessmentEndDate: "2026-11-21" }, satSun),
    ).rejects.toThrow(/Unknown batch type/);
  });
});

describe("working calendar stored in MongoDB", () => {
  beforeAll(async () => {
    await startMongo();
    await Holiday.init();
    await WorkingDayConfig.init();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("uses WEEKEND_DAYS and AA-wide holidays when computing a due instant", async () => {
    const allocatedAt = new Date("2026-10-06T04:30:00.000Z");
    expect(iso(await acceptDueAt(allocatedAt))).toBe("2026-10-08T18:29:59.999Z");

    await Holiday.create({
      date: "2026-10-07",
      name: "Midweek",
      region: null,
      createdBy: new mongoose.Types.ObjectId(),
    });

    expect(iso(await acceptDueAt(allocatedAt))).toBe("2026-10-09T18:29:59.999Z");
    expect(await isWorkingDay("2026-10-07")).toBe(false);
    expect(iso(await subtractWorkingDays("2026-10-08", 1))).toBe("2026-10-06T18:29:59.999Z");
  });

  it("reads weekend days from workingDayConfig", async () => {
    await WorkingDayConfig.create({
      key: WORKING_DAY_CONFIG_KEY,
      weekendDays: [5],
    });

    const allocatedAt = new Date("2026-10-08T04:30:00.000Z");
    expect(iso(await acceptDueAt(allocatedAt))).toBe("2026-10-11T18:29:59.999Z");
    expect(await isWorkingDay("2026-10-09")).toBe(false);
    expect(await isWorkingDay("2026-10-10")).toBe(true);

    const calendar = await loadWorkingCalendar();
    expect(calendar.weekendDays).toEqual([5]);
    expect(calendar.region).toBeNull();
  });

  it("keeps a regional holiday out of the AA-wide calendar", async () => {
    await Holiday.create({
      date: "2026-10-07",
      name: "State day",
      region: "MH",
      createdBy: new mongoose.Types.ObjectId(),
    });

    const allocatedAt = new Date("2026-10-06T04:30:00.000Z");
    expect(iso(await acceptDueAt(allocatedAt))).toBe("2026-10-08T18:29:59.999Z");

    const maharashtra = await loadWorkingCalendar({ region: "MH" });
    expect(iso(await acceptDueAt(allocatedAt, maharashtra))).toBe("2026-10-09T18:29:59.999Z");
  });
});
