import { describe, expect, it } from "vitest";
import { languageKey, sameLanguage } from "../src/lib/language.js";

describe("language matching", () => {
  it("treats a name and its code as the same language", () => {
    expect(sameLanguage("English", "en")).toBe(true);
    expect(sameLanguage("hindi", "HI")).toBe(true);
    expect(sameLanguage("en-IN", "English")).toBe(true);
  });
  it("keeps different languages apart", () => {
    expect(sameLanguage("English", "hi")).toBe(false);
    expect(sameLanguage("Nepali", "Hindi")).toBe(false);
  });
  it("falls back to plain text for unknown values and never matches empty values", () => {
    expect(sameLanguage("Lepcha", "lepcha")).toBe(true);
    expect(sameLanguage("", "")).toBe(false);
    expect(languageKey(null)).toBe("");
  });
});
