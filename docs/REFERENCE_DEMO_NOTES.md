# Reference notes: ThinkExam platform demo (screenshots, 7 Oct 2026)
Use as UX/feature inspiration only. Verify against the NCVET report before copying any behaviour.

## Batch creation (5-step wizard)
Create batch > Batch settings > Assign test > Publish > Create certificate.
Batch fields: name, job role, training partner, training centre, assessor, proctor, passing criteria (NOS-wise or overall), passing %, batch type (regular), TP SPOC name/contact, scheme (fee based), batch test type (online/offline).
Practical and viva scoring: rubric with 3 options (Good 100, Satisfactory 70, Poor 10) configurable.

## Batch settings toggles
Question and option shuffling; show marks to candidate; assessor Aadhaar verification; test lock after N attempts (3) and N after unlock; periodic image capture during theory (every 30 s); capture image at test start/end; candidate input popup (e.g. father name, gender, email); practical video; viva video; assessor geolocation; Annexure M; assessor feedback; student geolocation/attendance/feedback; multi-language per theory/practical/viva; OJT image upload; mandatory questions.

## Proctoring config (per test)
Streaming: images or video. Proctoring: automatic or manual. UFM (unfair means) detection: image or video. Download UFM video / session video. AI enable yes/no.
Candidate pre-check: screen, browser, webcam, mic, network, then photo verification.
Live UFM popup on face mismatch warning candidate it counts as unfair means.
Alert levels in candidate proctor report:
- Low: screen focus lost, permission revoked, object detected, voice detected, voice muted, looking away
- Medium: face not present
- High: multiple faces detected, face mismatch
Report PDF: alert timeline chart plus flags.

## Test and question model
Question import via Excel template: question text (with image), subject name/code, question code, topic, category (image based, scenario based, fill in the blank, matching, comprehension, typing, voice based, simulation, reasoning...), type (MC).
Per question report: NOS, PC, attempted answer, correct answer, time taken (sec), marks awarded, status dot.
Test list: name, code, question count, level, candidates, type (theory/practical/viva), template.

## Results
NOS-wise result sheet: per NOS theory, practical, viva, total; grand total theory/practical/viva; percentage; final result (Pass/Fail/Absent).
Candidate report: theory/practical/viva start and end times per candidate; activity feed; per-candidate report link.

## Reports menu
Skill report, Candidate report, Subjective report evaluation, Admin audit log. Batch report lists status, date, totals, assessed vs in-progress, assessor, associated tests, certificate, question report.

## Admin modules (top nav)
Dashboard, Question, Test Manager, Candidate, Proctoring, Batch, Assessor, Report. Assessor create: name, code, password, email, contact, profile image, identity image, active toggle (only active assessors can be added to a batch).
