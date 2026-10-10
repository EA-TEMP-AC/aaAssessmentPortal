import { AuditLog } from "../src/models/audit-log.model.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { User } from "../src/models/user.model.js";
import { DEFAULT_SEED_PASSWORD, SEED_USERS, seedRoleUsers } from "../src/scripts/seed-users.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createApp } from "../src/app.js";
import request from "supertest";
import { webDevice } from "./helpers/fixtures.js";

const app = createApp();

function indexKeys(indexes) {
  return indexes.map((index) => index.key);
}

describe("models and dev seed", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([User.syncIndexes(), RefreshToken.syncIndexes(), AuditLog.syncIndexes()]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("creates the indexes listed in SCHEMA.md", async () => {
    expect(indexKeys(await User.collection.indexes())).toEqual(
      expect.arrayContaining([{ _id: 1 }, { email: 1 }, { role: 1, active: 1 }]),
    );
    const userEmail = (await User.collection.indexes()).find((index) => index.key.email === 1);
    expect(userEmail.unique).toBe(true);

    expect(indexKeys(await RefreshToken.collection.indexes())).toEqual(
      expect.arrayContaining([{ _id: 1 }, { tokenHash: 1 }, { userId: 1, deviceId: 1 }]),
    );
    const tokenHash = (await RefreshToken.collection.indexes()).find(
      (index) => index.key.tokenHash === 1,
    );
    expect(tokenHash.unique).toBe(true);
  });

  it("seeds exactly one user per role with the documented dev password", async () => {
    expect(SEED_USERS).toHaveLength(USER_ROLES.length);
    expect(DEFAULT_SEED_PASSWORD).toBe("Dev-Password-1");

    const emails = await seedRoleUsers();
    expect(emails).toHaveLength(9);

    const users = await User.find().select("+passwordHash");
    expect(users.map((user) => user.role).sort()).toEqual([...USER_ROLES].sort());
    expect(new Set(users.map((user) => user.email)).size).toBe(9);
    for (const user of users) {
      expect(user.mustChangePassword).toBe(false);
      expect(user.active).toBe(true);
      expect(user.passwordHash).not.toBe(DEFAULT_SEED_PASSWORD);
    }

    await seedRoleUsers();
    expect(await User.countDocuments()).toBe(9);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@aa.example",
      password: DEFAULT_SEED_PASSWORD,
      device: webDevice,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("aa_admin");
  });
});
