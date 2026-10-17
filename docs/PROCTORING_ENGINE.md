# Proctoring engine (in-browser prototype)

Tasks P-02, P-05, P-06, P-07. Code: `web/src/proctoring/`. Status: prototype for a demo. Open
questions 660 to 668 in DECISIONS.md.

## How it works

The exam page opens the camera and calls `createEngine().start({ stream, sessionId, attemptId,
batchId, config, onStatus })`. Every `detectionIntervalMs` the engine reads the current video frame
in memory, runs the detector, and passes the result to a set of pure rules. A rule that holds long
enough raises a flag. The engine takes a JPEG snapshot, uploads it as evidence, and sends the flag
with that `evidenceId`. It also takes a snapshot every `snapshotIntervalSeconds`. `stop()` releases
timers, listeners, the hidden video element and the models. The camera stream belongs to the exam
page, which stops it.

The model sits behind a small `Detector` interface (`detect(frame) → Detection[]`), so MediaPipe can
be swapped for another model (for example YOLO) without touching the rules. Tests use
`FakeDetector`.

## Face checks (P-09)

`start()` takes an optional `faceMatcher` (the matcher that holds the candidate's selfie from the camera check; see docs/FACE_MATCH.md). When it is present:

- The engine loads the face model once at start. If that fails the status becomes `degraded` ("The face check could not load; the other browser checks still run.") and the face comparison is skipped; every other check keeps running.
- Each detection cycle it runs `matcher.compare(video)` and `evaluateIdentity`. `face_mismatch` is raised only when the face rules say so (3 mismatches in a row that span the configured hold time, with a cooldown); one frame never raises it. A snapshot is taken and sent with the flag, like any other flag.
- `stop()` calls the matcher's `clear()`, once.
- Descriptors stay in the matcher. Nothing about them is sent, stored or logged.

**Detail mapping.** The face rules produce `{ samples, distance }`. The server's `detail` is `{ label, count, confidence }` with `label` limited to letters, digits, space, `_` and `-`. The engine sends:

| Face rules | Server `detail` |
|---|---|
| `distance` (face-api distance, 3 decimals) | `label: "distance_<distance x 100, rounded>"`, for example `distance_72`; with no distance the label is the flag type |
| `samples` | `count` |
| (none) | `confidence` is left out: a distance is not a confidence |

`id_mismatch` and `id_unreadable` are raised once by the exam page after Start, not by the engine: `id_mismatch` with the same mapping (`count` 1), `id_unreadable` with no detail. Both carry the evidence id of the ID card photo (`id_proof`) when its upload worked. Every face flag is for a person to review; none blocks the candidate or changes the exam.

## What it detects

| Flag | When |
|---|---|
| `face_not_present` | No face above the confidence cut-off for `sustainedSeconds.face_not_present` |
| `multiple_faces` | Two or more faces |
| `person_detected` | Two or more people (the candidate is one) |
| `looking_away` | X-14. Exactly one face whose head is turned sideways: the nose is off the middle of the eyes by at least `lookAwayTurn` (0.45) of the eye distance, for `sustainedSeconds.looking_away` (6). Sideways only; looking down or up is not measured |
| `voice_detected` | X-14. The microphone is louder than `voiceLevel` (0.06) and at least 3 times the room's quiet level, for `sustainedSeconds.voice_detected` (4). Only a loudness number is read: no recording, no words, and it cannot tell whose voice it is. Needs the microphone to be allowed in the exam window |
| `phone_detected` | A "cell phone" |
| `object_detected` | A book, laptop or tv (extra screen) |
| `camera_blocked` | Mean brightness stays below the dark threshold for `sustainedSeconds.camera_blocked` |
| `camera_frozen` | Consecutive frames stay the same for `sustainedSeconds.camera_frozen` |
| `permission_revoked` | The camera track ends or is muted |
| `tab_hidden`, `window_blur`, `fullscreen_exit` | Browser events |

The same flag type is raised at most once per `flagCooldownSeconds`. Thresholds and confidence
cut-offs are in one object, `PROCTOR_THRESHOLDS` in `web/src/proctoring/config.ts`. They are
starting values, not tuned ones. The server decides each flag's severity.

Models: MediaPipe Face Detector (BlazeFace short range) and Object Detector (EfficientDet-Lite0,
COCO labels), Apache-2.0, served from `web/public/mediapipe/` with no CDN at run time.

If the models do not load, the engine reports `degraded` with a message and keeps running the
browser-event checks and the brightness and freeze checks.

## What it does not detect

- A second voice, or any sound. The engine does not use the microphone.
- Earphones or earbuds (the object model has no such class), smart watches, notes on paper or a
  hidden second device that the camera cannot see.
- Where the candidate is looking (gaze), or someone helping from outside the camera view.
- Whether the face is the registered candidate (that is P-03).
- Anything when the browser is not running the exam page, for example a second computer.

## Privacy: what leaves the browser

- **Flags**: type, time, a small detail (`label`, `count`, `confidence`) and, when a snapshot was
  taken, its evidence id. No image data, no names, no question text.
- **Snapshots**: one JPEG at most 640 px wide (quality 0.7) every `snapshotIntervalSeconds` and one
  for each flag, uploaded to the evidence vault.
- **Never**: video, audio, or the per-frame model results. Frames are read into memory only and are
  not stored. Nothing is written to browser storage; the retry queue is in memory.

## Known limits

- Results depend on light, camera quality, camera angle and the device's speed. False flags and
  missed events will happen; every flag needs human review and nothing is penalised automatically
  (DECISIONS: AI scope).
- No accuracy figures have been measured, and none are claimed.
- A slow device skips detection cycles (one cycle runs at a time).
- Flags waiting for a resend (max 50) are lost if the page closes; snapshots are not retried.
- A frozen-feed check compares tiny grey frames; a very still scene with a very clean camera may look
  frozen, and a virtual camera playing a looped video may not.
- `window_blur` also fires for browser pop-ups such as the permission prompt.
- Camera and MediaPipe cannot run in the unit tests (jsdom); the tests cover the rules, the transport,
  and the engine with a fake detector and fake timers.

## Demo

In a development build, `aa_admin` can open `/proctoring-demo`. It opens the camera, runs the engine
with a local config, and shows the live detections and the flags raised. It sends nothing to the
server.

## Debug strip (X-06)

In a development build, add `?debug=1` to the exam address to see one line under the exam heading: engine status and message, the time the last detection cycle took, flags sent and failed, snapshots uploaded and failed, and the last error as a short text (status and code, for example `flag: 500 INTERNAL`). It holds counters only: no image, token or response body, and nothing is written to browser storage. A production build never shows it. Code: `web/src/proctoring/debug.ts`, `web/src/exam/ProctorDebugStrip.tsx`.

## Why a real session recorded no flags (X-06)

The flag POST saves the flag and bumps the session count in a MongoDB transaction. The development server was reaching a MongoDB that is not a replica set (a Windows service on 127.0.0.1:27017, while the Docker `rs0` replica set answered only on `::1`). That MongoDB refuses transactions with code 20 (IllegalOperation), so every flag POST failed with a 500 and the log showed `unhandled error 20`. The transport treats a 500 as "try again later", keeps the flag in its in-memory queue, and fails again, so the exam page looked fine and the session stayed at 0 flags and no images (the snapshot upload does not use a transaction, so interval snapshots could be saved, but they were never linked to a flag). The server now falls back to two plain writes when it sees code 20. The proper set-up is still one MongoDB on 27017, the replica set from docker-compose.yml; stop the Windows MongoDB service or change its port.
## Speed and candidate feedback (X-05)

- **Cadence.** Faces are checked every 500 ms (or the server's `detectionIntervalMs` if shorter); the object model runs every 2 s and its last result is reused in between (`web/src/proctoring/cadence.ts`). Frames are scaled to at most 320 px wide before detection (`createDetectionFramer`). The `Detector` interface is unchanged.
- **Skipping.** A tick that finds the previous one still running does nothing. No tick runs while the tab is hidden.
- **Timing.** `onTick(ms)` reports how long each check took; `/proctoring-demo` shows the average. Skipped ticks are not counted.
- **Flag notice.** `start()` takes an optional `onFlag({ type })`, called when the rules raise a flag. The exam page shows a centred, non-blocking card (`role="alertdialog"`, focus on OK) with one calm sentence per type (`web/src/exam/flagNotices.ts`), one at a time, merging repeats of a type inside `flagCooldownSeconds`. Nothing is stored or sent for it.
- **Chip and preview.** "Camera on", "Checking" or "Camera problem" (with the engine's reason), and a mirrored 160 x 120 view of the candidate's own camera. The view is not recorded.
- No flag rule, severity or result changed.

## Flag photo with a banner (X-07)

Every flag the engine raises takes one photo at that moment (the interval snapshot stays plain). The frame is copied first, then a black strip is added under it with white text, drawn on a canvas in the browser (`web/src/proctoring/banner.ts`):

1. flag name and severity ("No face in view | Medium severity")
2. the reason in one line ("Face not visible for 2 seconds"; built from `sustainedSeconds` in the session config)
3. date and time in IST, and the attempt short code (last 6 characters of the attempt id)
4. "Location: lat, lon (accuracy N m)", or "Location not shared"

The JPEG is at most 150 KB (`flagPhotoMaxBytes`): quality goes 0.7, 0.55, 0.4, 0.3, then the picture is made 25% smaller and tried again, up to 3 times. If it cannot fit, or there is no canvas, the flag is sent without a photo. One photo per flag, so the cooldown limits photos too.

Location (`web/src/proctoring/location.ts`) is used only when the batch has `captureLocation` on (the session response says so; the check screen shows "This exam records your location with flag photos." and the exam start asks the browser once). The position is requested with `getCurrentPosition` when a photo needs it, kept for 60 seconds and reused; `watchPosition` is never used. A refusal, a timeout (5 seconds) or a browser without geolocation gives "Location not shared"; nothing else changes. A refusal is also remembered for 60 seconds so the browser is not asked again at once.

The banner can be forged, so the flag body also carries `location` (when allowed) and the server keeps type, severity, both clocks and the encrypted coordinates itself. The review page shows the photo and the server's details side by side, with the server time next to the browser time that is drawn on the photo.
