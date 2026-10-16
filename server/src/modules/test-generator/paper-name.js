export const PAPER_NAME_MAX = 80;

/** The name a paper gets when none is given: the qualification name and the language. */
export function defaultPaperName(qualificationName, language) {
  const base = String(qualificationName ?? "").trim() || "Test paper";
  const lang = String(language ?? "").trim();
  const name = lang ? `${base} (${lang})` : base;
  return name.length > PAPER_NAME_MAX ? name.slice(0, PAPER_NAME_MAX).trim() : name;
}
