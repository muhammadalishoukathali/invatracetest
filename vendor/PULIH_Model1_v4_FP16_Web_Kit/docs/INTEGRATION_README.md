# Web integration instructions

## 1. Release identity

- Model version: `oe_v4_31class_web_fp16`
- Architecture: EfficientNetV2-S
- Classes: 31
- ONNX precision: FP16 internal weights with FP32 input/output
- Model size: 38.613 MiB
- Input: `float32[1, 3, 384, 384]`
- Output: 31 raw logits
- Calibrated FP16 Unknown threshold: `0.5972920636499581`
- Offline validation status: passed; real-phone performance measurement is still pending

Do not substitute the FP32 threshold or the v3 threshold. Every exported precision has its own calibrated rejection configuration.

## 2. Files required at runtime

Copy these files into the public/static model directory of the web application:

```text
model/
├── efficientnet_v2_s_oe_v4_31class_web_fp16.onnx
├── inference_config.json
├── open_set_rejection_config_v1.json
├── class_catalog.json
└── species_31.json
```

`species_31.json` supplies display metadata. It is not a source of removal instructions. Look-alike comparisons and season-specific action guidance must be reviewed and maintained separately.

## 3. Install ONNX Runtime Web

```bash
npm install onnxruntime-web@1.27.0
```

The provided module imports `onnxruntime-web/webgpu`, attempts WebGPU first, and falls back to WASM. WebGPU requires HTTPS in production; localhost is allowed for development.

## 4. Integrate the module

Copy `src/model1-inference.js` into the application, then load and call it:

```javascript
import { PulihModel1 } from "./model1-inference.js";

const model = new PulihModel1({
  model: "/model/efficientnet_v2_s_oe_v4_31class_web_fp16.onnx",
  config: "/model/inference_config.json",
  rejection: "/model/open_set_rejection_config_v1.json",
  species: "/model/species_31.json",
});

const loadInfo = await model.load();
console.log(loadInfo);

const file = document.querySelector("input[type=file]").files[0];
const result = await model.predict(file);

if (!result.acceptedAsKnown) {
  showUnknownMessage();
} else {
  showCandidate(result.candidate.species, result.topPredictions);
}
```

Never determine Unknown from top-1 confidence alone. The validated decision uses four signals—MSP, top-two margin, energy, and entropy—followed by the calibrated logistic combiner in `open_set_rejection_config_v1.json`.

## 5. Exact preprocessing contract

The JavaScript module reproduces the frozen test transform:

1. Apply EXIF orientation and decode as RGB.
2. Resize the shorter side to `ceil(384 / 0.875) = 439` using high-quality interpolation.
3. Take a centered `384 × 384` crop.
4. Convert RGB values from `[0, 255]` to `[0, 1]`.
5. Normalize channels with:
   - mean: `[0.485, 0.456, 0.406]`
   - standard deviation: `[0.229, 0.224, 0.225]`
6. Convert HWC pixels to CHW `Float32Array`.
7. Create an ONNX tensor with shape `[1, 3, 384, 384]`.

Changing crop position, interpolation, channel order, normalization, temperature, class order, or threshold invalidates the reported metrics.

## 6. Result contract

`predict()` returns:

```json
{
  "modelVersion": "oe_v4_31class_web_fp16",
  "decision": "known",
  "acceptedAsKnown": true,
  "candidate": {
    "classIndex": 0,
    "machineLabel": "mimosa_pudica",
    "probability": 0.98,
    "species": {}
  },
  "topPredictions": [],
  "unknownProbability": 0.12,
  "unknownProbabilityThreshold": 0.5972920636499581,
  "signals": {},
  "safetyNotice": "Do not remove a plant based only on this automated prediction."
}
```

When `acceptedAsKnown` is `false`, the UI must display `Unknown/Other`. The candidate may be retained for internal review but must not be presented as a confirmed plant identity.

## 7. Hosting and PWA notes

- Serve the ONNX file over HTTPS with `Content-Type: application/octet-stream`.
- Keep the model filename versioned and cache it as an immutable asset.
- Cache the model in the service worker only after a successful full download.
- Show download progress: the model is approximately 38.6 MiB.
- Provide a WASM fallback for browsers without WebGPU.
- Test cold download, cached load, first inference, warm inference, memory use, and thermal behavior on real Android and iOS devices before production release.
- Cross-origin model hosting requires correct CORS headers.

## 8. Safety and privacy requirements

- Enforce accepted image formats and a reasonable file-size limit before decoding.
- Do not retain uploaded photos when inference runs on-device.
- Do not recommend plant removal solely from the model output.
- Send Unknown, low-quality, or high-risk cases to expert review.
- Log the model version and decision, but avoid storing the image or precise location without explicit consent.

An on-device PWA necessarily downloads the ONNX file to the user's browser. If model confidentiality is required, host inference behind a secured API instead of distributing this file.

## 9. Verified offline results

- Known-class accuracy: 98.235%
- Known acceptance rate: 95.246%
- Unknown recall: 95.614%
- Hard look-alike rejection: 94.432%
- Low-quality rejection: 95.261%
- Open-set AUROC: 98.815%
- TorchScript/FP16 top-1 agreement: 99.805%
- Source-threshold decision agreement: 100%

See the `qa/` directory for conversion, parity, readiness, and Windows runtime reports.

