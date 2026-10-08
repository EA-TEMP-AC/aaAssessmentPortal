# API CONTRACT (owned by Architect). v0.1 draft

Base: `/api/v1`. JSON. Auth: `Authorization: Bearer <jwt>`. Errors: `{ "error": { "code": "STRING", "message": "..." } }`.
Roles: aa_admin, mis, sme, assessor, proctor, candidate, tp, ab_reviewer, ncvet_viewer.

## Auth
- POST /auth/login {email, password} -> {token, user{id, role, name}}
- POST /auth/logout

## Batches
- POST /batches (ab_reviewer|aa_admin) {abId, qualificationId, type:"STT"|"LTT", mode:"online"|"offline"|"blended", assessmentDate, tpId, centreId, candidateCount} -> Batch
- GET /batches?status=&from=&to=&tpId= -> {items[], page, total}
- GET /batches/:id -> Batch (includes `sla` {acceptDueAt, assignDueAt, resultDueAt, breached[]})
- POST /batches/:id/accept (aa_admin)
- POST /batches/:id/reject (aa_admin) {reason}
- POST /batches/:id/assign (aa_admin) {assessorId, proctorId?} -> 409 RULE_ASSESSOR_CLASH | RULE_TOA_INVALID | RULE_MAX_AAS | RULE_RATIO
- POST /batches/:id/submit-result (aa_admin) {resultSetId}
- POST /batches/:id/validate (ab_reviewer) {changes[]?}

## Assessors / Proctors
- POST /assessors, GET /assessors, GET /assessors/:id, PATCH /assessors/:id
  Assessor: {name, phone, email, languages[], qualifications[], toa:{certNo, issuedOn, expiresOn}, otherAaCount}
- GET /assessors/available?date=&languages=&batchId=

## Assessor field app
- POST /assessor/login-event {batchId, lat, lng, capturedAt, type:"login"|"logout"} (offline-queue safe). Side effect on login: email to the batch's AB (TR s9)
- POST /proctor/login-event same shape for proctors (TR s9)
- POST /student/login-event {batchId, candidateId, lat, lng, capturedAt, type} (TR s26 student tracking, offline-queue safe)
- POST /assessor/batches/:id/attendance {candidateId, present, idVerified, capturedAt}
- POST /assessor/batches/:id/checklist {items[{key, ok, note}]}

## Evidence
- POST /evidence (multipart) {batchId, candidateId?, kind:"theory"|"practical"|"viva", lat, lng, capturedAt, file} -> {id, sha256}
- GET /evidence?batchId=&candidateId=&kind=&from=&to=

## Questions / Tests
- POST /questions, GET /questions, PATCH /questions/:id (nosId, pcId, difficulty, bloom, type, language, options[], answer)
- POST /questions/import (xlsx)
- GET /question-bank/coverage?qualificationId= -> per NOS/PC counts, flags PCs with fewer than 5
- POST /tests {qualificationId, rules{difficultyMix, bloomWeights}} -> generated Test
- POST /attempts/:id/answers, POST /attempts/:id/submit

## Results
- GET /batches/:id/results
- PUT /batches/:id/results (bulk) {rows[{candidateId, nos[{nosId, theory, practical, viva}]}]}
- GET /results/:id/change-log

## Compliance
- GET /compliance/dashboard
- GET /compliance/erf -> {score, max:400, grade, macroScores[]}
- POST /compliance/risk-plan

## Grievance
- POST /grievances, GET /grievances, PATCH /grievances/:id

## Audit
- GET /audit-logs?entity=&entityId=


## Analytics (TR s10)
- GET /analytics/performance?groupBy=assessor|trainingPartner|jobRole|state&from=&to= -> {series[{key, label, passRate, avgScore, candidates, batches}]}
  All five filters (assessor, TP, job role, state, date from/to) must be combinable; graphs rendered by web.

## Question analytics and review (TR s13, s15)
- GET /questions/:id/usage -> {timesUsed, correctRate, classifiedDifficulty:"easy"|"medium"|"tough"}
- GET /question-bank/usage-report?qualificationId= (ready-reference report)
- GET /question-bank/flagged?qualificationId= (most candidates answered wrongly) ; POST /question-bank/flagged/:id/notify {to:["ab","tp"]}
- POST /question-bank/review-cycles {qualificationId, abId, dueOn}, PATCH /question-bank/review-cycles/:id (periodic review with AB)
- GET /question-bank/sector-coverage?sector= -> {qualificationsWithBank, totalInSector, percent, meetsFivePercent}  (>=5% of NQR qualifications in sector, at application)
- Question difficulty enum for authors: low|medium|high; auto-classified: easy|medium|tough. Keep both fields.

## Proctoring (TR s6-s8, s11)
- POST /proctoring/sessions {attemptId, mode:"live"|"auto", streamType:"video"|"image", ai:boolean}
- POST /proctoring/sessions/:id/media (audio+video chunks or periodic photos)
- POST /proctoring/sessions/:id/flags {type, severity:"low"|"medium"|"high", at, mediaRef}  (malpractice recorded + flagged)
- GET /proctoring/sessions/:id/report
- Alert types (project choice, not NCVET-mandated): camera_blocked (covered, black frame, lens obstructed, frozen feed), face_not_present, multiple_faces, person_in_background (someone standing/sitting nearby), face_mismatch, looking_away, object_detected (phone, earphone, book, second screen), voice_detected (second voice), voice_muted, screen_focus_lost, permission_revoked.
- Severity defaults: high = multiple_faces, person_in_background, face_mismatch, camera_blocked(sustained), object_detected(phone); medium = face_not_present; low = looking_away, voice_muted, screen_focus_lost. Configurable per test.
- Flags go to a human review queue: GET /proctoring/review-queue, POST /proctoring/flags/:id/decision {decision:"dismiss"|"warn"|"invalidate", note}. No automatic invalidation.
- Candidate gets a visible warning on high flags (as in the demo UFM popup) and every flag keeps its media reference for audit/grievance.

## Registries and repositories (TR s25)
- Assessor has `experienceYears` and `qualifications[]`; same fields for proctor. GET /proctors, POST /proctors.
- GET /repository/learners?batchId=  (learner assessment data repository, role-restricted)
- GET /repository/export?from=&to=&format=json|csv&version=1 (admin only, scoped, audit-logged; for handing data to an NCVET-proposed agency)
- POST /admin/export-credentials {agency, scopes[], expiresOn} -> read-only API key for that agency; revocable

## Public website data (TR s22) , no auth, read-only
- Each site document has `visibility: "public"|"on_request"|"hidden"` (default on_request until DECISIONS Q9 is settled; redacted copies supported)
- GET /public/team (operational team + organogram), /public/assessors, /public/proctors (name, qualifications, experience only; no contact data)
- GET /public/sample-papers?qualificationId=, /public/industry-linkages, /public/grievance-info, /public/posh-info, /public/calendar (monthly assessment calendar)
- Admin side: CRUD for each under /admin/site/*, plus /admin/site/documents for registered-office docs and premises proof (these two are stored/shown per TR s22 F,G; confirm with human whether they are public or only on request).

## Accessibility / PwD (TR s23)
- Batch and candidate carry `accommodations[]` (e.g. extra time, screen reader, large print, scribe).
- Question has `accessibleVariantOf` link for disability-specific content.
- GET /results/:id/accessible?format=large-print|screen-reader-friendly|braille-ready (result publishing tool)
- Proctor/assessor profile field `pwdTrained:boolean`.

## Data and security (TR s18-s20)
- All learner PII and results encrypted at rest; access-logged; retention policy configurable. (DPDP Act 2023)
- POST /admin/security-audits {scheduledOn, scope}, GET /admin/security-audits (track periodic info-security audits)

## Question bank sector config (multi-sector)
- POST /admin/sectors {name, nqrQualificationCount, nqrImportedOn}, POST /admin/sectors/:id/nqr-import (CSV exported from nqr.gov.in)
- GET /question-bank/sector-coverage now returns one row per configured sector.
