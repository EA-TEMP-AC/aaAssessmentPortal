import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    tokenHash: { type: String, required: true },
    deviceId: { type: String, required: true },
    device: {
      platform: { type: String },
      appVersion: { type: String },
    },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1, deviceId: 1 });

export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema, "refreshTokens");
