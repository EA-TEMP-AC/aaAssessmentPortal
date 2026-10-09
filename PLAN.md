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
AA admin, MIS/IT, SME/content developer, assessor, proctor, candidate, training partner/centre, Awarding Body reviewer, NCVET/monitoring viewer.

## Core entities
AwardingBody; Learner; Qualification > NOS > PC (passMarks + maxMarks); Question; Assessor; Proctor; TrainingPartner/Centre; Batch (STT/LTT, mode, start/end dates, status, SLA); candidates (batch roster → learner); Attendance/Login; Evidence; Result; Grievance; AuditLog; ErfScore; emailQueue; assessorDayLocks.

## Batch lifecycle (status enum)
allocated -> accepted | rejected(terminal) -> assessor_assigned -> in_progress -> assessment_completed -> result_submitted -> ab_validated -> published.
Also: cancelled (terminal, releases locks); disputed (from result_submitted|ab_validated). Reassign while assessor_assigned. Reassessment = new batch (inherit fields; window from first assessment). Soft SLA late actions with lateReason. See docs/SCHEMA.md.

## SLA rules (constants in server/src/config/compliance.js)
- AA accept/reject: 2 working days (soft for aa_admin with lateReason)
- Assessor assign: 7/30 WD before assessmentStartDate by default; ASSIGN_SLA_MODE alternate
- Result: RESULT_SLA_ANCHOR default assessment end; then 3/5 WD (soft with lateReason)
- Batch allocation lead 15 days STT (project/flow)
- Re-assessment: new batch; Fail/Absent; STT/LTT; within 1 year of first assessment end
- Clash: overlapping IST ranges at different centres (assessorDayLocks)
- Working days: SCHEMA §2.1; holidays non-retroactive for dueAts
- Assessor login → emailQueue → awardingBodies.notificationEmails (retries; NCVET:FR §E; TR s9)

## Phases
1. Batch workflow + SLA timers, registries, geo-login + email worker, result submission, master data UI.
2. Question bank, assessment engine, offline mode, evidence vault.
3. Proctoring (live + AI), analytics, ERF + DEP export, public calendar.

## Out of scope until clarified (see DECISIONS.md open questions)
DEP/SIDH formats, Annexure B/IX, AI proctoring approval, unaccepted-batch policy, reassessment initiator.

## Added modules from technology requirements (TR)
Public website (s22), PwD/accessibility (s23), question analytics + 5% sector rule (s13-s14), proctoring with audio (s6), student and proctor geo tracking (s9,s26), security audits and DPDP controls (s18-s20), learner and assessor repositories (s25).
