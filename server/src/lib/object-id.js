import mongoose from "mongoose";

/** Cast a 24-hex ObjectId. Rejects other strings `isValid` would accept. */
export function toObjectIdOrNull(value) {
  if (value == null || value === "") return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const str = String(value);
  if (!/^[a-fA-F0-9]{24}$/.test(str)) return null;
  return new mongoose.Types.ObjectId(str);
}
