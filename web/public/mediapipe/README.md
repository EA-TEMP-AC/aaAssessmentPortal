# MediaPipe files (served locally)

The proctoring engine (`web/src/proctoring/mediapipeDetector.ts`) loads these from `/mediapipe/`
so nothing is fetched from a CDN when an exam runs. Do not rename them.

| File | Size (bytes) | Source | Licence |
|---|---|---|---|
| `wasm/vision_wasm_internal.js` | 209,826 | npm `@mediapipe/tasks-vision@0.10.14`, folder `wasm/` | Apache-2.0 |
| `wasm/vision_wasm_internal.wasm` | 9,423,986 | same | Apache-2.0 |
| `wasm/vision_wasm_nosimd_internal.js` | 209,735 | same (fallback for browsers without SIMD) | Apache-2.0 |
| `wasm/vision_wasm_nosimd_internal.wasm` | 9,294,247 | same | Apache-2.0 |
| `models/blaze_face_short_range.tflite` | 229,746 | https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite | Apache-2.0 (MediaPipe model card) |
| `models/efficientdet_lite0.tflite` | 4,602,795 | https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite | Apache-2.0 (MediaPipe model card) |

SHA-256:

```
9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c  wasm/vision_wasm_internal.js
f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc  wasm/vision_wasm_internal.wasm
abe9b6fbeaf86fcb53a5edce3926c82ccb0619e18fed4d9d9ce561ee7f55e054  wasm/vision_wasm_nosimd_internal.js
38b61feab2fd7934e05cbe9f68baa308978a5e3b7f85c1913bb8ae89b8ef8b97  wasm/vision_wasm_nosimd_internal.wasm
b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f  models/blaze_face_short_range.tflite
0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb  models/efficientdet_lite0.tflite
```

When `@mediapipe/tasks-vision` is upgraded in `web/package.json`, copy the new `wasm/` folder here
too; the wasm and the JavaScript library must be the same version.
