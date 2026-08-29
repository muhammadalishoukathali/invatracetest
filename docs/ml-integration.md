# ML integration boundaries

## Browser E1 plant model

The supplied `PULIH_Model1_v4_FP16_Web_Kit` is copied intact under `vendor/` and
its published SHA-256 values are verified before every build. It is an
EfficientNetV2-S 31-class classifier with FP16 internal weights, FP32
`[1,3,384,384]` input/output, and calibrated open-set rejection.

The browser reproduces the kit's centre crop, normalization, temperature,
MSP/margin/energy/entropy combiner, threshold, and class order. An Unknown result
never exposes the top candidate as an identity or removal permission. The 38.6
MiB ONNX file is split into two verified static chunks for Cloudflare Pages; the
browser reassembles it and checks the original digest before local inference.
WebGPU is preferred with WASM fallback. No external inference API is used.

The scan route and runtime are lazy-loaded. Model chunks are streamed into one
preallocated buffer to avoid holding both chunk arrays and a second full model
copy, and concurrent load calls share one initialization promise and session.
Versioned model files and the hashed WASM runtime use cache-first storage after
their first successful download. A failed download resets the loader so the
same photo can be retried. Browser performance entries named
`invatrace:model-download`, `invatrace:model-load`, and
`invatrace:model-inference` expose the latest timings without collecting image
or identity data.

## Server verification provider

`app.ml.plant.provider.PlantModelProvider` separates detection, quality checks,
identification, embeddings, and health. The durable worker reads a private photo,
runs those operations with a timeout, and stores the provider/model/device and
outputs in normalized inference tables.

Two providers ship:

- `fake`: deterministic development/test contract fake, marked `fake=true` in
  health and inference metadata.
- `unavailable`: production-safe boundary that keeps the report private as
  `validation_unavailable` when no server model artifact has been supplied.

Production startup rejects `PLANT_MODEL_PROVIDER=fake`, and `/health/ready`
returns 503 when the automated validator is unavailable. The required E2 model
handoff is specified in `docs/e2-validator-model-requirements.txt`. Adding that
provider does not change the report contract or introduce a human coordinator.

## OVC-VI connector status

The supplied Section 3 material describes model behavior but does not include a
complete runnable implementation, trained artifacts, evaluation data, or an
approved runtime dependency. The backend therefore implements only the
framework-neutral connector, durable schema boundaries, checkpoint contract,
and deterministic contract fake. It makes no calibrated uncertainty or CRPS
claim.

The connector enforces these invariants:

- Prediction accepts timestamped features and prior state only. A current label
  is not part of the prediction input.
- A delayed label can be applied only after that event has a stored prediction.
- Repeated ingestion of the same stream/event returns the existing prediction.
- Predictive samples, intervals, optional CRPS outputs, drift metadata, feature
  schema version, model version, and state version have explicit storage fields.
- Checkpoint and restore are provider operations, while persistence is delegated
  to a state store.

To integrate a real implementation, supply an `OvcviProvider` that implements
`health`, `predict`, `apply_label`, `checkpoint`, and `restore`; then implement
the PostgreSQL-backed `OvcviStateStore` using `ovcvi_stream_events` and
`ovcvi_checkpoints`. Run predict-before-update replay tests, delayed-label
ordering tests, restart/checkpoint tests, and offline CRPS/calibration evaluation
before enabling it. Until those artifacts exist, keep the provider unavailable
in production and do not advertise live uncertainty forecasts.
