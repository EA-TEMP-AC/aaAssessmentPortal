import mongoose from "mongoose";
import { encryptedFieldsPlugin, normalizeEmail } from "../lib/encrypted-fields.plugin.js";
import { isSecretKey } from "../lib/redact.js";
import { USER_ROLES } from "./roles.js";

const userSchema = new mongoose.Schema(
  {
    // Encrypted at rest (S-01). Lookup and uniqueness use emailHash.
    email: { type: String, required: true },
    passwordHash: { type: String, required: true, select: false },
    // X-36: a student's first temporary password, encrypted, so staff can hand it over. Removed
    // when the student changes the password or an admin resets it.
    initialPassword: { type: String, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: USER_ROLES },
    active: { type: Boolean, required: true, default: true },
    mustChangePassword: { type: Boolean, required: true, default: false },
    linkedProfileId: { type: mongoose.Schema.Types.ObjectId },
    abId: { type: mongoose.Schema.Types.ObjectId },
    tpId: { type: mongoose.Schema.Types.ObjectId },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.plugin(encryptedFieldsPlugin, {
  collection: "users",
  fields: {
    email: { hash: "emailHash", normalize: normalizeEmail },
    initialPassword: {},
  },
});

// Partial, not plain unique: rows written before the S-01 migration have no hash yet, and
// a plain unique index would treat every one of them as the same missing value.
userSchema.index(
  { emailHash: 1 },
  { unique: true, partialFilterExpression: { emailHash: { $type: "string" } } },
);
userSchema.index({ role: 1, active: 1 });

userSchema.set("toJSON", {
  getters: true,
  transform(_doc, ret) {
    for (const key of Object.keys(ret)) {
      if (isSecretKey(key)) delete ret[key];
    }
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model("User", userSchema, "users");
