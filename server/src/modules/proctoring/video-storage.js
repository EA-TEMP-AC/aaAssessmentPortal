import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../config/env.js";

/**
 * X-27. Exam video pieces on the server disk (the human chose this on 2026-10-17; cloud storage
 * can replace it later behind the same three calls). Keys are `<sessionId>/<track>-<seq>.webm`,
 * made from checked ids only. Unlike the evidence vault this storage can delete: the video is
 * removed after its retention period.
 */
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const KEY = /^[a-f0-9]{24}\/(camera|screen)-\d{1,6}\.webm$/;

let overrideDir = null;
export function setVideoDirForTests(dir) {
  overrideDir = dir;
}

function root() {
  return path.resolve(
    overrideDir ??
      (env.EXAM_VIDEO_DIR ? env.EXAM_VIDEO_DIR : path.join(SERVER_ROOT, "var", "exam-video")),
  );
}

function resolveKey(key) {
  if (typeof key !== "string" || !KEY.test(key)) throw new Error("Invalid video key");
  return path.join(root(), key);
}

export const videoKey = (sessionId, track, seq) => `${sessionId}/${track}-${seq}.webm`;

export async function putVideo(key, bytes) {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { mode: 0o600 });
}

export async function readVideo(key) {
  return readFile(resolveKey(key));
}

export async function deleteVideo(key) {
  await rm(resolveKey(key), { force: true });
}
