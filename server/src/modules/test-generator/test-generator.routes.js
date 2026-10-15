import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { TEST_APPROVE_ROLES, TEST_GENERATE_ROLES, TEST_READ_ROLES } from "../../models/roles.js";
import { guardContentRead } from "../content-controls/content-guard.js";
import {
  generateSchema,
  getQuerySchema,
  idParamSchema,
  listQuerySchema,
} from "./test-generator.schemas.js";
import {
  approvePaper,
  generatePaper,
  getPaper,
  listPapers,
  regenerateCheck,
} from "./test-generator.service.js";

export const testGeneratorRouter = Router();

testGeneratorRouter.use(requireAuth);

/** Audit rows hold ids, seed, rules and counts. Never question text. */
function auditView(paper) {
  const p = typeof paper.toObject === "function" ? paper.toObject() : paper;
  return {
    qualificationId: p.qualificationId,
    status: p.status,
    seed: p.seed,
    rules: p.rules,
    items: (p.items || []).map((i) => ({ questionId: i.questionId, version: i.version })),
    totalMarks: p.totalMarks,
    shortages: p.shortages,
    complete: p.complete,
  };
}

/** POST /api/v1/tests/generate */
testGeneratorRouter.post(
  "/generate",
  requireRoles(...TEST_GENERATE_ROLES),
  asyncHandler(async (req, res) => {
    const body = generateSchema.parse(req.body);
    const paper = await generatePaper(req.user, body);
    req.audit = {
      action: "test.generate",
      entity: "testPaper",
      entityId: paper._id,
      after: auditView(paper),
      meta: { allowPartial: body.allowPartial === true },
    };
    res.status(201).json(paper);
  }),
);

/** GET /api/v1/tests */
testGeneratorRouter.get(
  "/",
  requireRoles(...TEST_READ_ROLES),
  asyncHandler(async (req, res) => {
    res.status(200).json(await listPapers(listQuerySchema.parse(req.query)));
  }),
);

/** POST /api/v1/tests/:id/approve */
testGeneratorRouter.post(
  "/:id/approve",
  requireRoles(...TEST_APPROVE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { paper, before } = await approvePaper(req.user, id);
    req.audit = {
      action: "test.approve",
      entity: "testPaper",
      entityId: paper._id,
      before: auditView(before),
      after: auditView(paper),
    };
    res.status(200).json(paper);
  }),
);

/** POST /api/v1/tests/:id/regenerate-check */
testGeneratorRouter.post(
  "/:id/regenerate-check",
  requireRoles(...TEST_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const result = await regenerateCheck(id);
    req.audit = {
      action: "test.regenerate_check",
      entity: "testPaper",
      entityId: id,
      meta: {
        reproducible: result.reproducible,
        poolUnchanged: result.poolUnchanged,
        staleCount: result.stale.length,
      },
    };
    res.status(200).json(result);
  }),
);

/** GET /api/v1/tests/:id  (?withQuestions=true adds stem, options and answer for these roles) */
testGeneratorRouter.get(
  "/:id",
  requireRoles(...TEST_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const query = getQuerySchema.parse(req.query);
    const withQuestions = query.withQuestions === "true";
    const paper = await getPaper(id, { withQuestions, itemPage: query.itemPage });
    await guardContentRead(req, {
      paperId: id,
      questionIds: withQuestions ? paper.items.map((i) => i.questionId) : [],
      kind: "detail",
    });
    res.status(200).json(paper);
  }),
);
