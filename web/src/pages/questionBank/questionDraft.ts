import type { QuestionImageRef } from "../../api/questionImages";
import type { Qualification } from "../../api/masterData";
import type {
  Difficulty,
  Question,
  QuestionOption,
  QuestionType,
  QuestionWrite,
} from "../../api/questionBank";

export const OPTION_KEYS = ["A", "B", "C", "D", "E", "F"] as const;

export type Draft = {
  qualificationId: string;
  nosId: string;
  pcId: string;
  type: QuestionType;
  language: string;
  difficulty: string;
  bloomLevel: string;
  stem: string;
  options: QuestionOption[];
  correctAnswer: string;
  marks: string;
  images: QuestionImageRef[];
};

export type Errors = Partial<Record<keyof Draft, string>>;

export function initialDraft(question: Question | null, qualifications: readonly Qualification[]): Draft {
  if (question) {
    return {
      qualificationId: question.qualificationId,
      nosId: question.nosId,
      pcId: question.pcId,
      type: question.type,
      language: question.language,
      difficulty: question.difficulty ?? "",
      bloomLevel: question.bloomLevel ?? "",
      stem: question.stem,
      options: question.options.map((option) => ({ ...option })),
      correctAnswer: question.correctAnswer ?? "",
      marks: String(question.marks),
      images: question.images.map((image) => ({ ...image })),
    };
  }
  return {
    qualificationId: qualifications.length === 1 ? (qualifications[0]?.id ?? "") : "",
    nosId: "",
    pcId: "",
    type: "mcq",
    language: "en",
    difficulty: "",
    bloomLevel: "",
    stem: "",
    options: [
      { key: "A", text: "" },
      { key: "B", text: "" },
    ],
    correctAnswer: "",
    marks: "1",
    images: [],
  };
}

export function validateDraft(draft: Draft): Errors {
  const errors: Errors = {};
  if (!draft.qualificationId) errors.qualificationId = "Choose a qualification.";
  if (!draft.nosId) errors.nosId = "Choose a NOS.";
  if (!draft.pcId) errors.pcId = "Choose a PC.";
  if (!draft.language.trim()) errors.language = "Enter the language, for example en.";
  if (!draft.stem.trim()) errors.stem = "Enter the question text.";
  const marks = Number(draft.marks);
  if (draft.marks.trim() === "" || !Number.isFinite(marks) || marks < 0.5) {
    errors.marks = "Marks must be 0.5 or more.";
  }
  if (draft.images.some((image) => !image.alt.trim())) {
    errors.images = "Describe every picture in words, for people who cannot see it.";
  }
  if (draft.type === "mcq") {
    const filled = draft.options.filter((option) => option.text.trim());
    if (filled.length < 2 || filled.length !== draft.options.length) {
      errors.options = "Give at least two options and fill in every option you add.";
    } else if (!draft.correctAnswer || !draft.options.some((option) => option.key === draft.correctAnswer)) {
      errors.correctAnswer = "Choose the correct option.";
    }
  }
  return errors;
}

export function buildWrite(draft: Draft): QuestionWrite {
  const mcq = draft.type === "mcq";
  return {
    qualificationId: draft.qualificationId,
    nosId: draft.nosId,
    pcId: draft.pcId,
    type: draft.type,
    language: draft.language.trim(),
    difficulty: draft.difficulty ? (draft.difficulty as Difficulty) : null,
    bloomLevel: draft.bloomLevel || null,
    stem: draft.stem.trim(),
    options: mcq ? draft.options.map((option) => ({ key: option.key, text: option.text.trim() })) : [],
    correctAnswer: mcq ? draft.correctAnswer : draft.correctAnswer.trim() || null,
    marks: Number(draft.marks),
    images: draft.images.map((image) => ({ imageId: image.imageId, alt: image.alt.trim() })),
  };
}

export const ORDER: Array<keyof Draft> = [
  "qualificationId",
  "nosId",
  "pcId",
  "language",
  "stem",
  "options",
  "correctAnswer",
  "marks",
  "images",
];

