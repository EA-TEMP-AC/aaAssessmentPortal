import { hashPassword } from "../../src/lib/password.js";
import { User } from "../../src/models/user.model.js";

export const webDevice = {
  deviceId: "dev-9f3a",
  platform: "web",
  appVersion: "1.0.0",
};

export async function createUser(overrides = {}) {
  const password = overrides.password ?? "Correct-Horse-9";
  const passwordHash = await hashPassword(password);
  const doc = {
    email: overrides.email ?? "admin@aa.example",
    name: overrides.name ?? "AA Admin",
    role: overrides.role ?? "aa_admin",
    active: overrides.active ?? true,
    mustChangePassword: overrides.mustChangePassword ?? false,
    passwordHash,
  };
  if (overrides.linkedProfileId) doc.linkedProfileId = overrides.linkedProfileId;
  if (overrides.abId) doc.abId = overrides.abId;
  if (overrides.tpId) doc.tpId = overrides.tpId;
  const user = await User.create(doc);
  return { user, password };
}
