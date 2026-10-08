# PLAN: Assessment Agency Compliance Platform

Sources: docs/FEATURE_REPORT.md and docs/TECH_REQUIREMENTS.pdf (traceability in docs/TRACEABILITY.md) (NCVET Guidelines for Recognition and Regulation of Assessment Agencies, June 2025). Flow: docs/aa_assessment_app_flow.png. Reference UX from a competitor demo: docs/REFERENCE_DEMO_NOTES.md.

## Repo layout
/server  Node + Express + MongoDB API
/web     React admin and portals
/mobile  React Native assessor app
/tests   contract + e2e tests
/docs    reports, notes

## Proposed stack (confirm in DECISIONS.md)
Node 20, Express, MongoDB replica set, React + Vite, React Native (Expo), JWT, S3-compatible storage.

## Roles (users)
AA admin, MIS/IT, SME/content developer, assessor, proctor, candidate, training partner/centre, AB reviewer, NCVET viewer (read-only).

## Core entities
Qualification > NOS > PC; Question (NOS, PC, difficulty, type, language, bloom, status); Assessor (ToA cert + expiry, languages, AAs count); Proctor; TrainingPartner/Centre; Batch (type STT/LTT, mode, dates, status, SLA timestamps); Assignment; Attendance/Login (geo, time); Evidence (type, hash, GPS, time, candidate, batch); Result (theory/practical/viva marks per NOS/PC, status, change log); Grievance; AuditLog; ErfScore.

## Batch lifecycle (status enum)
allocated -> accepted | rejected -> assessor_assigned -> in_progress -> evidence_captured -> result_submitted -> ab_validated -> published. Side states: reassessment_pending, disputed.

## SLA rules (constants in server/src/config/compliance.js)
- AA accept/reject: 2 working days
- Assessor assigned: 7 working days before (short-term) / 30 working days before (long-term)
- Batch allocation by AB: at least 15 days ahead (STT, per flow chart)
- Result submission: 3 working days (STT) / 5 working days (LTT)
- Re-assessment: failed/absent only, STT/LTT only, within 1 year, not shown on certificate
- Assessor: max 4 AAs; no two batches same day at different locations; ToA valid 3 years

## Phases
1. Batch workflow + SLA timers, assessor/proctor registry and rules, mobile geo-login, result submission.
2. Question bank, assessment engine, offline mode, evidence vault.
3. Proctoring (live + AI), analytics, ERF score tracker + DEP export, public calendar.

## Out of scope until clarified (see DECISIONS.md open questions)
DEP/SIDH integration formats, Annexure B (engine features), Annexure IX (31 ERF sub-parameters), AI proctoring approval.

## Added modules from technology requirements (TR)
Public website (s22), PwD/accessibility (s23), question analytics + 5% sector rule (s13-s14), proctoring with audio (s6), student and proctor geo tracking (s9,s26), security audits and DPDP controls (s18-s20), learner and assessor repositories (s25).
