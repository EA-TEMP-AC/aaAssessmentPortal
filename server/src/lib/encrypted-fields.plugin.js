import mongoose from "mongoose";
import {
  decryptValue,
  encryptValue,
  FieldCryptoError,
  hashValue,
  looksEncrypted,
} from "./field-crypto.js";

/**
 * Mongoose plugin: transparent field-level encryption at rest. docs/SCHEMA.md §6.
 *
 *   schema.plugin(encryptedFieldsPlugin, {
 *     collection: "users",
 *     fields: { email: { hash: "emailHash", normalize: normalizeEmail } },
 *   });
 *
 * - The path stores `enc:v1:...` ciphertext. Hydrated documents decrypt through a getter,
 *   lean results are decrypted by a post hook, so services see plaintext either way.
 * - `hash` names an extra path holding a keyed hash of the normalised value. Equality filters
 *   on the encrypted path are rewritten to the hash path, and unique indexes belong on it.
 *   The hash path is `select: false` and never leaves the model layer.
 * - Fields without `hash` cannot be used in a filter (the plugin throws, it never scans).
 * - The schema must not give an encrypted path `lowercase`, `trim` or `maxlength`: setters run
 *   on update casting after the encrypt step and would corrupt the ciphertext. Put `normalize`
 *   here and the length check in the request schema.
 * - `aggregate`, `bulkWrite` and `Model.collection.*` bypass the plugin. Do not use them on
 *   these paths.
 */

/** collection name -> { schema, fields }. The migration script walks this. */
export const ENCRYPTED_MODELS = new Map();

const QUERY_OPS = [
  "find",
  "findOne",
  "countDocuments",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
];
const UPDATE_OPS = ["findOneAndUpdate", "updateOne", "updateMany"];
const REPLACE_OPS = ["findOneAndReplace", "replaceOne"];
const READ_OPS = ["find", "findOne", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace"];
const EXISTENCE_ONLY = new Set(["$exists"]);

const identity = (value) => value;

export function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

export function normalizeText(value) {
  return String(value).trim();
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

function labelOf(collection, path) {
  return `${collection}.${path}`;
}

/** Decrypts when the value is ours, otherwise returns it untouched. */
function revealStored(value, label) {
  if (typeof value !== "string" || !looksEncrypted(value)) return value;
  return decryptValue(value, label);
}

/**
 * Plaintext that merely looks like ciphertext (a typed value) fails to authenticate. Treat that
 * as plaintext so it still gets encrypted rather than stored in the clear.
 */
function plainOf(value, label) {
  if (!looksEncrypted(value)) return value;
  try {
    return decryptValue(value, label);
  } catch (err) {
    if (err instanceof FieldCryptoError) return value;
    throw err;
  }
}

export function encryptedFieldsPlugin(schema, options) {
  const { collection, fields } = options;
  const entries = Object.entries(fields).map(([path, spec]) => ({
    path,
    hashPath: spec.hash ?? null,
    normalize: spec.normalize ?? identity,
    label: labelOf(collection, path),
    hashLabel: labelOf(collection, `${path}#hash`),
  }));
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  ENCRYPTED_MODELS.set(collection, { schema, entries });

  for (const entry of entries) {
    const type = schema.path(entry.path);
    if (!type)
      throw new Error(`encryptedFieldsPlugin: ${collection}.${entry.path} is not in the schema`);
    type.get((value) => revealStored(value, entry.label));
    if (entry.hashPath) {
      schema.add({ [entry.hashPath]: { type: String, select: false } });
    }
  }
  schema.set("toObject", { ...(schema.get("toObject") ?? {}), getters: true });
  schema.set("toJSON", { ...(schema.get("toJSON") ?? {}), getters: true });

  function seal(entry, value) {
    const plain = plainOf(value, entry.label);
    const normalized = entry.normalize(plain);
    return {
      stored: encryptValue(normalized, entry.label),
      hash: entry.hashPath ? hashValue(normalized, entry.hashLabel) : undefined,
    };
  }

  // ---- documents ---------------------------------------------------------
  schema.pre("save", function encryptOnSave() {
    for (const entry of entries) {
      if (!this.isNew && !this.isModified(entry.path)) continue;
      const raw = this.get(entry.path, null, { getters: false });
      if (!isPresent(raw)) {
        if (entry.hashPath) this.set(entry.hashPath, undefined);
        continue;
      }
      const sealed = seal(entry, raw);
      this.set(entry.path, sealed.stored);
      if (entry.hashPath) this.set(entry.hashPath, sealed.hash);
    }
  });

  schema.pre("insertMany", function encryptOnInsertMany(next, docs) {
    for (const doc of Array.isArray(docs) ? docs : [docs]) {
      for (const entry of entries) {
        if (!isPresent(doc[entry.path])) continue;
        const sealed = seal(entry, doc[entry.path]);
        doc[entry.path] = sealed.stored;
        if (entry.hashPath) doc[entry.hashPath] = sealed.hash;
      }
    }
    next();
  });

  // ---- queries -----------------------------------------------------------
  function rewriteCondition(entry, condition) {
    if (!entry.hashPath) {
      throw new Error(`${entry.label} is encrypted and cannot be used in a query filter`);
    }
    const hashOf = (value) =>
      isPresent(value)
        ? hashValue(entry.normalize(plainOf(value, entry.label)), entry.hashLabel)
        : null;

    if (condition === null || typeof condition !== "object" || condition instanceof RegExp) {
      if (condition instanceof RegExp) {
        throw new Error(`${entry.label} is encrypted; pattern search is not possible`);
      }
      return { [entry.hashPath]: hashOf(condition) };
    }
    const rewritten = {};
    for (const [op, operand] of Object.entries(condition)) {
      if (op === "$eq" || op === "$ne") rewritten[op] = hashOf(operand);
      else if (op === "$in" || op === "$nin") rewritten[op] = operand.map(hashOf);
      else if (EXISTENCE_ONLY.has(op)) rewritten[op] = operand;
      else throw new Error(`${entry.label} is encrypted; operator ${op} is not supported`);
    }
    return { [entry.hashPath]: rewritten };
  }

  function rewriteFilter(filter) {
    if (Array.isArray(filter)) return filter.map(rewriteFilter);
    if (filter === null || typeof filter !== "object") return filter;
    const out = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key === "$and" || key === "$or" || key === "$nor") {
        out[key] = value.map(rewriteFilter);
      } else if (byPath.has(key)) {
        Object.assign(out, rewriteCondition(byPath.get(key), value));
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  for (const op of QUERY_OPS) {
    schema.pre(op, function rewriteQueryFilter() {
      this.setQuery(rewriteFilter(this.getFilter()));
    });
  }

  // ---- updates -----------------------------------------------------------
  /**
   * Seals `target[path]` in place. A blank value is moved to `$unset` (when given) so a sparse
   * unique hash index never sees a stored null.
   */
  function sealInto(target, entry, unset) {
    const value = target[entry.path];
    if (value === undefined) return;
    if (!isPresent(value)) {
      delete target[entry.path];
      unset[entry.path] = "";
      if (entry.hashPath) unset[entry.hashPath] = "";
      return;
    }
    const sealed = seal(entry, value);
    target[entry.path] = sealed.stored;
    if (entry.hashPath) target[entry.hashPath] = sealed.hash;
  }

  function sealUpdate(update, { replace }) {
    if (Array.isArray(update)) {
      throw new Error(`${collection}: pipeline updates are not supported on encrypted paths`);
    }
    const unset = {};
    for (const entry of entries) {
      for (const op of ["$inc", "$push", "$addToSet", "$pull", "$min", "$max", "$mul", "$rename"]) {
        if (update[op] && entry.path in update[op]) {
          throw new Error(`${entry.label} is encrypted; ${op} is not supported`);
        }
      }
      for (const op of ["$set", "$setOnInsert"]) {
        if (update[op]) sealInto(update[op], entry, unset);
      }
      if (update.$unset && entry.path in update.$unset && entry.hashPath) {
        unset[entry.hashPath] = "";
      }
      // Top-level paths are an implicit $set (and the whole document for a replace).
      sealInto(update, entry, unset);
    }
    if (Object.keys(unset).length > 0) {
      if (replace) {
        for (const key of Object.keys(unset)) delete update[key];
      } else {
        update.$unset = { ...(update.$unset ?? {}), ...unset };
      }
    }
    return update;
  }

  for (const op of UPDATE_OPS) {
    schema.pre(op, function encryptUpdate() {
      const update = this.getUpdate();
      if (update) this.setUpdate(sealUpdate(update, { replace: false }));
    });
  }
  for (const op of REPLACE_OPS) {
    schema.pre(op, function encryptReplace() {
      const update = this.getUpdate();
      if (update) this.setUpdate(sealUpdate(update, { replace: true }));
    });
  }

  // ---- reads (lean results; hydrated documents use the getter) -----------
  function revealLean(doc) {
    if (!doc || typeof doc !== "object" || doc instanceof mongoose.Document) return;
    for (const entry of entries) {
      if (typeof doc[entry.path] === "string")
        doc[entry.path] = revealStored(doc[entry.path], entry.label);
    }
    for (const entry of entries) {
      if (entry.hashPath) delete doc[entry.hashPath];
    }
  }

  for (const op of READ_OPS) {
    schema.post(op, function decryptResult(result) {
      if (Array.isArray(result)) result.forEach(revealLean);
      else revealLean(result);
    });
  }
}
