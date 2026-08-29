# PULIH Model 1 v4 FP16 Web Integration Kit

This package contains the validated 31-class FP16 ONNX model and a minimal browser integration example. Start with [docs/INTEGRATION_README.md](docs/INTEGRATION_README.md).

Quick start:

```bash
npm install
npm run dev
```

Then open `http://localhost:5173/example/`.

Run `npm run build` to verify the example bundle. In a real application, copy the `model/` directory into the application's public/static directory so the `/model/...` URLs remain valid.

Important: the model is an identification aid, not removal authorization. When the result is `unknown`, do not show the candidate class as a confirmed identification.
