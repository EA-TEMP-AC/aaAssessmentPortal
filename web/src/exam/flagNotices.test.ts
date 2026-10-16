import { describe, expect, it } from "vitest";
import { PROCTOR_FLAG_TYPES } from "../proctoring/types";
import { addNotice, dismissNotice, FLAG_NOTICE_TEXT, NO_NOTICES } from "./flagNotices";

describe("flag notices", () => {
  it("has one calm sentence for every flag type, with no suspicion words or severity", () => {
    for (const type of PROCTOR_FLAG_TYPES) {
      const text = FLAG_NOTICE_TEXT[type];
      expect(text, type).toBeTruthy();
      expect(text, type).not.toMatch(/cheat|suspic|violation|malpractice|severity|penal|report/i);
    }
  });

  it("queues different types one after another", () => {
    let s = addNotice(NO_NOTICES, "tab_hidden", 0, 15000);
    s = addNotice(s, "phone_detected", 100, 15000);
    expect(s.queue).toEqual(["tab_hidden", "phone_detected"]);
    s = dismissNotice(s);
    expect(s.queue).toEqual(["phone_detected"]);
  });

  it("merges repeats of one type while it waits and inside the cooldown", () => {
    let s = addNotice(NO_NOTICES, "tab_hidden", 0, 15000);
    expect(addNotice(s, "tab_hidden", 1000, 15000)).toBe(s);
    s = dismissNotice(s);
    expect(addNotice(s, "tab_hidden", 14_999, 15000)).toBe(s);
    expect(addNotice(s, "tab_hidden", 15_000, 15000).queue).toEqual(["tab_hidden"]);
  });
});
