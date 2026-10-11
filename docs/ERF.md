# Excellence-Risk Framework weights

Source: NCVET *Guidelines for Recognition and Regulation of Assessment Agencies* (June 2025), Annexure IX(b), PDF pages 71–72 (printed pages 59–60). Risk and compliance definitions: Annexure IX(a) and Section 5, Table 13 and Table 15.

The marks below were read from the table on those pages. A text extract of the same PDF mixes the marks column with the sub-parameter names, so the numbers were checked against the page images. Macro totals match Table 12.

`marks` is the sub-parameter weight. A blank cell is printed empty (not a zero). Rows 02 and 20 print `0`. Blank and `0` both add nothing. The printed numbers sum to **100**.

Category points (Table 13), applied to a sub-parameter and then multiplied by its `marks`:

| Category | Points |
|---|---|
| High risk | −4 |
| Medium risk | −2 |
| Low risk | −1 |
| Compliance | +4 |
| Excellence | not a fixed number |

Excellence is extra and is decided by the NCVET Internal Monitoring Committee from documentary proof. It is not part of the 400 ceiling. If every sub-parameter with a printed weight is at compliance, the score is 100 × 4 = **400** (Section 5.3.2).

Grades (Table 15), printed as:

| Grade | Range |
|---|---|
| A | 324–400 |
| B | 171–324 |
| C | 18–171 |
| D | below 18 |

The printed A and B ranges both include 324, and the printed B and C ranges both include 171. Which grade those two scores take is open question 85. 18 is in C; D is below 18.

Grade B, C, or D requires a risk mitigation plan presented to NCVET within a month (Section 5.3.2). NCVET:FR §J.

## Annexure IX(b)

| No. | Macro-parameter | Sub-parameter | Marks |
|---|---|---|---|
| 01 | Assessment Delivery | Batch acceptance rate | 4 |
| 02 | Assessment Delivery | Deviation between scheduled and actual assessment date | 0 |
| 03 | Assessment Delivery | Offline assessment conducted by certified assessor | 8 |
| 04 | Assessment Delivery | Assessor's fluency in the language mentioned as the preferred language of assessment | 2 |
| 05 | Assessment Delivery | Result submission within turnaround time of 3 days (except for LTT, which is 5 days) | 8 |
| 06 | Assessment Delivery | Video evidence of assessment captured on the AA assessment engine, portal, or app | 8 |
| 07 | Assessment Delivery | Number of practical assessments assessed by an assessor as per the limits in the NCVET guidelines | 8 |
| 08 | Assessment Delivery | Result returned by the AB for non-accuracy of data | 4 |
| 09 | Assessment Delivery | Process in place to ensure one assessor could not assess two or more batches on the same day at different locations | 8 |
| 10 | Assessment Strategy | Availability of a question bank with the required number of questions as per NCVET guidelines | 6 |
| 11 | Assessment Strategy | Question bank availability in official languages of Indian states or the local language as per the state of operation | 1 |
| 12 | Assessment Strategy | Sample questions available on the website for active qualifications | 1 |
| 13 | Assessment Strategy | Availability of certified assessors across allocated sectors | 1 |
| 14 | Assessment Strategy | Question bank validation by AB or industry | 1 |
| 15 | Business Planning & Research | Number of assessments planned versus actual | 5 |
| 16 | Business Planning & Research | Continuity of assessments in allocated sectors | 5 |
| 17 | Business Planning & Research | Proportion of government versus non-government funded assessments, in numbers | |
| 18 | Business Planning & Research | Global benchmarking in assessments | |
| 19 | Financials | Total amount pending for payment to assessors/proctors | 5 |
| 20 | Financials | Turnover planned versus actual | 0 |
| 21 | Financials | Continued positive net worth of the AA | 5 |
| 22 | Financials | Profitability | 5 |
| 23 | Governance & Manpower | Leadership stability | 1 |
| 24 | Governance & Manpower | Positions continuously filled as per the organogram submitted during recognition | 1 |
| 25 | Governance & Manpower | Percentage of revenue utilized towards continuous professional development of staff | 2 |
| 26 | Governance & Manpower | Feedback mechanism (post assessment) | 1 |
| 27 | Governance & Manpower | Adherence to SOPs and guidelines related to assessment | 1 |
| 28 | Governance & Manpower | Availability of a data storage mechanism as per the Digital Personal Data Protection Act, 2023 | 4 |
| 29 | Governance & Manpower | Awards, recognition, accreditation, and similar | |
| 30 | Grievance Redressal and POSH | Presence of a grievance committee | 2 |
| 31 | Grievance Redressal and POSH | Presence of a POSH committee | 3 |

Macro totals from these marks: Assessment Delivery 50 (01–09), Assessment Strategy 10 (10–14), Business Planning & Research 10 (15–18), Financials 15 (19–22), Governance & Manpower 10 (23–29), Grievance Redressal and POSH 5 (30–31).

## Phase 1 fields that feed a sub-parameter

These fields are in the schema so a later score can use them. They do not calculate the ERF.

| IX(b) | IX(a) sub-parameter | What is stored |
|---|---|---|
| 04 (marks 2) | Assessment Delivery 4. Assessor fluency in the preferred language of assessment | `batches.assessmentLanguage` and `assessors.languages`. Assign raises `RULE_ASSESSOR_LANGUAGE` unless `aa_admin` overrides. |
| 09 (marks 8) | Assessment Delivery 9. One assessor, two or more batches on the same day at different locations | Different centres are already `RULE_ASSESSOR_CLASH`. Same centre on the same day is open question 79. Annexure IX(a) calls two batches at the same location, each with fewer than 10 candidates, high risk, and two batches at different locations medium risk. Compliance in that row is one batch per assessor per day. |
| 19 (marks 5) | Financials 3. Total amount pending for payment to assessors/proctors | `assessorPayments.amountDue`, `amountPaid`, `pending` (task B-11). |
| 26 (marks 1) | Governance & Manpower 4. Feedback mechanism (post assessment) | `batches.learnerFeedback` (task B-10). Annexure IX(a) scores the share of batches with no learner feedback. |
