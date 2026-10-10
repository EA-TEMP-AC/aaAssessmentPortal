# TASKS
Status: todo | in_progress | review | done | blocked
Branch format: task/<ID>-<slug>. Agents update only their own rows.

## Phase 0: Foundation
| ID | Task | Owner | Depends | Status | Acceptance |
|---|---|---|---|---|---|
| A-01 | Full Mongo schema, indexes, enums, permission matrix; expand API_CONTRACT for Phase 1 | architect | - | done | Schema + Phase 1 contract examples. Branch: `task/A-01-schema-contract` |
| A-02 | Refresh Phase 1 task graph, waves, ownership; add POST /batches/:id/complete | architect | A-01 | review | TASKS waves + deps; contract + schema for complete. Branch: `task/A-02-tasks-refresh` |
| D-01 | Monorepo scaffold, lint, env examples, CI | backend | A-01 | done | Workspaces server/web/mobile/tests; health GET /api/v1/health; docker-compose Mongo replica set; CI lint+test. Branch: `task/D-01-monorepo-scaffold` |

## Phase 1: Batch workflow and assessor
| ID | Task | Owner | Depends | Status | Acceptance |
|---|---|---|---|---|---|
| B-01 | Auth (login/refresh/logout), roles, mustChangePassword, login rate limits, audit middleware (redact secrets); GET /audit-logs; **dev seed (users only)** | backend | D-01 | review | Login/refresh works; every write logged; passwordHash never in audit; seed: **one user per role only**. Later tasks extend seed with their own sample data. Branch: `task/B-01-auth-audit`. Seed password: `SEED_PASSWORD` or documented default `Dev-Password-1` (seed users keep `mustChangePassword` false). Auth constants are in `compliance.js` for B-02 to extend. Audit field list is proposed in DECISIONS.md |
| B-02 | compliance.js constants + working-day calculator; GET\|PUT /admin/working-day-config; GET\|POST\|DELETE /admin/holidays | backend | D-01 | todo | Unit tests incl. holidays; SCHEMA §2.1 counting; non-retroactive holiday edits |
| B-03 | Batch CRUD + status machine (incl. cancelled) + soft SLA lateReason + CAS; **POST /batches/:id/complete**; **nightly sla.breached job**; GET /compliance/dashboard stub | backend | B-01,B-02,B-07a,B-08 | todo | Illegal transitions 409; late without reason → SLA_*; with reason → breach+audit; complete(reason) → assessment_completed + audit |
| B-04 | Assessor/proctor registry + ToA + assign/reassign + assessorDayLocks txn; seed sample assessor/proctor | backend | B-03 | todo | Clash/max-AAs/ratio/override tested; POST /batches/:id/reassign releases/takes locks |
| B-05 | Results PUT/submit + server outcome + change log + RESULT_INCOMPLETE; **POST validate/publish/dispute/resolve-dispute** | backend | B-03,B-06,B-07b | todo | PUT only assessment_completed+draft; Absent from attendance; passMarkUnit; AB validate/publish + dispute flows |
| B-06 | Login-events (assessor/proctor/student) offline-safe; **enqueue** AB login mail only (worker in B-08); GET batch login-events/attendance/checklist; **POST assessor attendance + checklist**; auto `assessor_assigned`→`in_progress` and checklist→`assessment_completed` | backend | B-03,B-04,B-07b,B-08 | todo | NCVET:TR s9,s26; enqueue never fails login; capturedAt in mail payload; no SMTP/worker ownership |
| B-07a | Master data APIs: awardingBodies, TP, centres, qualifications, learners; seed sample master data | backend | B-01 | todo | CRUD + contract examples |
| B-07b | Candidates POST/GET/PATCH/CSV + learner linking; seed sample roster | backend | B-03 | todo | CSV import links learners; deactivate candidate |
| B-08 | Users CRUD + password reset (mustChangePassword); **emailQueue + worker + retries + SMTP env config** | backend | B-01 | todo | Reset emails send via queue; SMTP via `.env.example`; no passwordHash in responses/audit |
| B-09 | Reassessment endpoint + cancel endpoint (lock release) | backend | B-03,B-04,B-05,B-07b | todo | REASSESS_NOT_ELIGIBLE; window from first assessment; inherit fields |
| F-01 | Web shell, login, mustChangePassword gate, role routing | frontend | B-01 | todo | |
| F-02 | Batch list/detail: SLA countdown, accept/reject/assign/reassign/cancel/complete, lateReason UX | frontend | B-03,B-04,B-07a | todo | |
| F-03 | Assessor/proctor registry screens | frontend | B-04 | todo | |
| F-06 | Master data screens: AB, TP, centres, qualifications, learners | frontend | B-07a | todo | |
| F-07 | Result entry UI (NOS marks) + incompleteness warnings | frontend | B-05 | todo | |
| F-08 | AB validate/publish (+ change reason) screens | frontend | B-05 | todo | Scoped to abId |
| F-09 | Users management (CRUD + password reset UX) | frontend | B-08 | todo | Reset-email UX assumes B-08 queue/SMTP |
| F-10 | Candidate roster + CSV import | frontend | B-07b | todo | |
| F-11 | Audit-log viewer | frontend | B-01 | todo | Scoped per role |
| F-12 | Holidays / working-day settings | frontend | B-02 | todo | |
| M-01 | Mobile login, offline queue, geo login/logout, lateSync against **mocked** login-event APIs | mobile | B-01 | todo | Airplane mode; queue persists; mocks: `POST /assessor/login-event`, `POST /proctor/login-event`, `POST /student/login-event` (real sync in M-02) |
| M-02 | Attendance, ID check, equipment checklist; **download assigned batch + roster for offline use**; verify real login-event sync against B-06 | mobile | M-01,B-06 | todo | Offline: batch+roster cached; queue drains to live endpoints |
| M-03 | Student tracking + proctor geo-tag flows | mobile | M-01,B-06 | todo | Offline works |
| T-01 | Contract + rule tests for Phase 1 backend (B-01..B-09, incl. B-07a/B-07b) | qa | B-05,B-06,B-07a,B-07b,B-08,B-09 | todo | Soft SLA, locks, reassessment, email queue; cross-cutting/e2e (each task still writes its own tests) |
| R-01 | Review each Phase 1 branch before merge | reviewer | each | todo | |

## Suggested run order (Phase 1)

At most **one in-flight task per folder** (`server/`, `web/`, `mobile/`, `tests/`). Tasks listed in the same wave may start together. `R-01` reviews each branch before merge (not a wave of its own).

| Wave | Tasks |
|---|---|
| W1 | D-01 |
| W2 | B-01 |
| W3 | B-02, F-01, M-01 |
| W4 | B-08, F-11 |
| W5 | B-07a, F-09 |
| W6 | B-03, F-06 |
| W7 | B-04, F-12 |
| W8 | B-07b, F-02 |
| W9 | B-06, F-03 |
| W10 | B-05, F-10, M-02 |
| W11 | B-09, F-07, M-03 |
| W12 | F-08, T-01 |

Phase 2+ follow the Depends column with the same one-folder-at-a-time rule.

## Phase 2: Question bank, engine, evidence (NCVET:TR s4-s5, s13-s17)
| ID | Task | Owner | Depends | Status | Acceptance |
|---|---|---|---|---|---|
| Q-01 | Question bank model + CRUD + import (xlsx), NOS/PC mapping, MCQ/short answer/scenario/viva/practical, language field | backend | B-03 | todo | Bank coverage endpoint flags PCs under 5 Q average |
| Q-02 | Auto difficulty classification (easy/medium/tough) from attempt data + per-question usage report | backend | Q-01,E-03 | todo | TR s13 |
| Q-03 | Flag mostly-wrong questions + notify AB/TP | backend | Q-02 | todo | |
| Q-04 | Review cycles with AB + periodic upgrade reminders | backend | Q-01 | todo | |
| Q-05 | Per-sector coverage check (>=5% of NQR qualifications), sector config + NQR CSV import | backend | Q-01 | todo | One row per sector applied for |
| E-01 | Auto test generator: qualification>NOS>PC, random selection | backend | Q-01 | todo | Seeded randomness for audit |
| E-02 | Difficulty + Bloom weight config per assessment (set with AB) | backend | E-01 | todo | Weights stored, versioned |
| E-03 | Attempt engine: deliver, answer, submit, score | backend | E-01 | todo | |
| E-04 | Content refresh mechanism (retire/replace questions, version tests) | backend | E-03 | todo | |
| E-05 | Offline assessment package: download, answer offline, sync | mobile | E-03 | todo | TR s12 |
| E-06 | Simulator integration hook for blended mode (interface only) | backend | E-03 | todo | Only if required by qualification |
| V-01 | Evidence vault: upload with sha256, GPS, timestamp, index by candidate/batch/date/location | backend | B-03 | todo | |
| V-02 | Evidence browser UI | frontend | V-01 | todo | |
| F-04 | Question bank screens, coverage, usage report | frontend | Q-01..Q-03 | todo | |
| F-05 | Test builder + attempt UI (candidate) | frontend | E-03 | todo | |
| T-02 | Tests for Phase 2 rules | qa | Q-01..E-05 | todo | |
| R-02 | Review Phase 2 branches | reviewer | each | todo | |

## Phase 3: Proctoring, analytics, ERF, website, PwD, security
| ID | Task | Owner | Depends | Status | Acceptance |
|---|---|---|---|---|---|
| P-01 | Proctoring session model, audio+video recording storage | backend | V-01 | todo | TR s6 |
| P-02 | Live feed, random photo capture at intervals | backend+frontend | P-01 | todo | TR s8; interval configurable |
| P-03 | Candidate verification (photo check, mismatch flag) behind a replaceable interface | backend | P-01 | todo | Vendor choice open, DECISIONS Q5 |
| P-05 | Camera-blocked/tamper detection (black/covered/frozen feed) | backend | P-01 | todo | Sustained for N seconds raises high flag; thresholds configurable |
| P-06 | Second-person and background-person detection; second-voice detection | backend | P-01 | todo | Flags have media ref; tested with sample clips |
| P-07 | Device/object detection (phone, earphone, book, extra screen) | backend | P-01 | todo | Model behind replaceable interface |
| P-08 | Human review queue + decisions (dismiss/warn/invalidate) + candidate warnings | backend+frontend | P-04 | todo | No auto-invalidation; all decisions audit logged |
| P-04 | Malpractice detection hooks, record + flag, proctor report | backend | P-01 | todo | TR s7 |
| N-01 | Analytics API + graphs: assessor, TP, job role, state, date range | backend+frontend | B-05 | todo | TR s10 |
| C-01 | ERF score tracker (+4/-1/-2/-4, max 400, grades) and risk plan | backend | B-05 | todo | Full sub-parameters need Annexure IX |
| C-02 | DEP export | backend | C-01 | todo | Blocked until format known |
| W-01 | Public site data model + admin CRUD (team, organogram, assessors, proctors, sample papers, industry linkages, grievance, POSH, office docs) | backend | B-04 | todo | TR s22 |
| W-02 | Public website frontend + monthly calendar | frontend | W-01 | todo | |
| X-01 | Accommodations model + accessible question variants | backend | Q-01 | todo | TR s23 |
| X-02 | Accessible result publishing (formats) | backend+frontend | B-05 | todo | |
| X-03 | Accessibility pass on web UI (keyboard, screen reader, contrast) | frontend | F-* | todo | Also satisfies TR s21 usability |
| S-03 | Learner repository export interface: versioned export + scoped read-only credentials, all access audit-logged | backend | B-05,S-01 | todo | TR s25; export schema documented in docs/ |
| S-01 | Encryption at rest, access logging, retention, DPDP checklist | backend | B-01 | todo | TR s18-s20 |
| S-02 | Security audit tracker + content-theft controls (watermarking, no bulk export, signed URLs) | backend | S-01 | todo | "Zero content theft" is a goal; track audits |
| T-03 | Phase 3 tests | qa | all P,N,C,W,X,S | todo | |
| R-03 | Review Phase 3 branches | reviewer | each | todo | |
