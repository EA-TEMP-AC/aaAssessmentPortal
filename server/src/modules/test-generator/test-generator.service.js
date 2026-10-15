import { createHash, randomInt } from "node:crypto";
import mongoose from "mongoose";
import { AppError, notFound } from "../../lib/errors.js";
import { Qualification } from "../../models/qualification.model.js";
import { Question } from "../../models/question.model.js";
import { TestPaper } from "../../models/test-paper.model.js";
import { createRng, shuffle } from "./seeded-random.js";

async function findQualification(ref) {
  let qual = null;
  if (mongoose.Types.ObjectId.isValid(ref)) qual = await Qualification.findById(ref);
  if (!qual) qual = await Qualification.findOne({ code: String(ref).trim() });
  if (!qual) {
    throw new AppError(404, "QUALIFICATION_NOT_FOUND", `Qualification '${ref}' not found`);
  }
  return qual;
}

/** Quotas in a fixed order (NOS order on the qualification, then type) with NOS ids resolved. */
function canonicalQuotas(qual, quotas) {
  const nosList = (qual.nos || []).map((n) => n.nosId || n.code);
  const seen = new Set();
  const typed = new Set();
  const untyped = new Set();
  const out = quotas.map((q) => {
    const wanted = q.nosId.toLowerCase();
    const nos = (qual.nos || []).find(
      (n) => (n.nosId || "").toLowerCase() === wanted || (n.code || "").toLowerCase() === wanted,
    );
    if (!nos) {
      throw new AppError(400, "NOS_NOT_FOUND", `NOS '${q.nosId}' not found on '${qual.code}'`);
    }
    const nosId = nos.nosId || nos.code;
    const type = q.type ?? null;
    const key = `${nosId}|${type ?? ""}`;
    if (seen.has(key)) {
      throw new AppError(
        400,
        "DUPLICATE_QUOTA",
        `Two quotas for NOS '${nosId}' and type '${type}'`,
      );
    }
    seen.add(key);
    (type ? typed : untyped).add(nosId);
    return { nosId, type, count: q.count };
  });
  for (const id of untyped) {
    if (typed.has(id)) {
      throw new AppError(
        400,
        "OVERLAPPING_QUOTAS",
        `NOS '${id}' has both an any-type quota and a per-type quota`,
      );
    }
  }
  return out.sort(
    (a, b) =>
      nosList.indexOf(a.nosId) - nosList.indexOf(b.nosId) ||
      String(a.type ?? "").localeCompare(String(b.type ?? "")),
  );
}

/** Approved, latest, non-retired questions of one qualification and language, in a stable order. */
async function loadPool(qualificationId, language) {
  const docs = await Question.find({
    qualificationId,
    language,
    status: "approved",
    isLatest: true,
  })
    .select("rootQuestionId version nosId pcId type marks")
    .lean();
  const byRoot = new Map();
  for (const d of docs) {
    const root = String(d.rootQuestionId || d._id);
    const prev = byRoot.get(root);
    if (!prev || d.version > prev.version) byRoot.set(root, d);
  }
  return [...byRoot.values()].sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

function hashPool(pool) {
  const h = createHash("sha256");
  for (const q of pool) h.update(`${q._id}:${q.version}\n`);
  return h.digest("hex");
}

/**
 * Pure selection. Same pool, quotas and seed give the same items.
 * Inside a quota the PCs are visited round-robin in a seeded order, so every PC with a
 * question is covered before any PC is used twice. A question is never taken twice.
 */
export function selectQuestions(pool, quotas, seed) {
  const rng = createRng(seed);
  const used = new Set();
  const items = [];
  const shortages = [];
  for (const quota of quotas) {
    const candidates = pool.filter(
      (q) => q.nosId === quota.nosId && (!quota.type || q.type === quota.type),
    );
    const byPc = new Map();
    for (const q of candidates) {
      if (used.has(String(q._id))) continue;
      if (!byPc.has(q.pcId)) byPc.set(q.pcId, []);
      byPc.get(q.pcId).push(q);
    }
    const pcOrder = shuffle([...byPc.keys()].sort(), rng);
    const queues = new Map(pcOrder.map((pc) => [pc, shuffle(byPc.get(pc), rng)]));
    let taken = 0;
    while (taken < quota.count) {
      let progressed = false;
      for (const pc of pcOrder) {
        if (taken >= quota.count) break;
        const next = queues.get(pc).shift();
        if (!next) continue;
        used.add(String(next._id));
        items.push({
          questionId: next._id,
          rootQuestionId: next.rootQuestionId || next._id,
          version: next.version,
          nosId: next.nosId,
          pcId: next.pcId,
          type: next.type,
          marks: next.marks,
        });
        taken += 1;
        progressed = true;
      }
      if (!progressed) break;
    }
    if (taken < quota.count) {
      shortages.push({
        nosId: quota.nosId,
        type: quota.type,
        requested: quota.count,
        available: taken,
      });
    }
  }
  return { items, shortages };
}

const sumMarks = (items) => Math.round(items.reduce((s, i) => s + i.marks, 0) * 100) / 100;

export async function generatePaper(user, input) {
  const qual = await findQualification(input.qualificationId);
  const language = input.language.trim().toLowerCase();
  const quotas = canonicalQuotas(qual, input.quotas);
  const seed = input.seed ?? randomInt(0, 4294967296);

  const pool = await loadPool(qual._id, language);
  const { items, shortages } = selectQuestions(pool, quotas, seed);
  const totalMarks = sumMarks(items);
  const target = input.totalMarks ?? null;
  const marksTargetMet = target === null || totalMarks === target;
  const complete = shortages.length === 0 && marksTargetMet;

  if (!complete && !input.allowPartial) {
    throw new AppError(
      422,
      shortages.length > 0 ? "TEST_BANK_SHORTAGE" : "TEST_MARKS_TARGET_NOT_MET",
      shortages.length > 0
        ? "The question bank has too few approved questions for the rules"
        : `Selected marks are ${totalMarks}, target is ${target}`,
      { shortages, totalMarks, targetMarks: target },
    );
  }

  return TestPaper.create({
    qualificationId: qual._id,
    status: "draft",
    seed,
    rules: { language, totalMarks: target, quotas },
    poolHash: hashPool(pool),
    items,
    totalMarks,
    shortages,
    marksTargetMet,
    complete,
    createdBy: user._id,
  });
}

export async function listPapers(filters) {
  const query = {};
  if (filters.qualificationId) {
    if (mongoose.Types.ObjectId.isValid(filters.qualificationId)) {
      query.qualificationId = filters.qualificationId;
    } else {
      const q = await Qualification.findOne({ code: filters.qualificationId }).select("_id");
      if (!q) return { items: [], total: 0, page: filters.page, pageSize: filters.pageSize };
      query.qualificationId = q._id;
    }
  }
  if (filters.status) query.status = filters.status;
  const [total, items] = await Promise.all([
    TestPaper.countDocuments(query),
    TestPaper.find(query)
      .sort({ createdAt: -1 })
      .skip((filters.page - 1) * filters.pageSize)
      .limit(filters.pageSize)
      .select("-items")
      .lean(),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

async function loadPaper(id) {
  const paper = await TestPaper.findById(id);
  if (!paper) throw notFound("Test paper not found");
  return paper;
}

export async function getPaper(id, { withQuestions }) {
  const paper = await loadPaper(id);
  const out = paper.toObject();
  if (withQuestions) {
    const docs = await Question.find({ _id: { $in: paper.items.map((i) => i.questionId) } }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    out.items = out.items.map((i) => {
      const q = byId.get(String(i.questionId));
      return {
        ...i,
        stem: q?.stem ?? null,
        options: q?.options ?? [],
        correctAnswer: q?.correctAnswer ?? null,
      };
    });
  }
  return out;
}

/** Items whose stored question is no longer an approved, latest question. */
async function findStaleItems(paper) {
  const docs = await Question.find({ _id: { $in: paper.items.map((i) => i.questionId) } })
    .select("status isLatest version")
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const stale = [];
  for (const item of paper.items) {
    const q = byId.get(String(item.questionId));
    let reason = null;
    if (!q) reason = "missing";
    else if (q.status === "retired") reason = "retired";
    else if (q.status !== "approved") reason = "not_approved";
    else if (!q.isLatest) reason = "superseded";
    if (reason) stale.push({ questionId: item.questionId, reason });
  }
  return stale;
}

export async function approvePaper(user, id) {
  const paper = await loadPaper(id);
  if (paper.status === "approved") {
    throw new AppError(409, "TEST_ALREADY_APPROVED", "Test paper is already approved");
  }
  if (!paper.complete) {
    throw new AppError(
      409,
      "TEST_PAPER_INCOMPLETE",
      "A paper with a bank shortage or a missed marks target cannot be approved",
      { shortages: paper.shortages, totalMarks: paper.totalMarks },
    );
  }
  const stale = await findStaleItems(paper);
  if (stale.length > 0) {
    throw new AppError(
      409,
      "TEST_PAPER_STALE",
      "Some questions are no longer approved and current; generate a new paper",
      { stale },
    );
  }
  const before = paper.toObject();
  paper.status = "approved";
  paper.approvedBy = user._id;
  paper.approvedAt = new Date();
  await paper.save();
  return { paper, before };
}

/** Re-runs the selection with the stored seed and rules and compares with what was stored. */
export async function regenerateCheck(id) {
  const paper = await loadPaper(id);
  const pool = await loadPool(paper.qualificationId, paper.rules.language);
  const quotas = paper.rules.quotas.map((q) => ({ nosId: q.nosId, type: q.type, count: q.count }));
  const { items } = selectQuestions(pool, quotas, paper.seed);

  const key = (i) => `${i.questionId}:${i.version}`;
  const stored = paper.items.map(key);
  const again = items.map(key);
  const storedSet = new Set(stored);
  const againSet = new Set(again);
  const sameOrder = stored.length === again.length && stored.every((k, n) => k === again[n]);

  return {
    id: paper._id,
    seed: paper.seed,
    reproducible: sameOrder,
    poolUnchanged: hashPool(pool) === paper.poolHash,
    storedCount: stored.length,
    regeneratedCount: again.length,
    missing: stored.filter((k) => !againSet.has(k)),
    extra: again.filter((k) => !storedSet.has(k)),
    stale: await findStaleItems(paper),
  };
}
