import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { hashPassword } from "../lib/password.js";
import { Assessor } from "../models/assessor.model.js";
import { Attempt } from "../models/attempt.model.js";
import { Batch } from "../models/batch.model.js";
import { Candidate } from "../models/candidate.model.js";
import { Centre } from "../models/centre.model.js";
import { Learner } from "../models/learner.model.js";
import { ProctoringFlag } from "../models/proctoring-flag.model.js";
import { ProctoringSession } from "../models/proctoring-session.model.js";
import { Proctor } from "../models/proctor.model.js";
import { Qualification } from "../models/qualification.model.js";
import { Question } from "../models/question.model.js";
import { TestPaper } from "../models/test-paper.model.js";
import { TrainingPartner } from "../models/training-partner.model.js";
import { User } from "../models/user.model.js";
import { AwardingBody } from "../models/awarding-body.model.js";
import { slaDueAtCreation } from "../modules/batches/batch-sla.js";
import { generatedLoginId } from "../modules/candidates/candidate-login.service.js";
import { assertSeedAllowed } from "./seed-master-data.js";

/**
 * Dev, test-server and demo only. Run after `npm run seed`: `npm run seed:demo-full -w server`.
 * Adds a fuller data set on top of the basic seed: two more training partners and centres, 30
 * students with logins (all with the same demo password, readable in the student list), a question
 * bank in every status, English and Hindi papers, and batches in every stage from allocated to
 * assessment completed, with finished and running exams, scores, and proctoring flags.
 * Safe to run again: it removes its own earlier rows (marked DEMO-) and rebuilds them.
 * Refuses to run in production.
 */

export const DEMO_PASSWORD = process.env.SEED_PASSWORD || "Dev-Password-1";

const QUALIFICATION_CODE = "Q-ELEC-L4";
const KEYS = ["A", "B", "C", "D"];

/** Stable ids, so a second run replaces the first instead of adding to it. */
function oid(kind, n) {
  return new mongoose.Types.ObjectId(`66f0d0${kind}${n.toString(16).padStart(16, "0")}`);
}
const K = { question: "01", paper: "02", batch: "03", learner: "04", attempt: "05", session: "06" };

function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

const FIRST = [
  "Asha",
  "Ravi",
  "Meena",
  "Suresh",
  "Priya",
  "Arjun",
  "Kavita",
  "Manoj",
  "Sunita",
  "Deepak",
  "Anita",
  "Rahul",
  "Pooja",
  "Vikram",
  "Neha",
  "Sanjay",
  "Rekha",
  "Amit",
  "Geeta",
  "Rohit",
  "Lakshmi",
  "Karthik",
  "Divya",
  "Naveen",
  "Shalini",
  "Imran",
  "Farah",
  "Gurpreet",
  "Harleen",
  "Joseph",
];
const LAST = ["Sharma", "Verma", "Patil", "Nair", "Reddy", "Singh", "Khan", "Das", "Iyer", "Gupta"];

/** English questions: [stem, options, index of the right option]. */
const ENGLISH = [
  [
    "What must you do before working on a live circuit?",
    [
      "Switch off and lock out the supply",
      "Wear loose clothes",
      "Work faster",
      "Ask a friend to watch",
    ],
    0,
  ],
  ["Which unit measures electrical resistance?", ["Volt", "Ampere", "Ohm", "Watt"], 2],
  [
    "Which colour is normally used for the earth wire?",
    ["Red", "Green-yellow", "Blue", "Black"],
    1,
  ],
  [
    "What does an MCB protect against?",
    ["Overload and short circuit", "Low light", "Noise", "Dust"],
    0,
  ],
  ["Which tool is used to measure voltage?", ["Ammeter", "Multimeter", "Hammer", "Spanner"], 1],
  ["What is the unit of electrical power?", ["Watt", "Ohm", "Farad", "Henry"], 0],
  ["Which material is a good insulator?", ["Copper", "Rubber", "Aluminium", "Silver"], 1],
  [
    "Which PPE protects your hands from electric shock?",
    ["Cotton gloves", "Insulated gloves", "Garden gloves", "No gloves"],
    1,
  ],
  [
    "A fuse in a circuit is used to...",
    [
      "Increase current",
      "Break the circuit when current is too high",
      "Store charge",
      "Reduce voltage",
    ],
    1,
  ],
  [
    "What is the standard household supply frequency in India?",
    ["25 Hz", "50 Hz", "60 Hz", "100 Hz"],
    1,
  ],
  ["Which device converts AC to DC?", ["Rectifier", "Transformer", "Fuse", "Switch"], 0],
  ["Current is measured in...", ["Volts", "Ohms", "Amperes", "Joules"], 2],
  [
    "Which of these must be checked before using a power tool?",
    ["Its cord and plug", "Its colour", "Its price", "Its brand"],
    0,
  ],
  [
    "Who should be told first about an electrical accident?",
    ["The supervisor", "A stranger", "Nobody", "A customer"],
    0,
  ],
  [
    "Which extinguisher is safe for an electrical fire?",
    ["Water", "Carbon dioxide", "Foam on live wires", "Sand bucket of water"],
    1,
  ],
  [
    "A short circuit happens when...",
    [
      "Live and neutral touch directly",
      "The lamp is bright",
      "The wire is long",
      "The switch is off",
    ],
    0,
  ],
  [
    "What does RCCB stand for?",
    [
      "Residual Current Circuit Breaker",
      "Random Cable Control Box",
      "Rapid Charge Control Battery",
      "Rated Circuit Current Bar",
    ],
    0,
  ],
  [
    "Which wire is normally the live wire in India?",
    ["Red", "Green", "Black on old, red on new", "Brown on new"],
    3,
  ],
  [
    "How should a damaged cable be handled?",
    ["Taped and used", "Replaced", "Ignored", "Hidden"],
    1,
  ],
  ["What is the SI unit of potential difference?", ["Volt", "Newton", "Pascal", "Tesla"], 0],
];

/** Hindi questions for the Hindi paper. */
const HINDI = [
  [
    "जीवित सर्किट पर काम करने से पहले क्या करना चाहिए?",
    ["आपूर्ति बंद करके ताला लगाएं", "ढीले कपड़े पहनें", "तेज़ काम करें", "दोस्त को देखने कहें"],
    0,
  ],
  ["विद्युत प्रतिरोध की इकाई क्या है?", ["वोल्ट", "एम्पियर", "ओम", "वाट"], 2],
  ["अर्थ तार का सामान्य रंग कौन सा होता है?", ["लाल", "हरा-पीला", "नीला", "काला"], 1],
  ["एमसीबी किससे बचाता है?", ["अधिभार और शॉर्ट सर्किट से", "कम रोशनी से", "शोर से", "धूल से"], 0],
  ["वोल्टेज मापने के लिए कौन सा उपकरण उपयोग होता है?", ["अमीटर", "मल्टीमीटर", "हथौड़ा", "पाना"], 1],
  ["विद्युत शक्ति की इकाई क्या है?", ["वाट", "ओम", "फैराड", "हेनरी"], 0],
  ["कौन सी सामग्री अच्छी कुचालक है?", ["तांबा", "रबड़", "एल्यूमिनियम", "चांदी"], 1],
  [
    "बिजली के झटके से हाथों को कौन सा सुरक्षा उपकरण बचाता है?",
    ["सूती दस्ताने", "रोधी दस्ताने", "बगीचे के दस्ताने", "कोई नहीं"],
    1,
  ],
  [
    "सर्किट में फ्यूज का काम क्या है?",
    ["करंट बढ़ाना", "करंट अधिक होने पर सर्किट तोड़ना", "आवेश जमा करना", "वोल्टेज घटाना"],
    1,
  ],
  [
    "भारत में घरेलू आपूर्ति की मानक आवृत्ति क्या है?",
    ["25 हर्ट्ज़", "50 हर्ट्ज़", "60 हर्ट्ज़", "100 हर्ट्ज़"],
    1,
  ],
];

/** Ids of the paper items for a bank slice. */
function paperItems(questions) {
  return questions.map((q) => ({
    questionId: q._id,
    rootQuestionId: q._id,
    version: 1,
    nosId: q.nosId,
    pcId: q.pcId,
    type: "mcq",
    marks: q.marks,
    difficulty: q.difficulty,
  }));
}

/** What a student answers: right on most, wrong on some, deterministic by student and question. */
function pickAnswer(question, studentNo, qIndex, skill) {
  if ((studentNo * 7 + qIndex * 3) % 11 === 0) return null; // left blank
  const rightKey = question.correctAnswer;
  const right = ((studentNo * 5 + qIndex * 13) % 100) / 100 < skill;
  if (right) return rightKey;
  return KEYS[(KEYS.indexOf(rightKey) + 1 + ((studentNo + qIndex) % 3)) % 4];
}

function scoreAttempt(questions, byId) {
  const byNos = new Map();
  let max = 0;
  let got = 0;
  const marked = questions.map((q) => {
    const bank = byId.get(String(q.questionId));
    const awarded = q.answer != null && q.answer === bank.correctAnswer ? q.marks : 0;
    max += q.marks;
    got += awarded;
    const row = byNos.get(q.nosId) ?? { key: q.nosId, maxMarks: 0, obtainedMarks: 0 };
    row.maxMarks += q.marks;
    row.obtainedMarks += awarded;
    byNos.set(q.nosId, row);
    return { ...q, awardedMarks: awarded, scoreStatus: "scored", scoredBy: "auto" };
  });
  const group = (r) => ({ ...r, pendingMarks: 0, pendingCount: 0 });
  return {
    questions: marked,
    scores: {
      maxMarks: max,
      obtainedMarks: got,
      pendingMarks: 0,
      pendingCount: 0,
      complete: true,
      byNos: [...byNos.values()].map(group),
      byType: [group({ key: "mcq", maxMarks: max, obtainedMarks: got })],
    },
  };
}

/**
 * Builds every document of the demo set, without touching the database. `refs` carries the rows
 * that must already exist (from `npm run seed`), `dueFor` gives the SLA dues of a batch.
 */
export async function buildDemoData(refs, dueFor, now = new Date()) {
  const { ab, qualification, admin, assessor, proctor, assessorUser, proctorUser } = refs;
  const nos = qualification.nos[0];
  const pc = nos.pcs[0];

  const tps = [
    {
      code: "DEMO-TP-NORTH",
      name: "Northern Skills Academy",
      email: "north.tp@example.com",
      active: true,
    },
    {
      code: "DEMO-TP-SOUTH",
      name: "Southern Skills Institute",
      email: "south.tp@example.com",
      active: true,
    },
  ];
  const centres = [
    {
      code: "DEMO-CTR-DEL",
      name: "Delhi Skill Centre",
      state: "NCT of Delhi",
      tp: 0,
      active: true,
    },
    {
      code: "DEMO-CTR-LKO",
      name: "Lucknow Training Hub",
      state: "Uttar Pradesh",
      tp: 0,
      active: true,
    },
    { code: "DEMO-CTR-BLR", name: "Bengaluru Skill Park", state: "Karnataka", tp: 1, active: true },
  ];

  // Question bank. Approved English and Hindi, plus some still in draft, in review, and retired.
  const mk = (i, lang, [stem, options, answer], status) => ({
    _id: oid(K.question, i),
    qualificationId: qualification._id,
    nosId: nos.nosId,
    pcId: pc.pcId,
    type: "mcq",
    language: lang,
    difficulty: ["easy", "medium", "tough"][i % 3],
    stem,
    options: options.map((text, k) => ({ key: KEYS[k], text })),
    correctAnswer: KEYS[answer],
    marks: 1,
    status,
    version: 1,
    rootQuestionId: null,
    previousVersionId: null,
    isLatest: true,
    createdBy: admin._id,
    approvedBy: status === "approved" || status === "retired" ? admin._id : null,
    approvedAt: status === "approved" || status === "retired" ? now : null,
    retiredBy: status === "retired" ? admin._id : null,
    retiredAt: status === "retired" ? now : null,
  });
  const questions = [];
  ENGLISH.forEach((q, i) => {
    const status = i < 14 ? "approved" : i < 16 ? "in_review" : i < 19 ? "draft" : "retired";
    questions.push(mk(i, "English", q, status));
  });
  HINDI.forEach((q, i) => questions.push(mk(100 + i, "Hindi", q, "approved")));
  const bank = new Map(questions.map((q) => [String(q._id), q]));
  const englishApproved = questions.filter(
    (q) => q.language === "English" && q.status === "approved",
  );
  const hindiApproved = questions.filter((q) => q.language === "Hindi");

  const paperBase = {
    qualificationId: qualification._id,
    poolHash: "demo-full",
    shortages: [],
    marksTargetMet: true,
    complete: true,
    createdBy: admin._id,
  };
  const papers = [
    {
      ...paperBase,
      _id: oid(K.paper, 1),
      name: "Electrician L4 theory (English)",
      status: "approved",
      seed: 11,
      rules: { language: "English", totalMarks: 10, quotas: [] },
      items: paperItems(englishApproved.slice(0, 10)),
      totalMarks: 10,
      durationMinutes: 20,
      approvedBy: admin._id,
      approvedAt: now,
    },
    {
      ...paperBase,
      _id: oid(K.paper, 2),
      name: "Electrician L4 theory (Hindi)",
      status: "approved",
      seed: 12,
      rules: { language: "Hindi", totalMarks: 10, quotas: [] },
      items: paperItems(hindiApproved),
      totalMarks: 10,
      durationMinutes: 20,
      approvedBy: admin._id,
      approvedAt: now,
    },
    {
      ...paperBase,
      _id: oid(K.paper, 3),
      name: "Electrician L4 theory (English, draft)",
      status: "draft",
      seed: 13,
      rules: { language: "English", totalMarks: 8, quotas: [] },
      items: paperItems(englishApproved.slice(2, 10)),
      totalMarks: 8,
      durationMinutes: 15,
    },
  ];
  const [paperEn, paperHi] = papers;

  // 30 students.
  const learners = Array.from({ length: 30 }, (_, i) => ({
    _id: oid(K.learner, i + 1),
    name: `${FIRST[i]} ${LAST[i % LAST.length]}`,
    externalRef: `DEMO-${String(i + 1).padStart(4, "0")}`,
    phone: `90000${String(10000 + i)}`,
    accommodations: [],
    active: true,
  }));
  const loginIds = learners.map((l) => generatedLoginId(l));

  // Batches. Learner index ranges are [from, to).
  const day = (n) => istDate(n);
  const batchSpecs = [
    {
      n: 1,
      status: "allocated",
      tp: 0,
      centre: 0,
      type: "STT",
      mode: "offline",
      lang: "English",
      range: [0, 5],
      start: day(25),
      end: day(26),
      allocatedAgoDays: 1,
    },
    {
      n: 2,
      status: "accepted",
      tp: 0,
      centre: 1,
      type: "STT",
      mode: "offline",
      lang: "Hindi",
      range: [5, 10],
      start: day(18),
      end: day(19),
      allocatedAgoDays: 6,
    },
    {
      n: 3,
      status: "assessor_assigned",
      tp: 1,
      centre: 2,
      type: "STT",
      mode: "blended",
      lang: "English",
      range: [10, 15],
      start: day(8),
      end: day(9),
      allocatedAgoDays: 12,
      assessor: true,
    },
    {
      n: 4,
      status: "in_progress",
      tp: 0,
      centre: 0,
      type: "STT",
      mode: "online",
      lang: "English",
      range: [15, 23],
      start: day(-1),
      end: day(14),
      allocatedAgoDays: 20,
      assessor: true,
      proctor: true,
      papers: true,
    },
    {
      n: 5,
      status: "assessment_completed",
      tp: 1,
      centre: 2,
      type: "LTT",
      mode: "online",
      lang: "English",
      range: [23, 30],
      start: day(-15),
      end: day(-14),
      allocatedAgoDays: 35,
      assessor: true,
      proctor: true,
      paper: true,
    },
  ];
  const batches = [];
  const candidates = [];
  for (const spec of batchSpecs) {
    const id = oid(K.batch, spec.n);
    const allocatedAt = new Date(now.getTime() - spec.allocatedAgoDays * 86400000);
    const dues = await dueFor({ type: spec.type, start: spec.start, end: spec.end, allocatedAt });
    const [from, to] = spec.range;
    batches.push({
      _id: id,
      abId: ab._id,
      qualificationId: qualification._id,
      type: spec.type,
      mode: spec.mode,
      assessmentStartDate: spec.start,
      assessmentEndDate: spec.end,
      tpSlot: spec.tp,
      centreSlot: spec.centre,
      candidateCount: to - from,
      sector: qualification.sector,
      ratioClass: qualification.ratioClass,
      assessmentLanguage: spec.lang,
      status: spec.status,
      statusVersion: 1,
      isReassessment: false,
      firstAssessmentBatchId: id,
      assessorId: spec.assessor ? assessor._id : null,
      proctorId: spec.proctor ? proctor._id : null,
      testPaperId: spec.paper || spec.papers ? paperEn._id : null,
      languagePapers: spec.papers ? [{ language: "Hindi", testPaperId: paperHi._id }] : [],
      settings: spec.papers
        ? { languages: { theory: true, practical: false, viva: false } }
        : undefined,
      sla: {
        acceptDueAt: dues.acceptDueAt,
        assignDueAt: dues.assignDueAt,
        resultDueAt: dues.resultDueAt,
        breached: [],
        lateActions: [],
      },
      accommodations: [],
      allocatedAt,
    });
    for (let i = from; i < to; i += 1) {
      candidates.push({
        batchId: id,
        learnerId: learners[i]._id,
        name: learners[i].name,
        externalRef: learners[i].externalRef,
        accommodations: [],
        active: true,
        learnerNo: i,
      });
    }
  }

  // Attempts: batch 4 has a mix (running, finished, in Hindi), batch 5 is all finished.
  const attempts = [];
  const sessions = [];
  const flags = [];
  const flagKinds = [
    ["tab_hidden", "low"],
    ["window_blur", "low"],
    ["fullscreen_exit", "medium"],
    ["looking_away", "medium"],
    ["multiple_faces", "high"],
    ["phone_detected", "high"],
    ["face_not_present", "medium"],
  ];
  let attemptNo = 0;
  const makeAttempt = (cand, paper, userId, state, skill, batchId, minutesAgo) => {
    attemptNo += 1;
    const startedAt = new Date(now.getTime() - minutesAgo * 60000);
    const durationMinutes = paper.durationMinutes;
    const deadlineAt = new Date(startedAt.getTime() + durationMinutes * 60000);
    const answered = paper.items.map((item, qi) => {
      const answer = pickAnswer(bank.get(String(item.questionId)), cand.learnerNo, qi, skill);
      return {
        questionId: item.questionId,
        version: 1,
        nosId: item.nosId,
        pcId: item.pcId,
        type: "mcq",
        marks: item.marks,
        answer: state === "in_progress" && qi >= 5 ? null : answer,
        answeredAt: state === "in_progress" && qi >= 5 ? null : startedAt,
        awardedMarks: null,
        scoreStatus: "pending",
        scoredBy: null,
      };
    });
    const doc = {
      _id: oid(K.attempt, attemptNo),
      testPaperId: paper._id,
      batchId,
      abId: ab._id,
      candidateId: cand.candidateId,
      learnerId: cand.learnerId,
      userId,
      status: state,
      durationMinutes,
      graceSeconds: 30,
      startedAt,
      deadlineAt,
      acceptUntil: new Date(deadlineAt.getTime() + 30000),
      closedAt:
        state === "in_progress"
          ? null
          : new Date(startedAt.getTime() + (durationMinutes - 4) * 60000),
      closeReason: state === "in_progress" ? null : "submit",
      shuffleOptions: false,
      questions: answered,
      scores: null,
      rev: 1,
    };
    if (state !== "in_progress") Object.assign(doc, scoreAttempt(answered, bank));
    return doc;
  };

  const candidateRows = candidates.map((c, idx) => ({ ...c, idx }));
  // The candidate ids and user ids are created at write time; assign them now so rows can link.
  for (const c of candidateRows) {
    c.candidateId = new mongoose.Types.ObjectId(
      `66f0d0${"07"}${(c.learnerNo + 1).toString(16).padStart(16, "0")}`,
    );
  }
  const userIdFor = (learnerNo) =>
    new mongoose.Types.ObjectId(`66f0d0${"08"}${(learnerNo + 1).toString(16).padStart(16, "0")}`);

  const inBatch = (n) => candidateRows.filter((c) => c.batchId.equals(oid(K.batch, n)));
  const live = inBatch(4);
  // Batch 4: students 1-3 finished in English, student 4 finished in Hindi, 5 is mid-exam, others not started.
  const plan4 = [
    [0, paperEn, "submitted", 0.85, 70],
    [1, paperEn, "submitted", 0.6, 65],
    [2, paperEn, "submitted", 0.35, 62],
    [3, paperHi, "submitted", 0.75, 60],
    [4, paperEn, "in_progress", 0.7, 8],
  ];
  const batch4 = oid(K.batch, 4);
  for (const [i, paper, state, skill, minutesAgo] of plan4) {
    const c = live[i];
    attempts.push(makeAttempt(c, paper, userIdFor(c.learnerNo), state, skill, batch4, minutesAgo));
  }
  const batch5 = oid(K.batch, 5);
  inBatch(5).forEach((c, i) => {
    const skill = [0.9, 0.8, 0.7, 0.55, 0.45, 0.3, 0.75][i];
    attempts.push(
      makeAttempt(
        c,
        paperEn,
        userIdFor(c.learnerNo),
        "submitted",
        skill,
        batch5,
        60 * 24 * 14 + 30 + i,
      ),
    );
  });

  // Proctoring for every attempt of batch 4 (running and finished). Flag mix depends on the student.
  const flagPlan = { 0: [0], 1: [1, 2, 3], 2: [2, 4, 5, 3, 0], 3: [6, 1], 4: [0, 3] };
  attempts
    .filter((a) => a.batchId.equals(batch4))
    .forEach((a, i) => {
      const sessionId = oid(K.session, i + 1);
      const kinds = (flagPlan[i] ?? []).map((k) => flagKinds[k]);
      const counts = { low: 0, medium: 0, high: 0 };
      const rows = kinds.map(([type, severity], fi) => {
        counts[severity] += 1;
        const clientEventId = `demo-${i + 1}-${fi + 1}`;
        const capturedAt = new Date(a.startedAt.getTime() + (fi + 1) * 3 * 60000);
        return {
          sessionId,
          attemptId: a._id,
          batchId: a.batchId,
          abId: ab._id,
          clientEventId,
          type,
          severity,
          capturedAt,
          receivedAt: new Date(capturedAt.getTime() + 2000),
          detail: null,
          evidenceId: null,
          location: null,
          questionId: a.questions[fi % a.questions.length].questionId,
          questionNumber: (fi % a.questions.length) + 1,
          answerAtFlag: null,
          locationStatus: "not_shared",
          payloadHash: crypto.createHash("sha256").update(clientEventId).digest("hex"),
          review: null,
        };
      });
      flags.push(...rows);
      sessions.push({
        _id: sessionId,
        attemptId: a._id,
        batchId: a.batchId,
        abId: ab._id,
        candidateId: a.candidateId,
        learnerId: a.learnerId,
        userId: a.userId,
        lastSeenAt: a.status === "in_progress" ? now : a.closedAt,
        snapshotIntervalSeconds: 30,
        periodicImagesOff: false,
        policyFlagCount: counts.medium + counts.high,
        flagCounts: counts,
        warnings: [],
      });
    });

  return {
    tps,
    centres,
    questions,
    papers,
    learners,
    loginIds,
    batches,
    candidates: candidateRows.map(({ learnerNo: _n, idx: _i, ...rest }) => rest),
    userIdFor,
    attempts,
    sessions,
    flags,
    refs: { assessorUser, proctorUser },
  };
}

async function load() {
  const [ab, qualification, admin, assessor, proctor, assessorUser, proctorUser] =
    await Promise.all([
      AwardingBody.findOne({ code: "AB-SAMPLE" }).lean(),
      Qualification.findOne({ code: QUALIFICATION_CODE }).lean(),
      User.findOne({ email: "admin@aa.example" }).lean(),
      Assessor.findOne({ code: "ASR-SAMPLE" }).lean(),
      Proctor.findOne({ code: "PRC-SAMPLE" }).lean(),
      User.findOne({ email: "assessor@aa.example" }).lean(),
      User.findOne({ email: "proctor@aa.example" }).lean(),
    ]);
  if (!ab || !qualification || !admin || !assessor || !proctor) {
    throw new Error("Run `npm run seed -w server` first");
  }
  return { ab, qualification, admin, assessor, proctor, assessorUser, proctorUser };
}

export async function seedDemoFull({ nodeEnv = env.NODE_ENV } = {}) {
  assertSeedAllowed(nodeEnv);
  const refs = await load();
  const data = await buildDemoData(refs, async ({ type, start, end, allocatedAt }) =>
    slaDueAtCreation({
      type,
      assessmentStartDate: start,
      assessmentEndDate: end,
      allocatedAt,
    }),
  );

  // Clear the earlier demo run, then rebuild.
  const batchIds = data.batches.map((b) => b._id);
  const learnerIds = data.learners.map((l) => l._id);
  const oldAttempts = await Attempt.find({ batchId: { $in: batchIds } }, "_id").lean();
  await ProctoringFlag.deleteMany({ attemptId: { $in: oldAttempts.map((a) => a._id) } });
  await ProctoringSession.deleteMany({ batchId: { $in: batchIds } });
  await Attempt.deleteMany({ batchId: { $in: batchIds } });
  await Candidate.deleteMany({ batchId: { $in: batchIds } });
  await Batch.deleteMany({ _id: { $in: batchIds } });
  await User.deleteMany({ role: "candidate", linkedProfileId: { $in: learnerIds } });
  await Learner.deleteMany({ _id: { $in: learnerIds } });
  await Question.deleteMany({ _id: { $in: data.questions.map((q) => q._id) } });
  await TestPaper.deleteMany({ _id: { $in: data.papers.map((p) => p._id) } });

  const tpRows = [];
  for (const spec of data.tps) {
    tpRows.push(
      await TrainingPartner.findOneAndUpdate(
        { code: spec.code },
        { $set: spec },
        { upsert: true, new: true },
      ).lean(),
    );
  }
  const centreRows = [];
  for (const { tp, ...spec } of data.centres) {
    centreRows.push(
      await Centre.findOneAndUpdate(
        { code: spec.code },
        { $set: { ...spec, tpId: tpRows[tp]._id } },
        { upsert: true, new: true },
      ).lean(),
    );
  }

  await Question.insertMany(data.questions);
  for (const paper of data.papers) await TestPaper.create(paper);
  await Learner.insertMany(data.learners);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const [i, learner] of data.learners.entries()) {
    // A login for every student; the first password is stored so the student list can show it.
    await User.create({
      _id: data.userIdFor(i),
      email: data.loginIds[i],
      name: learner.name,
      role: "candidate",
      passwordHash,
      initialPassword: DEMO_PASSWORD,
      active: true,
      mustChangePassword: false,
      linkedProfileId: learner._id,
    });
  }

  for (const b of data.batches) {
    const { tpSlot, centreSlot, ...rest } = b;
    const centre = centreRows[centreSlot];
    await Batch.create({
      ...rest,
      tpId: tpRows[tpSlot]._id,
      centreId: centre._id,
      state: centre.state,
    });
  }
  await Candidate.insertMany(
    data.candidates.map(({ candidateId, ...c }) => ({ _id: candidateId, ...c })),
  );
  await Attempt.insertMany(data.attempts);
  await ProctoringSession.insertMany(data.sessions);
  for (const flag of data.flags) await ProctoringFlag.create(flag);

  return {
    students: data.learners.length,
    questions: data.questions.length,
    papers: data.papers.length,
    batches: data.batches.length,
    attempts: data.attempts.length,
    flags: data.flags.length,
    firstLogin: data.loginIds[0],
    liveBatchLogins: data.loginIds.slice(15, 20),
  };
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
      const out = await seedDemoFull();
      console.log(
        `Full demo ready: ${out.students} students, ${out.questions} questions, ${out.papers} papers, ${out.batches} batches, ${out.attempts} exam attempts, ${out.flags} proctoring flags.`,
      );
      console.log(`Student password for all demo students: ${DEMO_PASSWORD}`);
      console.log(
        `Example student sign-in ids (batch in progress): ${out.liveBatchLogins.join(", ")}`,
      );
      console.log("Staff logins are from `npm run seed` (admin@aa.example, etc.).");
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
