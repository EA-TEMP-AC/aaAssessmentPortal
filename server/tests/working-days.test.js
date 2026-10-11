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
      ASSIGN_BEFORE_EXAM_WD_STT: 7,
      ASSIGN_BEFORE_EXAM_WD_LTT: 30,
      ASSIGN_FROM_ACCEPTANCE_WD_STT: 7,
      ASSIGN_FROM_ACCEPTANCE_WD_LTT: 30,
      ASSIGN_SLA_MODE: "before_exam",
      RESULT_SUBMIT_WD_STT: 3,
      RESULT_SUBMIT_WD_LTT: 5,
      RESULT_SLA_ANCHOR: "assessment_end_date",
      BATCH_ALLOCATE_LEAD_DAYS_STT: 15,
      TOA_VALIDITY_YEARS: 3,
      MAX_AAS_PER_ASSESSOR: 4,
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
      DEFAULT_PASS_MARK_UNIT: "percent",
      PASS_MARK_MIN: 0,
      PASS_MARK_PERCENT_MAX: 100,
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
    expect(
      iso(
        await resultDueAt(
          {
            type: "STT",
            anchor: "assessment_completed",
            assessmentCompletedAt: afterMidnight,
          },
          satSun,
        ),
      ),
    ).toBe("2026-10-12T18:29:59.999Z");
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
  it("assignDueAt respects both ASSIGN_SLA_MODE values", async () => {
    const beforeExam = await assignDueAt(
      { type: "STT", mode: "before_exam", assessmentStartDate: "2026-11-20" },
      satSun,
    );
    expect(iso(beforeExam)).toBe("2026-11-11T18:29:59.999Z");

    const beforeExamLong = await assignDueAt(
      { type: "LTT", mode: "before_exam", assessmentStartDate: "2026-11-20" },
      satSun,
    );
    expect(iso(beforeExamLong)).toBe("2026-10-09T18:29:59.999Z");

    const fromAcceptance = await assignDueAt(
      {
        type: "STT",
        mode: "from_acceptance",
        acceptedAt: new Date("2026-10-06T04:30:00.000Z"),
      },
      satSun,
    );
    expect(iso(fromAcceptance)).toBe("2026-10-15T18:29:59.999Z");

    const fromAcceptanceLong = await assignDueAt(
      { type: "LTT", mode: "from_acceptance", acceptedAt: "2026-10-06" },
      satSun,
    );
    expect(iso(fromAcceptanceLong)).toBe("2026-11-17T18:29:59.999Z");

    const defaultMode = await assignDueAt(
      { type: "STT", assessmentStartDate: "2026-11-20" },
      satSun,
    );
    expect(iso(defaultMode)).toBe(iso(beforeExam));
    expect(compliance.ASSIGN_SLA_MODE).toBe("before_exam");

    await expect(assignDueAt({ type: "STT", mode: "before_exam" }, satSun)).rejects.toThrow(
      /assessmentStartDate/,
    );
    await expect(assignDueAt({ type: "STT", mode: "from_acceptance" }, satSun)).rejects.toThrow(
      /acceptedAt/,
    );
    await expect(
      assignDueAt({ type: "STT", mode: "after_alloc", assessmentStartDate: "2026-11-20" }, satSun),
    ).rejects.toThrow(/ASSIGN_SLA_MODE/);
  });

  it("resultDueAt respects RESULT_SLA_ANCHOR values", async () => {
    const fromEnd = await resultDueAt(
      { type: "STT", anchor: "assessment_end_date", assessmentEndDate: "2026-10-08" },
      satSun,
    );
    expect(iso(fromEnd)).toBe("2026-10-13T18:29:59.999Z");

    const fromEndLong = await resultDueAt(
      { type: "LTT", anchor: "assessment_end_date", assessmentEndDate: "2026-10-08" },
      satSun,
    );
    expect(iso(fromEndLong)).toBe("2026-10-15T18:29:59.999Z");

    const fromStart = await resultDueAt(
      { type: "STT", anchor: "assessment_start_date", assessmentStartDate: "2026-10-06" },
      satSun,
    );
    expect(iso(fromStart)).toBe("2026-10-09T18:29:59.999Z");

    const fromCompleted = await resultDueAt(
      {
        type: "STT",
        anchor: "assessment_completed",
        assessmentCompletedAt: new Date("2026-10-09T06:30:00.000Z"),
      },
      satSun,
    );
    expect(iso(fromCompleted)).toBe("2026-10-14T18:29:59.999Z");

    const defaultAnchor = await resultDueAt(
      { type: "STT", assessmentEndDate: "2026-10-08" },
      satSun,
    );
    expect(iso(defaultAnchor)).toBe(iso(fromEnd));
    expect(compliance.RESULT_SLA_ANCHOR).toBe("assessment_end_date");

    await expect(
      resultDueAt({ type: "STT", anchor: "published", assessmentEndDate: "2026-10-08" }, satSun),
    ).rejects.toThrow(/RESULT_SLA_ANCHOR/);
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
