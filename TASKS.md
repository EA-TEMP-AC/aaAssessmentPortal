# TASKS
Status: todo | in_progress | review | done | blocked
Branch format: task/<ID>-<slug>. Agents update only their own rows.

## Phase 0: Foundation
| ID | Task | Owner | Depends | Status | Acceptance |
|---|---|---|---|---|---|
| A-01 | Full Mongo schema, indexes, enums, permission matrix; expand API_CONTRACT for Phase 1 | architect | - | review | Schema + Phase 1 contract examples. Branch: `task/A-01-schema-contract`. Review pass 3 applied (soft SLA, learners, reassign/cancel, result rules, TASKS split). |
| D-01 | Monorepo scaffold, lint, env examples, CI | backend | A-01 | todo | `npm test` runs in CI |

## Phase 1: Batch workflow and assessor
| ID | Task | Owner | Depends | Status | Acceptance |
|---|---|---|---|---|---|
| B-01 | Auth (login/refresh/logout), roles, mustChangePassword, login rate limits, audit middleware (redact secrets) | backend | D-01 | todo | Login/refresh works; every write logged; passwordHash never in audit |
| B-02 | compliance.js constants + working-day calculator + nightly sla.breached job | backend | D-01 | todo | Unit tests incl. holidays; §2.1 counting; non-retroactive holiday edits |
| B-03 | Batch CRUD + status machine (incl. cancelled) + soft SLA lateReason + CAS | backend | B-01,B-02 | todo | Illegal transitions 409; late without reason → SLA_*; with reason → breach+audit |
| B-04 | Assessor/proctor registry + ToA + assign/reassign + assessorDayLocks txn | backend | B-03 | todo | Clash/max-AAs/ratio/override tested; reassign releases/takes locks |
| B-05 | Results PUT/submit + server outcome + change log + RESULT_INCOMPLETE | backend | B-03,B-07 | todo | PUT only assessment_completed+draft; Absent from attendance; passMarkUnit |
| B-06 | Login-events (assessor/proctor/student) offline-safe; enqueue AB email; **emailQueue worker + retries** | backend | B-03,B-08 | todo | NCVET:TR s9,s26; email failure ≠ login failure; capturedAt in mail |
| B-07 | Master data APIs: awardingBodies, TP, centres, qualifications, learners; candidates POST/GET/PATCH/CSV | backend | B-01 | todo | CSV import links learners; deactivate candidate |
| B-08 | Users CRUD + password reset (mustChangePassword); GET batch login-events/attendance/checklist | backend | B-01 | todo | Contract examples pass |
| B-09 | Reassessment endpoint + cancel endpoint (lock release) | backend | B-03,B-04,B-05 | todo | REASSESS_NOT_ELIGIBLE; window from first assessment; inherit fields |
| F-01 | Web shell, login, mustChangePassword gate, role routing | frontend | B-01 | todo | |
| F-02 | Batch list/detail: SLA countdown, accept/reject/assign/reassign/cancel, lateReason UX | frontend | B-03,B-04 | todo | |
| F-03 | Assessor/proctor registry screens | frontend | B-04 | todo | |
| F-06 | Master data screens: AB, TP, centres, qualifications, learners | frontend | B-07 | todo | |
| F-07 | Result entry UI (NOS marks) + incompleteness warnings | frontend | B-05 | todo | |
| F-08 | AB validate/publish (+ change reason) screens | frontend | B-05 | todo | Scoped to abId |
| M-01 | Mobile login, offline queue, geo login/logout, lateSync | mobile | B-01 | todo | Airplane mode; sync later |
| M-02 | Attendance, ID check, equipment checklist | mobile | M-01 | todo | |
| M-03 | Student tracking + proctor geo-tag flows | mobile | M-01,B-06 | todo | Offline works |
| T-01 | Contract + rule tests for Phase 1 backend (B-01..B-09) | qa | B-05,B-09 | todo | Soft SLA, locks, reassessment, email queue |
| R-01 | Review each Phase 1 branch before merge | reviewer | each | todo | |

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
