import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const MB = 1024 * 1024;

/** V-01 limits. Images and PDFs 25 MB, video 200 MB. */
export const EVIDENCE_MAX_BYTES = Object.freeze({
  "image/jpeg": 25 * MB,
  "image/png": 25 * MB,
  "application/pdf": 25 * MB,
  "video/mp4": 200 * MB,
});
export const EVIDENCE_ABSOLUTE_MAX_BYTES = 200 * MB;

export const EVIDENCE_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
});

// ISO base media brands that mean MP4. QuickTime, HEIC and AVIF share the container and are refused.
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "dash",
  "M4V ",
]);

/**
 * The real type, from the first bytes. The file name and the declared type are never used.
 * @param {Buffer} head the first bytes of the file (1024 are enough)
 * @returns {string | null}
 */
export function sniffContentType(head) {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (head.subarray(0, 1024).includes("%PDF-")) return "application/pdf";
  if (head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    if (MP4_BRANDS.has(head.subarray(8, 12).toString("latin1"))) return "video/mp4";
  }
  return null;
}

/**
 * One pass over the stored upload: sha256, byte count and the head for sniffing.
 * @param {string} filePath
 */
export async function inspectFile(filePath) {
  const hash = createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    size += chunk.length;
    if (head.length < 1024) head = Buffer.concat([head, chunk]).subarray(0, 1024);
  }
  return { sha256: hash.digest("hex"), size, head };
}
