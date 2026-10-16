# Face model files (P-03)

Served from `/models/face/` by the web app. Nothing is loaded from a CDN at run time.
Used by `web/src/proctoring/face/faceApiMatcher.ts`. See `docs/FACE_MATCH.md`.

## Source

All six files are copied unchanged from the `model/` folder of the npm package
`@vladmandic/face-api` **1.7.15** (pinned exactly in `web/package.json`):
https://github.com/vladmandic/face-api/tree/master/model

| File | Model | Bytes | SHA-256 |
|---|---|---:|---|
| `tiny_face_detector_model-weights_manifest.json` | Tiny face detector (manifest) | 3,219 | `5d1af4849ac48d5b985f4a9b16010c512353ddd6fcc63d50fd0bc9e9e64296e5` |
| `tiny_face_detector_model.bin` | Tiny face detector (weights) | 193,321 | `b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871` |
| `face_landmark_68_tiny_model-weights_manifest.json` | 68-point landmarks, tiny (manifest) | 4,806 | `9a1a5dd19fd814fd5095c3cb58f8e0d3193b8c5b9a6715b30a69d559aea31ad4` |
| `face_landmark_68_tiny_model.bin` | 68-point landmarks, tiny (weights) | 77,224 | `b98e9f2f7da76f8a6dda9741a36ed485b224b889d552de2b2c1bb16217f67bfc` |
| `face_recognition_model-weights_manifest.json` | Face recognition, 128-number descriptor (manifest) | 19,615 | `cbaffa501b0b9275a12b63357a6843e7e30c054e1c9151e1a5f879b26e32986b` |
| `face_recognition_model.bin` | Face recognition (weights) | 6,444,032 | `b413e420d6840b2775fba32008db6f3cddb07d485967fb42cfcf379c16a8c589` |

Total: 6,742,217 bytes (about 6.4 MB).

## Licence

- `@vladmandic/face-api`: MIT, Copyright (c) Vladimir Mandic.
- The models come from `face-api.js` by Vincent Mühler (MIT), which `@vladmandic/face-api` continues.
- The face recognition network is described upstream as a port of the dlib ResNet face recognition
  model. The licence of those original weights and of the data they were trained on has not been
  checked for this project. Confirm before real use (DECISIONS.md open question 684).

## Updating

Copy the files again from `node_modules/@vladmandic/face-api/model/` after changing the pinned
version, then update the sizes and checksums above (`sha256sum *` in this folder).
