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

## What it detects

| Flag | When |
|---|---|
| `face_not_present` | No face above the confidence cut-off for `sustainedSeconds.face_not_present` |
| `multiple_faces` | Two or more faces |
| `person_detected` | Two or more people (the candidate is one) |
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
