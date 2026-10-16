/**
 * Mirrors server/src/lib/language.js: a batch says "English", a paper says "en". The server
 * decides on PUT /batches/:id/test-paper; this only keeps the picker from offering a paper
 * that would be refused.
 */
const LANGUAGES: Record<string, readonly string[]> = {
  en: ["english"],
  hi: ["hindi"],
  bn: ["bengali", "bangla"],
  ne: ["nepali"],
  ta: ["tamil"],
  te: ["telugu"],
  mr: ["marathi"],
  gu: ["gujarati"],
  kn: ["kannada"],
  ml: ["malayalam"],
  pa: ["punjabi", "panjabi"],
  or: ["odia", "oriya"],
  as: ["assamese"],
  ur: ["urdu"],
};

const KEY_BY_TEXT = new Map<string, string>();
for (const [code, names] of Object.entries(LANGUAGES)) {
  KEY_BY_TEXT.set(code, code);
  for (const name of names) KEY_BY_TEXT.set(name, code);
}

export function languageKey(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text) return "";
  return KEY_BY_TEXT.get(text) ?? KEY_BY_TEXT.get(text.split(/[-_]/)[0] ?? "") ?? text;
}

export function sameLanguage(a: string, b: string): boolean {
  const key = languageKey(a);
  return key !== "" && key === languageKey(b);
}
