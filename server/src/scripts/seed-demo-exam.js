import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { assertSeedAllowed } from "./seed-master-data.js";
import { Attempt } from "../models/attempt.model.js";
import { Batch } from "../models/batch.model.js";
import { Qualification } from "../models/qualification.model.js";
import { Question } from "../models/question.model.js";
import { TestPaper } from "../models/test-paper.model.js";
import { User } from "../models/user.model.js";

/**
 * Dev and demo only. Run after `npm run seed`: `npm run seed:demo-exam -w server`.
 * Adds 12 sample questions and one approved test paper for the seeded qualification, and makes the
 * seeded batch open for the candidate (in progress, dates around today, English). The paper is named
 * and set as the one paper of that batch (D5). Safe to run again:
 * it resets the demo paper so the exam can be taken again. Refuses to run in production.
 */

const QUESTIONS = [
  ["Which of these is a primary colour of light?", ["Red", "Brown", "Pink", "Grey"], 0],
  ["How many days are there in a leap year?", ["364", "365", "366", "367"], 2],
  ["Which planet is known as the Red Planet?", ["Venus", "Mars", "Jupiter", "Saturn"], 1],
  ["What is the capital of India?", ["Mumbai", "Kolkata", "New Delhi", "Chennai"], 2],
  [
    "Which gas do plants take in for photosynthesis?",
    ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"],
    2,
  ],
  ["How many minutes are there in two hours?", ["60", "90", "120", "150"], 2],
  ["Which of these is a mammal?", ["Shark", "Dolphin", "Trout", "Octopus"], 1],
  ["What is 12 multiplied by 5?", ["50", "55", "60", "65"], 2],
  ["Which direction does the sun rise from?", ["North", "South", "East", "West"], 2],
  [
    "Which of these is used to measure temperature?",
    ["Ruler", "Thermometer", "Compass", "Scale"],
    1,
  ],
  ["How many sides does a hexagon have?", ["5", "6", "7", "8"], 1],
  ["Which is the largest ocean on Earth?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3],
];
const KEYS = ["A", "B", "C", "D"];
const QUESTION_ID = (i) =>
  new mongoose.Types.ObjectId(`66f0b07c00000000000001${i.toString(16).padStart(2, "0")}`);
const PAPER_ID = new mongoose.Types.ObjectId("66f0b07d0000000000000001");
const QUALIFICATION_CODE = "Q-ELEC-L4";
const BATCH_ID = new mongoose.Types.ObjectId("66f0b07b0000000000000001");

function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

export async function seedDemoExam({ nodeEnv = env.NODE_ENV } = {}) {
  assertSeedAllowed(nodeEnv);
  const qualification = await Qualification.findOne({ code: QUALIFICATION_CODE }).lean();
  const admin = await User.findOne({ email: "admin@aa.example" }).lean();
  const batch = await Batch.findById(BATCH_ID).lean();
  if (!qualification || !admin || !batch) {
    throw new Error("Run `npm run seed -w server` first");
  }
  const nos = qualification.nos[0];
  const pc = nos.pcs[0];

  const questionDocs = QUESTIONS.map(([stem, options, answer], i) => ({
    _id: QUESTION_ID(i),
    qualificationId: qualification._id,
    nosId: nos.nosId,
    pcId: pc.pcId,
    type: "mcq",
    language: "English",
    difficulty: "easy",
    stem,
    options: options.map((text, k) => ({ key: KEYS[k], text })),
    correctAnswer: KEYS[answer],
    marks: 1,
    status: "approved",
    version: 1,
    rootQuestionId: null,
    previousVersionId: null,
    isLatest: true,
    createdBy: admin._id,
    approvedBy: admin._id,
    approvedAt: new Date(),
  }));
  await Question.deleteMany({ _id: { $in: questionDocs.map((q) => q._id) } });
  await Question.insertMany(questionDocs);

  const items = questionDocs.slice(0, 10).map((q) => ({
    questionId: q._id,
    rootQuestionId: q._id,
    version: 1,
    nosId: q.nosId,
    pcId: q.pcId,
    type: "mcq",
    marks: 1,
    difficulty: "easy",
  }));
  await Attempt.deleteMany({ testPaperId: PAPER_ID });
  await TestPaper.deleteOne({ _id: PAPER_ID });
  await TestPaper.create({
    _id: PAPER_ID,
    qualificationId: qualification._id,
    name: "Demo exam (English)",
    status: "approved",
    seed: 1,
    rules: { language: "English", totalMarks: 10, quotas: [] },
    poolHash: "demo-exam",
    items,
    totalMarks: 10,
    shortages: [],
    durationMinutes: 20,
    marksTargetMet: true,
    complete: true,
    createdBy: admin._id,
    approvedBy: admin._id,
    approvedAt: new Date(),
  });

  await Batch.updateOne(
    { _id: BATCH_ID },
    {
      $set: {
        status: "in_progress",
        assessmentStartDate: istDate(-1),
        assessmentEndDate: istDate(30),
        assessmentLanguage: "English",
        testPaperId: PAPER_ID,
      },
    },
  );
  return { paperId: String(PAPER_ID), questions: questionDocs.length };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry);
}

if (isDirectRun()) {
  (async () => {
    assertSeedAllowed();
    if (!env.MONGO_URI) {
      console.error("MONGO_URI is required to seed");
      process.exit(1);
    }
    await mongoose.connect(env.MONGO_URI);
    try {
      const out = await seedDemoExam();
      console.log(`Demo exam ready: ${out.questions} questions, 10 in the paper, 20 minutes.`);
      console.log("Log in as candidate@aa.example and open Exam.");
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
