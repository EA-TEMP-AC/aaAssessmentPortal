import { apiRequest } from "./client";

/** X-25. Pictures used in the stem of a question. PNG or JPEG, at most 1 MB, at most 3 per question. */
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const IMAGES_PER_QUESTION = 3;
export const IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

export type QuestionImageRef = { imageId: string; alt: string };

/** Why a file cannot be used, or null when it can. Checked before anything is sent. */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return "Choose a PNG or JPEG picture.";
  if (file.size > IMAGE_MAX_BYTES) return "The picture is larger than 1 MB. Make it smaller and try again.";
  if (file.size === 0) return "The picture is empty.";
  return null;
}

export async function uploadQuestionImage(file: Blob, signal?: AbortSignal): Promise<string> {
  const body = await apiRequest<unknown>("/question-bank/images", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
    signal,
  });
  const id = typeof body === "object" && body !== null ? (body as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || id === "") throw new Error("The server did not accept the picture.");
  return id;
}

/** The picture as a blob. The page cannot put the sign-in in an <img> address, so it is fetched here. */
export async function fetchQuestionImage(imageId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await apiRequest<Response>(`/question-bank/images/${encodeURIComponent(imageId)}/file`, {
    raw: true,
    signal,
  });
  return response.blob();
}
