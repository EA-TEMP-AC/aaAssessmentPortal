# Assessment Agency Portal: Quick Guide

A short guide to the main end-to-end jobs in the portal. Each use case says who does it, where to click, and what you should see.

Demo logins come from `npm run seed` and `npm run seed:demo-full -w server` (test servers only). Staff emails: `admin@aa.example`, `mis@aa.example`, `sme@aa.example`, `assessor@aa.example`, `proctor@aa.example`, `tp@aa.example`, `candidate@aa.example`, `ncvet.viewer@aa.example`. The demo password is `Dev-Password-1` unless the server was seeded with another `SEED_PASSWORD`. On first sign-in you are asked to change it.

## Who does what

| Role | Main work |
|---|---|
| AA admin | Everything: set-up, batches, assessor assignment, results, settings |
| MIS | Master records, users (training partners, assessors, proctors, students), working days, recognition |
| SME | Question bank and test papers |
| Assessor | Mobile app: attendance, logins, videos, checklist for the batch |
| Proctor | Watches online exams, reviews flags |
| Candidate (student) | Takes the online exam |
| Training partner (TP) | Sees its own batches and students |
| NCVET viewer | Read-only: analytics, audit log, recognition |

The menu only shows what your role may open.

## The big picture (one batch, start to finish)

1. Set up master records (once).
2. Prepare questions and an approved test paper.
3. Create the batch and add students.
4. Accept the batch, then assign an assessor.
5. Assessment day: assessor (mobile) and students (exam).
6. Mark the batch complete, submit the result, publish.
7. Download the candidate summary report.

Batch status moves: Allocated, Accepted, Assessor assigned, In progress, Assessment completed, Result submitted, AB validated, Published. A batch can also be Rejected, Cancelled or Disputed.

---

## Use case 1: First-time set-up (AA admin or MIS)

**Goal:** have the people and places a batch needs.

1. Sign in, open **Master entry**.
2. Use the tabs to add: awarding body, training partner, training centre, assessor, proctor, students. For many records, use the tab's **bulk Excel upload**.
3. Open **Recognition** and record the sectors, states (or PAN India) and dates the agency is recognised for.
4. Open **Working days** and set weekend days and holidays. SLA due dates are calculated from these.
5. Optional: **Schemes**, **Projects**, **Signatories** if batches are funded under a scheme.
6. Open **Users** to create logins and reset passwords. Every student gets a login automatically; the sign-in id and first password show in the student list.

**Check:** the records appear under **Master data** and (for assessors and proctors) **Registry**.

## Use case 2: Build a question bank and test paper (SME)

1. Open **Question bank**. Pick the qualification, then NOS and PC.
2. Add questions one by one or import them. Edit as needed.
3. **Send for review.** An approver approves each question.
4. Open **Papers**. Generate a test paper (choose language, for example English or Hindi) from approved questions.
5. Send the paper for approval. The approver approves it or sends it back.

**Check:** the paper shows as approved. A batch needs an approved, complete paper in its language before students can start.

## Use case 3: Create a batch and add students (AA admin)

1. Open **Batches**, click create.
2. Fill in: qualification, training partner and centre, STT or LTT, mode, assessment start and end dates, language. Optional: scheme and project.
3. Choose the approved test paper (or set it later on the batch page).
4. Save. The batch starts as **Allocated** and its SLA due times appear on the list.
5. Open the batch. In the candidate roster add students one by one or use the import.

**Check:** the roster lists the students; the batch status badge shows Allocated.

## Use case 4: Accept the batch and assign an assessor (AA admin)

1. Open the batch. Click **Accept** (or **Reject** with a reason).
   - Do this within 2 working days. If late, the system asks for a late reason.
2. Click **Assign assessor** and pick one. The system blocks the choice if the assessor is already booked at another centre on those days.
3. If the assessor changes, use **Reassign assessor** while the status is Assessor assigned.

**Check:** status becomes Accepted, then Assessor assigned. Use **Cancel** (with reason) if the batch will not run.

## Use case 5: Assessment day, the assessor (mobile app)

1. Sign in on the phone. Allow location. Download the batch (works offline once downloaded).
2. **Batch** tab: see batch details.
3. **Attendance** tab: mark who is present. Taking attendance signs the assessor in with location and time; this alerts the awarding body by email.
4. **Logins** tab: shows each student's sign-in id and first password, so you can hand them out.
5. **Video** tab: record the practical and viva. One complete video per student and part, with the viva questions stepped through on screen. Or record one group video for several students. Videos queue and upload when there is signal.
6. **Checklist** tab: complete the assessor checklist.
7. **Session** tab: shows sync status and sign-out.

**Check:** the evidence appears on the web under **Evidence** with checksum and location.

## Use case 6: Online exam, the student (web)

1. Sign in with the id and password from the assessor or the student list. Change the password on first sign-in.
2. Open **Exam**. Tabs: Upcoming, Ongoing, Completed.
3. Click **Start** on the exam. Complete the camera check.
4. Answer the questions and submit. If the connection drops, use **Resume**.

**Check:** the exam moves to Completed.

## Use case 7: Watch an exam, the proctor

1. Open **Proctoring**. See the running and finished attempts.
2. Open one to see flags (for example face not found) and snapshots.
3. Record a review decision on each flag. Open the proctoring report for the full story.
4. The answer sheet is available from the attempt.

## Use case 8: Close the batch and publish the result (AA admin)

1. After the assessment, open the batch and click **Complete** (reason required). Status: Assessment completed.
2. In the **Result** section enter or confirm marks and submit the result.
   - Due 3 working days after the end date (STT) or 5 working days after the exam date (LTT).
   - Because the awarding body has no login, the submit step can also validate and publish in one go (auto-publish).
3. If it was not auto-published, use **Validate result**, then **Publish result**.
4. Open **Results** for the list of batch results. Open a batch to see its candidate summary report. Use **Print** or **Excel** to export it.

**Check:** status shows Published. Fail or Absent students can be given a re-assessment as a new batch within one year of publication.

## Use case 9: Monitoring and audit (NCVET viewer, MIS, AA admin)

- **Analytics:** figures by assessor, training partner, job role and state, and SLA performance.
- **Audit log:** who changed what and when. Personal data and question text are never in it.
- **Batches:** each list row has a countdown to the next SLA due time.
- **Settings** (AA admin): access and feature settings.
- **Public site** (AA admin): edit content for the public website.

---

## Quick fixes

| Problem | What to try |
|---|---|
| A menu item is missing | Your role does not have it. Ask the AA admin. |
| Student cannot start the exam | The batch has no approved paper in that language, or it is outside the exam window. |
| Cannot assign assessor | Assessor is booked on those dates at another centre, or the batch is not Accepted yet. |
| Student forgot password | Admin or MIS: **Users**, reset password. |
| Action says "late" | You are past the SLA due time. Enter a late reason and continue. |
| Phone has no signal | Keep working. Attendance and videos queue and sync later. |

## For the next version of this guide

Screenshots for each step can be added from the running app. Say so and the pages can be captured.
