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

# Reference notes: RAS Systems "Assessment" portal demo (admin view, 19 Oct 2026)

Looked at by hand in a demo login, read only. Nothing was saved, edited or downloaded. These are our own notes on screens and fields, for comparing features. Not a copy of their design or text.

## Their menu (about 25 screens, one flat list)
Manage Candidates, Assign Multiple Job Roles to Assessor, Manage Scheme Details (schemes and sub-schemes), Update Assessment Code and Set Order, Dashboard with Details, Post Attendance (theory and viva tabs, with marks), Bulk Upload Candidates With Photos, Get Student and Assessor Credentials, Assessment submenu (Question Bank, Assessment, Assessment with Criteria, Assessment Details, Questions, Update Candidate Marks, Record Entry for Not-Attempted Students), Batch Start, Admin Module (roles, users, subjects), Candidate Summary Report, QB Analysis Report, bulk question upload (plain, with images, PC-wise), View User Image and Voice Recording, Users Log Report, Send Mails to TP/TC, Manage Batch Centre and TP Details, Update Exam Date, Manage User Logins, View User Punch Details, Delete Logins.

## Things they show that we do not (gap list)
| Area | What they have | Ours today | Worth doing? |
|---|---|---|---|
| Dashboard | Search by sector, batch id or date range. Panels: batches scheduled, assessors scheduled, number of users writing the exam right now, batches for the next 7 days, "Today CCTV" | Home page is a text placeholder; Analytics is separate | Yes. A real home dashboard for AA admin |
| Proctoring review | Filter by suspicious type (face emotions, dual person, person change, gadget found), exam status (running, completed, not started), chat, image and voice recordings in one screen | Proctoring list with flags and decisions; no voice or chat | Check against TR section 6 (audio) |
| Attendance with marks | Theory and viva tabs; filter by month, year, date, batch | Attendance on mobile only; marks on batch page | Maybe: web attendance fallback |
| Not-attempted students | Separate screen to record students who did not take the exam | We use an Absent tick in the result table | Probably covered |
| Update marks after the fact | Dedicated "Update Assessment Marks" screen | Edit with change reason in Result section | Covered, with an audit trail |
| Mails to TP/TC and assessor | Search batches, then send notification mails; assessor and TP status filters; cannot send for past dates | Assessor login alerts the AB by email only | Yes: batch notification to TP and assessor (confirm in DECISIONS) |
| Centre and TP details per batch | Own screen | TP contact on batch page | Covered |
| Punch details | Per-user punch (login) history by sector, role, user | Access log and audit log, no per-user punch view | Maybe |
| Users log report | By sector, batch id and exam date | None | Maybe |
| Student and assessor credentials | Screen for both (we show student only to assessor) | Student credentials in roster and on mobile | Add assessor credentials view if wanted |
| Login management | Tabs: change password, activate student login, manage proctor login; Delete Logins screen | Users page: reset, deactivate | Covered |
| Multiple job roles per assessor | One screen to assign several job roles | Registry holds qualifications per assessor | Check Registry |
| Assessment code and set order | Codes and priority order for question sets (set 1, set 2) | One paper per language | Maybe: multiple sets per assessment |
| Assessment with Criteria | Separate version with pass criteria | Pass rule is in batch settings | Covered |
| Question bank screens | Search by sector, job role, subject; manage questions by parent topic, sub topic, mode, complexity; "QB Analysis" report by QP code | Question bank by qualification, NOS, PC; analytics page | Add topic and complexity fields? |
| Practice test | Assessment type "Practice Test" as well as "Assessment Test" | None | Maybe, for student trial run |
| Postponed exams | Candidate has "Postponed From Date" | Batch dates change with audit; no field | Maybe |

## Candidate form fields they have (ours in brackets where different)
Name, student id, enrolment number, father or husband name, gender, mobile, Identification Type with Aadhaar number (we never store national ids, CLAUDE.md rule), sector, job role, assessor, manager, coordinator, assessment type, batch start and end date, address, batch id, centre name, centre SPOC name, email and mobile, TP name, SPOC name, email and mobile, start and end time (HH and MM), assessment date, postponed-from date, scheme name, state, level, date assigned to AA, location, scheme type, photo upload, identity document upload.

Fields we may want: father or husband name, gender, address, manager and coordinator, exam start and end time of day on the candidate or batch, state on the learner, photo upload with identity check. Identity upload and Aadhaar must stay out unless a decision allows it.

## Where ours is stronger
Batch status and SLA timers with late reasons, assessor clash checks, audit with before and after, role-based menus, one-click result submit, mobile offline app with video evidence, encryption of personal fields, access log, and DPDP controls. Their portal has a flat admin menu with no role separation visible in this login, ASP.NET postback pages, and a search-first layout.

## Open points for a human
1. Do we want a real dashboard on Home (their strongest screen)?
2. Mail notifications to TP and assessor from the batch page.
3. Practice test and multiple question sets per assessment.
4. Photo and identity upload for candidates (compliance risk: no Aadhaar or other national ids).

## Two more screens (added 19 Oct 2026, evening)

**Bulk upload candidates (screen 29).** Three yes or no questions come first: do you know the assessment date and timings, do you have the Excel template ready, upload for the previous centre. Step 2 then asks for batch level fields beside the Excel file: SSC, job role, version, assessor, batch id, batch start and end date, centre id and name, centre SPOC name, email and mobile, TP name, SPOC name and mobile, date assigned to AA, assessment name, duration, assessment date, postponed-from date, start and end time, state, assessment type, level, address (500 characters), scheme and sub scheme, location, scheme type, student's preferred language of assessment, and "create meeting" yes or no. Ours: the batch is made first (Create batch) and students are added to it by Excel or CSV; the batch fields above mostly exist already. Missing: sub scheme on the batch, level, duration, "preferred language per student", location text.

**Question bank edit (screen 30).** A question bank belongs to an SSC, a job role and a subject. It lists NOS codes, each marked Core or Non-core, with performance criteria (PC) rows and a description for each. A criteria table below shows, for every NOS and PC, three upload slots: Low, Medium and High difficulty questions. Ours: NOS and PC are on the qualification and every question points at one NOS and PC. Missing: a Core or Non-core flag on the NOS and a Low, Medium or High difficulty per question (with the paper generator choosing by it).

**Sample report file.** `docs/reference-samples/CandidateSummaryReport.xls` is the real export behind the Candidate Summary Report (it is an HTML table saved with an .xls name; open it in Excel). It holds test students only (TEST1 to TEST10, first names). Our report follows its layout: header block, result index, per NOS theory and practical columns, totals, status and percentage.

## Screenshots of the RAS demo
Saved in `docs/reference-demo-screens-2026-10-19/` (28 images, taken 19 Oct 2026, admin view, nothing saved in their system). They are internal reference only: do not publish them or copy their design. Some are low resolution because they were taken at reduced size. Numbers match the order of the menu walk:

| File | Screen |
|---|---|
| 01-dashboard | Dashboard (search and panels) |
| 02-assign-job-roles-to-assessor | Assign job roles to assessor |
| 03-manage-scheme-details | Scheme and sub-scheme choice |
| 04-update-assessment-code-set-order | Assessment code and set order |
| 05-post-attendance-with-marks | Attendance with marks (theory and viva tabs) |
| 06-bulk-upload-candidates | Bulk upload candidates (asks if exam date and time are known) |
| 07-student-details-credentials | Student and assessor credentials search |
| 08-manage-assessment | Assessment list |
| 09-batch-start | Batch start search |
| 10-admin-module | Admin area (roles, users, subjects) |
| 11-candidate-summary-report | Candidate summary report search |
| 12-qb-analysis-report | Question bank analysis report search |
| 13-image-voice-recording-review | Chat, image and voice review with suspicious-type filters |
| 14-users-log-report | Users log report |
| 15-send-mails-to-tp-tc-assessor | Batch notification mails |
| 16-manage-batch-centre-tp-details | Batch centre and TP details |
| 17-assign-update-exam-date | Assign or update exam date |
| 18-manage-user-logins | Change password, activate student login, proctor login tabs |
| 19-view-user-punch-details | User punch details |
| 20-assessment-submenu | Assessment submenu |
| 21-manage-question-bank | Question bank list |
| 22-manage-assessment-with-criteria | Assessment with criteria list |
| 23-assessment-details | Assessment details search |
| 24-manage-questions | Manage questions (topic, sub topic, mode, complexity) |
| 25-update-assessment-marks | Update assessment marks search |
| 26-not-attempted-students | Record entry for not-attempted students |
| 27-create-candidate-form-top, 28-create-candidate-form-bottom | Create candidate form (all fields) |
| 29-bulk-upload-candidates-form | Bulk upload candidates, step 2 (all batch fields next to the Excel upload) |
| 30-manage-question-bank-nos-pc | Question bank edit: NOS list with core or non-core, performance criteria per NOS, difficulty table |
