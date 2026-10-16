/**
 * Language names and ISO codes are both used as free text (batch assessmentLanguage is
 * "English", a test paper language is "en"). This maps the common ones to one key so the
 * two compare equal. Unknown values fall back to a trimmed, lower-cased text comparison.
 */
const LANGUAGES = {
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

const KEY_BY_TEXT = new Map();
for (const [code, names] of Object.entries(LANGUAGES)) {
  KEY_BY_TEXT.set(code, code);
  for (const name of names) KEY_BY_TEXT.set(name, code);
}

export function languageKey(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return "";
  return KEY_BY_TEXT.get(text) ?? KEY_BY_TEXT.get(text.split(/[-_]/)[0]) ?? text;
}

export function sameLanguage(a, b) {
  const keyA = languageKey(a);
  return keyA !== "" && keyA === languageKey(b);
}
