import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Assessor } from "../src/models/assessor.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Learner } from "../src/models/learner.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { TrainingPartner } from "../src/models/training-partner.model.js";
import { User } from "../src/models/user.model.js";
import { seedRoleUsers } from "../src/scripts/seed-users.js";
import {
  SEED_ASSESSOR,
  SEED_AWARDING_BODY,
  SEED_CENTRE,
  SEED_LEARNER,
  SEED_PROCTOR,
  SEED_QUALIFICATIONS,
  SEED_TRAINING_PARTNER,
  assertSeedAllowed,
  seedMasterData,
} from "../src/scripts/seed-master-data.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("master data seed", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      AwardingBody.syncIndexes(),
      TrainingPartner.syncIndexes(),
      Centre.syncIndexes(),
      Qualification.syncIndexes(),
      Learner.syncIndexes(),
      Assessor.syncIndexes(),
      Proctor.syncIndexes(),
      User.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("refuses to seed when NODE_ENV is production", async () => {
    expect(() => assertSeedAllowed("production")).toThrow(/production/);
    await expect(seedMasterData({ nodeEnv: "production" })).rejects.toThrow(/production/);
    expect(await AwardingBody.countDocuments()).toBe(0);
  });

  it("refuses the seed script in production before connecting", () => {
    const result = spawnSync(process.execPath, ["src/scripts/seed.js"], {
      cwd: serverRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        MONGO_URI: "mongodb://127.0.0.1:9/unused",
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to seed when NODE_ENV=production/);
  });

  it("is idempotent and links the seeded reviewer, partner, and candidate", async () => {
    await seedRoleUsers();
    const first = await seedMasterData();
    expect(first).toMatchObject({
      abCode: SEED_AWARDING_BODY.code,
      tpCode: SEED_TRAINING_PARTNER.code,
      centreCode: SEED_CENTRE.code,
      learnerExternalRef: SEED_LEARNER.externalRef,
      assessorCode: SEED_ASSESSOR.code,
      proctorCode: SEED_PROCTOR.code,
    });
    expect(first.qualificationCodes.sort()).toEqual(
      SEED_QUALIFICATIONS.map((item) => item.code).sort(),
    );

    await AwardingBody.updateOne({ code: SEED_AWARDING_BODY.code }, { $set: { name: "Changed" } });
    await Centre.updateOne({ code: SEED_CENTRE.code }, { $set: { state: "Gujarat" } });
    await Qualification.updateOne(
      { code: "Q-ELEC-L4" },
      { $set: { sector: "Construction", ratioClass: "services" } },
    );
    const second = await seedMasterData();
    expect(second.abCode).toBe(first.abCode);

    expect(await AwardingBody.countDocuments()).toBe(1);
    expect(await TrainingPartner.countDocuments()).toBe(1);
    expect(await Centre.countDocuments()).toBe(1);
    expect(await Qualification.countDocuments()).toBe(SEED_QUALIFICATIONS.length);
    expect(await Learner.countDocuments()).toBe(1);
    expect(await Assessor.countDocuments()).toBe(1);
    expect(await Proctor.countDocuments()).toBe(1);
    expect(await User.countDocuments()).toBe(9);

    const awardingBody = await AwardingBody.findOne({ code: SEED_AWARDING_BODY.code }).lean();
    expect(awardingBody.name).toBe(SEED_AWARDING_BODY.name);
    const centre = await Centre.findOne({ code: SEED_CENTRE.code }).lean();
    const partner = await TrainingPartner.findOne({ code: SEED_TRAINING_PARTNER.code }).lean();
    expect(String(centre.tpId)).toBe(String(partner._id));
    expect(centre.state).toBe(SEED_CENTRE.state);

    const electrician = await Qualification.findOne({ code: "Q-ELEC-L4" }).lean();
    const welder = await Qualification.findOne({ code: "Q-WELD-L3" }).lean();
    expect(electrician.sector).toBe("Electronics");
    expect(electrician.ratioClass).toBe("manufacturing");
    expect(welder.sector).toBe("Iron & Steel");
    expect(welder.ratioClass).toBe("manufacturing");
    const ratioClasses = ["manufacturing", "services", "school_education", "other"];
    const sectors = await Qualification.distinct("sector");
    expect(sectors.every((sector) => !ratioClasses.includes(sector))).toBe(true);

    const reviewer = await User.findOne({ email: "ab.reviewer@aa.example" }).lean();
    const tp = await User.findOne({ email: "tp@aa.example" }).lean();
    const candidate = await User.findOne({ email: "candidate@aa.example" }).lean();
    const assessorUser = await User.findOne({ email: "assessor@aa.example" }).lean();
    const proctorUser = await User.findOne({ email: "proctor@aa.example" }).lean();
    expect(String(reviewer.abId)).toBe(String(awardingBody._id));
    expect(String(tp.tpId)).toBe(String(partner._id));
    expect(String(candidate.linkedProfileId)).toBe(
      String((await Learner.findOne({ externalRef: SEED_LEARNER.externalRef }).lean())._id),
    );
    const assessor = await Assessor.findOne({ code: SEED_ASSESSOR.code }).lean();
    const proctor = await Proctor.findOne({ code: SEED_PROCTOR.code }).lean();
    expect(assessor.toa.certNo).toBe(SEED_ASSESSOR.toa.certNo);
    expect(assessor.languages).toEqual([...SEED_ASSESSOR.languages]);
    expect(assessor.otherAaCount).toBe(SEED_ASSESSOR.otherAaCount);
    expect(assessor.undertaking).toBe(true);
    expect(assessor).not.toHaveProperty("aadhaar");
    expect(proctor.qualifications).toEqual([...SEED_PROCTOR.qualifications]);
    expect(proctor.toa).toBeUndefined();
    expect(String(assessorUser.linkedProfileId)).toBe(String(assessor._id));
    expect(String(proctorUser.linkedProfileId)).toBe(String(proctor._id));
  });
});
