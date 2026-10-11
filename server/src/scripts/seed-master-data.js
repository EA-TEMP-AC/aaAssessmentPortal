import { AwardingBody } from "../models/awarding-body.model.js";
import { Centre } from "../models/centre.model.js";
import { Learner } from "../models/learner.model.js";
import { Qualification } from "../models/qualification.model.js";
import { TrainingPartner } from "../models/training-partner.model.js";
import { User } from "../models/user.model.js";
import { env } from "../config/env.js";
import { assertQualificationPassMarks } from "../modules/master-data/pass-marks.js";

/** Sample awarding body. Idempotent on `code`. */
export const SEED_AWARDING_BODY = Object.freeze({
  code: "AB-SAMPLE",
  name: "Sample Awarding Body",
  notificationEmails: Object.freeze(["notify@ab.example"]),
  active: true,
});

/** Sample training partner. Idempotent on `code`. */
export const SEED_TRAINING_PARTNER = Object.freeze({
  code: "TP-SAMPLE",
  name: "Sample Training Partner",
  email: "tp.sample@example.com",
  active: true,
});

/** Sample centre, linked to SEED_TRAINING_PARTNER. Idempotent on `code`. */
export const SEED_CENTRE = Object.freeze({
  code: "CTR-SAMPLE",
  name: "Sample Centre",
  active: true,
});

/** Contract example, percent pass marks. Idempotent on `code`. */
export const SEED_QUALIFICATION_PERCENT = Object.freeze({
  code: "Q-ELEC-L4",
  name: "Electrician L4",
  sector: "manufacturing",
  passCriteriaMode: "nos_wise",
  passMarkUnit: "percent",
  passMarks: Object.freeze({ theory: 50, practical: 50, viva: 50 }),
  maxMarks: null,
  nos: Object.freeze([
    Object.freeze({
      nosId: "NOS-01",
      code: "N01",
      name: "Safety",
      maxMarks: Object.freeze({ theory: null, practical: null, viva: null }),
      pcs: Object.freeze([Object.freeze({ pcId: "PC-01", code: "P1", name: "PPE" })]),
    }),
  ]),
  pcPassMarksRequired: false,
});

/** Absolute pass marks with ceilings. Idempotent on `code`. */
export const SEED_QUALIFICATION_ABSOLUTE = Object.freeze({
  code: "Q-WELD-L3",
  name: "Welder L3",
  sector: "manufacturing",
  passCriteriaMode: "overall",
  passMarkUnit: "absolute",
  passMarks: Object.freeze({ theory: 20, practical: 30, viva: 10 }),
  maxMarks: Object.freeze({ theory: 40, practical: 60, viva: 20 }),
  nos: Object.freeze([
    Object.freeze({
      nosId: "NOS-W1",
      code: "NW1",
      name: "Joints",
      maxMarks: Object.freeze({ theory: 40, practical: 60, viva: 20 }),
      pcs: Object.freeze([
        Object.freeze({ pcId: "PC-W1", code: "PW1", name: "Bead", passMark: 10, maxMark: 20 }),
      ]),
    }),
  ]),
  pcPassMarksRequired: true,
});

export const SEED_QUALIFICATIONS = Object.freeze([
  SEED_QUALIFICATION_PERCENT,
  SEED_QUALIFICATION_ABSOLUTE,
]);

/** Sample learner so the seeded candidate can be linked. Idempotent on `externalRef`. */
export const SEED_LEARNER = Object.freeze({
  name: "Sample Learner",
  externalRef: "TP-REG-10021",
  phone: "9000000001",
  accommodations: Object.freeze([]),
  active: true,
});

export function assertSeedAllowed(nodeEnv = env.NODE_ENV) {
  if (nodeEnv === "production") {
    throw new Error("Refusing to seed when NODE_ENV=production");
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function upsertByCode(model, spec) {
  return model
    .findOneAndUpdate({ code: spec.code }, { $set: clone(spec) }, { upsert: true, new: true })
    .lean();
}

/**
 * Sample AB, TP, centre, qualifications, and one learner.
 * Upserts by code or externalRef. Links the seeded ab_reviewer, tp, and candidate
 * when those users already exist. Refuses to run when NODE_ENV=production.
 */
export async function seedMasterData({ nodeEnv = env.NODE_ENV } = {}) {
  assertSeedAllowed(nodeEnv);

  for (const qualification of SEED_QUALIFICATIONS) {
    assertQualificationPassMarks(qualification);
  }

  const awardingBody = await upsertByCode(AwardingBody, SEED_AWARDING_BODY);
  const trainingPartner = await upsertByCode(TrainingPartner, SEED_TRAINING_PARTNER);
  const centre = await upsertByCode(Centre, { ...SEED_CENTRE, tpId: trainingPartner._id });
  const qualifications = [];
  for (const spec of SEED_QUALIFICATIONS) {
    qualifications.push(await upsertByCode(Qualification, spec));
  }
  const learner = await Learner.findOneAndUpdate(
    { externalRef: SEED_LEARNER.externalRef },
    { $set: clone(SEED_LEARNER) },
    { upsert: true, new: true },
  ).lean();

  await User.updateOne({ email: "ab.reviewer@aa.example" }, { $set: { abId: awardingBody._id } });
  await User.updateOne({ email: "tp@aa.example" }, { $set: { tpId: trainingPartner._id } });
  await User.updateOne(
    { email: "candidate@aa.example" },
    { $set: { linkedProfileId: learner._id } },
  );

  return {
    abCode: awardingBody.code,
    tpCode: trainingPartner.code,
    centreCode: centre.code,
    qualificationCodes: qualifications.map((item) => item.code),
    learnerExternalRef: learner.externalRef,
  };
}
