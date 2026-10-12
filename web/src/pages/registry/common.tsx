import { useState } from "react";

export const COMMON_LANGUAGES = [
  "English",
  "Hindi",
  "Assamese",
  "Bengali",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Marathi",
  "Odia",
  "Punjabi",
  "Tamil",
  "Telugu",
  "Urdu",
] as const;

export function LanguageSelector({
  selected,
  onChange,
  hasError,
}: {
  selected: string[];
  onChange: (languages: string[]) => void;
  hasError?: boolean;
}) {
  const [customLanguage, setCustomLanguage] = useState("");
  const [allOptions, setAllOptions] = useState<string[]>(() => {
    const set = new Set<string>(COMMON_LANGUAGES);
    for (const lang of selected) {
      if (lang) set.add(lang);
    }
    return Array.from(set);
  });

  const toggle = (lang: string) => {
    if (selected.includes(lang)) {
      onChange(selected.filter((item) => item !== lang));
    } else {
      onChange([...selected, lang]);
    }
  };

  const addCustom = () => {
    const trimmed = customLanguage.trim();
    if (!trimmed) return;
    if (!allOptions.includes(trimmed)) {
      setAllOptions((prev) => [...prev, trimmed]);
    }
    if (!selected.includes(trimmed)) {
      onChange([...selected, trimmed]);
    }
    setCustomLanguage("");
  };

  return (
    <fieldset className="field" aria-invalid={hasError || undefined}>
      <legend>Languages</legend>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(7.5rem, 1fr))",
          gap: "0.5rem",
          marginBottom: "0.5rem",
        }}
      >
        {allOptions.map((lang) => (
          <label key={lang} className="check-label" style={{ fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={selected.includes(lang)}
              onChange={() => toggle(lang)}
            />
            {lang}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          aria-label="Add custom language"
          placeholder="Add custom language"
          value={customLanguage}
          maxLength={80}
          onChange={(e) => setCustomLanguage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className="button-quiet" onClick={addCustom}>
          Add language
        </button>
      </div>
    </fieldset>
  );
}
