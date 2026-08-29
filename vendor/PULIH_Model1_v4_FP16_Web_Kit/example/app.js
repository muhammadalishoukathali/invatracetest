import { PulihModel1 } from "../src/model1-inference.js";

const loadButton = document.querySelector("#load-model");
const imageInput = document.querySelector("#plant-photo");
const predictButton = document.querySelector("#predict");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");

const model = new PulihModel1({
  model: "/model/efficientnet_v2_s_oe_v4_31class_web_fp16.onnx",
  config: "/model/inference_config.json",
  rejection: "/model/open_set_rejection_config_v1.json",
  species: "/model/species_31.json",
});

loadButton.addEventListener("click", async () => {
  loadButton.disabled = true;
  status.textContent = "Loading the 38.6 MiB FP16 model…";
  try {
    const metadata = await model.load();
    status.textContent = `Ready: ${metadata.modelVersion} using ${metadata.executionProvider}.`;
    imageInput.disabled = false;
  } catch (error) {
    status.textContent = `Load failed: ${error.message}`;
  } finally {
    loadButton.disabled = false;
  }
});

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  predictButton.disabled = !file;
  if (file) preview.src = URL.createObjectURL(file);
});

predictButton.addEventListener("click", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  predictButton.disabled = true;
  status.textContent = "Running local inference…";
  try {
    const prediction = await model.predict(file);
    result.textContent = JSON.stringify(prediction, null, 2);
    status.textContent = prediction.acceptedAsKnown
      ? `Candidate: ${prediction.candidate.species?.display_name ?? prediction.candidate.machineLabel}`
      : "Unknown/Other — request another photo or expert review.";
  } catch (error) {
    status.textContent = `Prediction failed: ${error.message}`;
  } finally {
    predictButton.disabled = false;
  }
});

