# CLAUDE.md: rules for every Claude Code window on this repo

Project: NCVET-compliant Assessment Agency portal (Node 20 + Express + MongoDB server, React + Vite web, Expo mobile). Read PLAN.md first. The owner is an IT coordinator who does not write code; the reviewer and integrator is a separate Claude chat that merges your branch. Keep answers short and plain.

## Read before you start
PLAN.md, TASKS.md (your row), API_CONTRACT.md, docs/SCHEMA.md, DECISIONS.md (accepted entries and the dated human decisions at the end of each section), and the nearest existing module so you copy its patterns (zod schemas, audit, roles in server/src/models/roles.js, error codes, tests).

## Branch and git rules
- One task per branch, named `task/<ID>-<slug>`. Work in your own git worktree folder; never two tasks in one folder.
- Run `git branch --show-current` before every commit and make sure it is your task branch. Never commit to main, never push to main, never merge, never rebase shared branches, never force push.
- Pull main before you start. Commit in small steps with clear messages. Push the task branch when done.
- Do not commit untracked files you did not create (for example PDFs in the repo root, node_modules links).

## Task bookkeeping
- Set only your own row in TASKS.md. Use `review` when finished. Never set `done`.
- If the task row does not exist yet, add it in the right phase table.
- New open questions go in DECISIONS.md under "Open questions", numbered from the number given in your prompt (each parallel task has its own range, so numbers never collide). One entry per question: bold title, what you did, what you need confirmed.
- Never change another task's rows, and do not edit accepted decisions.

## Code rules
- Do what the task asks and nothing else. If you find a bug outside your task, do not fix it silently: add an `it.todo` or a skipped test with a comment and list it in your summary.
- Server: ESM, zod validation, every write audited with before and after, no secrets, tokens, passwords, personal data or question text in audit rows. Roles come from server/src/models/roles.js. Errors use the existing error code style.
- Never accept or store national ID numbers (Aadhaar, PAN, voter id, passport). Reject unknown request keys.
- Dates are IST. Working-day rules and SLA constants live in server/src/config/compliance.js.
- Web: React + TypeScript, Testing Library tests, keyboard and screen-reader friendly, show loading, empty and error states, never show or store passwords or tokens in the page.
- Update API_CONTRACT.md and docs/SCHEMA.md for every API or model change.

## Checks before you finish
- Server work: `npm run lint -w server`, then `npm test -w server` (full suite, once).
- Web work: `npm run lint -w web`, then `npm test -w web`.
- Mobile work: `npm run lint -w mobile`, then `npm test -w mobile`.
- If a database test cannot run in your environment, say so; do not skip tests to make a run pass.
- Do not run `npm audit fix` (especially not with `--force`) and do not upgrade packages unless your task says so.

## Final report (always)
Reply with: branch name, pushed commit hash, lint and test counts, what you built in a few lines, the calls you made that need confirming (with the DECISIONS.md numbers), and anything you did not cover.
