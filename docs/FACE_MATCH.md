# Face match (P-03, prototype)

Status: prototype for a demo. Not approved for real candidates. The vendor choice (DECISIONS Q5) is still open.

## What it does

Two 1:1 checks in the candidate's browser. Each one answers only "are these two photos the same person?".

1. **At the camera check**, it compares the photo on the candidate's ID card (held up to the camera) with a selfie taken a moment later.
2. **During the exam**, it compares the live face with that selfie about once a second.

Code: `web/src/proctoring/face/`. Model: `@vladmandic/face-api` 1.7.15 (tiny face detector, tiny 68-point landmarks, face recognition). The model files are served from `web/public/models/face/`, not from a CDN. Their sources, licences and checksums are in the README in that folder.

## What it does not do

- It does not verify identity against any government record or database. Nothing is looked up.
- It does not read the card's text, number or any other detail. It never accepts or stores an ID number (CLAUDE.md).
- It does not search a database of people: there is none. It does not store face templates.
- It does not block, fail or remove a candidate. Every result is for a human to review.

## How it decides

| Check | Result | What happens |
|---|---|---|
| ID card vs selfie | `match` | Nothing raised. |
| | `mismatch` (distance above `idDistanceThreshold`, default 0.6) | Flag `id_mismatch`, raised once at the camera check, never repeated. The candidate may continue. |
| | `id_no_face` | Not a mismatch. The candidate is told: hold the card flat, closer, with the photo in focus. They can retry, and a proctor can resolve it by hand. |
| | `selfie_no_face` | Not a mismatch. Take the selfie again. |
| Live face vs selfie | `match` | Ends any run of mismatches. |
| | `mismatch` (distance above `distanceThreshold`, default 0.6) | Counted. Flag `face_mismatch` only after 3 mismatches in a row that span at least 4 seconds (so, with one sample a second, at the 5th). Never on one frame. |
| | `no_face`, `multiple_faces`, `unknown` | Neither counted nor reset. Other checks (P-02, P-06) handle a missing or extra face. |

A gap of more than 3 seconds between two mismatches starts a new run. After a `face_mismatch` flag there is a 60-second cooldown, and a new full run is needed. All numbers are in one object, `web/src/proctoring/face/config.ts`.

Distance is the face-api Euclidean distance between two 128-number descriptors: lower means more alike. 0.6 is the library's usual default, not a value tuned for this project.

## Privacy

- The selfie descriptor (128 numbers) is held in memory, in a private field of the matcher. It is never written to browser storage, sent to the server, logged, or put in a flag. `clear()` overwrites and drops it. The demo page clears it on Stop and when the page closes.
- Descriptors of the ID card photo and of live frames exist only for the length of one comparison.
- Flags carry the type, the time, the number of samples and the distance rounded to 3 decimals. No image, no descriptor, no name.
- This module uploads nothing. It can return the ID still and the selfie as JPEG files (at most 1024 px wide, quality 0.8) so the exam page can upload them later as evidence. That upload, its consent text and its retention belong to the exam page task.
- A test (`privacy.test.ts`) runs a full camera check and live comparison and checks that `fetch`, `sendBeacon`, `localStorage`/`sessionStorage`, IndexedDB, cookies and the console are never called.

## Known limits

Results get worse, or wrong, with:

- poor, uneven or back lighting; strong shadows;
- glasses (especially with glare), masks, scarves, caps, hair over the face;
- ageing: an ID photo taken years ago;
- small, old, printed or laminated card photos; glare on the card; a card held at an angle or out of focus;
- low-resolution or compressed webcams;
- head turned away, looking down;
- different skin tones: face recognition models are known to perform unevenly across groups, and this one has not been checked;
- similar-looking people (siblings, twins).

**This has not been tested for accuracy or bias.** No accuracy, false-match or false-non-match figures may be claimed for it, in documents, to NCVET, to awarding bodies or to candidates.

## Before real use

1. Recorded, informed consent from each candidate for the face comparison, with a way to decline and an alternative manual check.
2. Testing on a representative sample of candidates and ID cards, with results reviewed by people, before choosing thresholds.
3. Approval of AI proctoring (DECISIONS Q5, Q8) and the vendor-or-own decision.
4. Confirmation of the model weight licence (DECISIONS 684).
5. Every flag goes to the human review queue (P-08). A flag never blocks, fails or invalidates a candidate by itself.

## Wiring (done in P-09)

P-09 wired this module into the exam page and the engine: the camera check (ID card, then selfie), the upload of both photos at Start, and the live comparison. See docs/PROCTORING_ENGINE.md (Face checks) for the flag detail mapping. The notes below were written before that and are kept for reference.

The owner wires this into the proctoring engine and the exam page. Notes:

- Add `face_mismatch` and `id_mismatch` to the engine's flag list and the server's flag types (DECISIONS 681).
- The engine's flag `detail` shape differs; map `{ samples, distance }` when sending (DECISIONS 681).
- Call `matcher.clear()` when the attempt ends or the page unloads.
- Load `FaceApiMatcher` only on the pages that need it; the library is about 1.3 MB of JavaScript plus 6.4 MB of model files.

## Testing

Unit tests cover the rules, the ID outcomes, the camera-check helpers, the matcher logic with a stand-in library, the JPEG helper and the privacy test. The real camera and model cannot run in jsdom, so the model's behaviour is checked only by hand on `/face-match-demo` (development builds, `aa_admin`).
