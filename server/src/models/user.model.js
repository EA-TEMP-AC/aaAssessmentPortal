import mongoose from "mongoose";
import { USER_ROLES } from "./roles.js";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
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

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, active: 1 });

userSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.passwordResetTokenHash;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model("User", userSchema, "users");
