import {
  applyWatermark,
  assertWatermarked,
  buildWatermark,
  isWatermarked,
} from "../src/lib/watermark.js";

const user = { _id: "66f0a1b2c3d4e5f607182930", role: "sme", name: "Asha", email: "a@aa.example" };
const at = new Date("2026-10-15T20:30:05.000Z"); // 2026-10-16 02:00:05 IST

describe("watermark helper (S-02)", () => {
  it("holds the user id, role and timestamp, with the time shown in IST", () => {
    const mark = buildWatermark(user, at);
    expect(mark.userId).toBe("66f0a1b2c3d4e5f607182930");
    expect(mark.role).toBe("sme");
    expect(mark.timestamp).toBe("2026-10-15T20:30:05.000Z");
    expect(mark.text).toContain("66f0a1b2c3d4e5f607182930");
    expect(mark.text).toContain("sme");
    expect(mark.text).toContain("2026-10-16 02:00:05 IST");
  });

  it("accepts an `id` property and ObjectId-like ids", () => {
    const objectIdLike = { toString: () => "66f0a1b2c3d4e5f607182931" };
    expect(buildWatermark({ id: objectIdLike, role: "aa_admin" }, at).userId).toBe(
      "66f0a1b2c3d4e5f607182931",
    );
  });

  it("never carries a name, email or phone", () => {
    const mark = buildWatermark({ ...user, phone: "9876543210" }, at);
    const text = JSON.stringify(mark);
    expect(Object.keys(mark).sort()).toEqual(["role", "text", "timestamp", "userId"]);
    expect(text).not.toContain("Asha");
    expect(text).not.toContain("a@aa.example");
    expect(text).not.toContain("9876543210");
  });

  it("defaults the time to now", () => {
    const before = Date.now();
    const mark = buildWatermark(user);
    expect(Date.parse(mark.timestamp)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(mark.timestamp)).toBeLessThanOrEqual(Date.now());
  });

  it("refuses a missing id, a missing role and a bad time", () => {
    expect(() => buildWatermark({ role: "sme" }, at)).toThrow(/user id/);
    expect(() => buildWatermark(undefined, at)).toThrow(/user id/);
    expect(() => buildWatermark({ _id: "x" }, at)).toThrow(/role/);
    expect(() => buildWatermark(user, new Date("nope"))).toThrow(/time/);
    expect(() => buildWatermark(user, "2026-10-15")).toThrow(/time/);
  });

  it("applyWatermark wraps the content untouched and marks it", () => {
    const content = { questions: [{ id: "q1" }] };
    const wrapped = applyWatermark(content, user, { at });
    expect(wrapped.content).toBe(content);
    expect(wrapped.watermark).toEqual(buildWatermark(user, at));
    expect(isWatermarked(wrapped)).toBe(true);
    expect(() => assertWatermarked(wrapped)).not.toThrow();
  });

  it("does not leak the marker when the wrapper is serialised", () => {
    const wrapped = applyWatermark({ a: 1 }, user, { at });
    expect(Object.keys(wrapped)).toEqual(["watermark", "content"]);
    expect(JSON.parse(JSON.stringify(wrapped))).toEqual({
      watermark: buildWatermark(user, at),
      content: { a: 1 },
    });
  });

  it("a look-alike object is not accepted as watermarked", () => {
    const forged = { watermark: buildWatermark(user, at), content: { a: 1 } };
    expect(isWatermarked(forged)).toBe(false);
    expect(isWatermarked(JSON.parse(JSON.stringify(applyWatermark({ a: 1 }, user))))).toBe(false);
    expect(isWatermarked(null)).toBe(false);
    expect(isWatermarked({ content: 1 })).toBe(false);
    expect(() => assertWatermarked(forged)).toThrow(/watermarked/);
    expect(() => assertWatermarked({ content: 1 })).toThrow(/watermarked/);
  });
});
