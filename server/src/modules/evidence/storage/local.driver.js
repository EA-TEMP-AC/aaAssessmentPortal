import { createReadStream } from "node:fs";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { StorageKeyExistsError, StorageNotFoundError } from "./storage-errors.js";

/** Keys are made by the server (`evidence/<uuid>.<ext>`). Anything else is refused. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9/_-]*(\.[a-z0-9]{1,5})?$/;

/**
 * Local disk driver for development and tests. Same interface as the S3 driver.
 * @param {{ dir: string }} options
 */
export function createLocalStorage({ dir }) {
  const root = path.resolve(dir);

  function resolveKey(key) {
    if (
      typeof key !== "string" ||
      !KEY_PATTERN.test(key) ||
      key.includes("..") ||
      key.includes("//")
    ) {
      throw new Error("Invalid storage key");
    }
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  return {
    name: "local",

    async put({ key, body }) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      let handle;
      try {
        handle = await open(full, "wx", 0o600);
      } catch (err) {
        if (err.code === "EEXIST") throw new StorageKeyExistsError();
        throw err;
      }
      try {
        await pipeline(body, handle.createWriteStream());
      } catch (err) {
        // Remove only the partial file this call just created.
        await unlink(full).catch(() => {});
        throw err;
      }
      return { key };
    },

    async get(key) {
      const full = resolveKey(key);
      let info;
      try {
        info = await stat(full);
      } catch (err) {
        if (err.code === "ENOENT") throw new StorageNotFoundError(key);
        throw err;
      }
      return { stream: createReadStream(full), size: info.size };
    },

    /** The local driver has no URLs. The route streams the file instead. */
    async signedUrl() {
      return null;
    },
  };
}
