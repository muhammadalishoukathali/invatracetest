import * as ort from "onnxruntime-web/webgpu";

const DEFAULT_URLS = {
  model: "/model/efficientnet_v2_s_oe_v4_31class_web_fp16.onnx",
  config: "/model/inference_config.json",
  rejection: "/model/open_set_rejection_config_v1.json",
  species: "/model/species_31.json",
};

function sigmoid(value) {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return response.json();
}

async function decodeImage(file) {
  if ("createImageBitmap" in globalThis) {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected image could not be decoded."));
    };
    image.src = url;
  });
}

function createCanvas(size) {
  if ("OffscreenCanvas" in globalThis) return new OffscreenCanvas(size, size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

async function imageToTensor(file, config) {
  const image = await decodeImage(file);
  const size = config.input_size;
  const resizeShortSide = Math.ceil(size / 0.875);
  const width = image.width;
  const height = image.height;
  const scale = resizeShortSide / Math.min(width, height);
  const cropWidth = size / scale;
  const cropHeight = size / scale;
  const sourceX = (width - cropWidth) / 2;
  const sourceY = (height - cropHeight) / 2;
  const canvas = createCanvas(size);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("A 2D canvas context is required for image preprocessing.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, size, size);
  if (typeof image.close === "function") image.close();

  const rgba = context.getImageData(0, 0, size, size).data;
  const plane = size * size;
  const chw = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index += 1) {
    chw[index] = (rgba[index * 4] / 255 - config.mean[0]) / config.std[0];
    chw[plane + index] = (rgba[index * 4 + 1] / 255 - config.mean[1]) / config.std[1];
    chw[plane * 2 + index] = (rgba[index * 4 + 2] / 255 - config.mean[2]) / config.std[2];
  }
  return new ort.Tensor("float32", chw, [1, 3, size, size]);
}

function interpretLogits(logits, config, rejection, speciesByLabel) {
  if (logits.length !== config.classes.length) {
    throw new Error(`Expected ${config.classes.length} logits but received ${logits.length}.`);
  }
  const temperature = rejection.classification_temperature;
  const scaled = logits.map((value) => value / temperature);
  const maximum = Math.max(...scaled);
  const exponentials = scaled.map((value) => Math.exp(value - maximum));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0);
  const probabilities = exponentials.map((value) => value / denominator);
  const ranked = probabilities
    .map((probability, classIndex) => ({ probability, classIndex }))
    .sort((left, right) => right.probability - left.probability);

  const msp = ranked[0].probability;
  const margin = ranked[0].probability - ranked[1].probability;
  const energy = -temperature * (maximum + Math.log(denominator));
  const entropy =
    -probabilities.reduce(
      (sum, probability) => sum + probability * Math.log(Math.max(probability, 1e-12)),
      0,
    ) / Math.log(probabilities.length);
  const signals = { msp, margin, energy, entropy };
  const decision = rejection.decision;
  let unknownLogit = decision.intercept;
  decision.feature_order.forEach((name, index) => {
    unknownLogit +=
      ((signals[name] - decision.scaler_mean[index]) / decision.scaler_scale[index]) *
      decision.coefficient[index];
  });
  const unknownProbability = sigmoid(unknownLogit);
  const acceptedAsKnown = unknownProbability <= decision.unknown_probability_threshold;

  const topPredictions = ranked.slice(0, 3).map(({ probability, classIndex }) => {
    const machineLabel = config.classes[classIndex];
    return {
      classIndex,
      machineLabel,
      probability,
      species: speciesByLabel.get(machineLabel) ?? null,
    };
  });

  return {
    modelVersion: config.version,
    decision: acceptedAsKnown ? "known" : "unknown",
    acceptedAsKnown,
    candidate: topPredictions[0],
    topPredictions,
    unknownProbability,
    unknownProbabilityThreshold: decision.unknown_probability_threshold,
    signals,
    safetyNotice: acceptedAsKnown
      ? "Do not remove a plant based only on this automated prediction."
      : "Unknown/Other: do not remove the plant; capture more views or request expert review.",
  };
}

export class PulihModel1 {
  constructor(urls = {}) {
    this.urls = { ...DEFAULT_URLS, ...urls };
    this.session = null;
    this.config = null;
    this.rejection = null;
    this.speciesByLabel = new Map();
    this.executionProvider = null;
  }

  async load() {
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
      : 1;
    const [config, rejection, species, modelResponse] = await Promise.all([
      fetchJson(this.urls.config),
      fetchJson(this.urls.rejection),
      fetchJson(this.urls.species),
      fetch(this.urls.model),
    ]);
    if (!modelResponse.ok) {
      throw new Error(`Failed to load ${this.urls.model}: HTTP ${modelResponse.status}`);
    }
    if (config.classes.length !== 31 || species.class_count !== 31) {
      throw new Error("This integration kit requires the validated 31-class v4 configuration.");
    }
    this.config = config;
    this.rejection = rejection;
    this.speciesByLabel = new Map(species.classes.map((entry) => [entry.machine_label, entry]));
    const modelBytes = new Uint8Array(await modelResponse.arrayBuffer());

    if (navigator.gpu) {
      try {
        this.session = await ort.InferenceSession.create(modelBytes, {
          executionProviders: ["webgpu"],
          graphOptimizationLevel: "all",
        });
        this.executionProvider = "webgpu";
      } catch (error) {
        console.warn("WebGPU initialization failed; falling back to WASM.", error);
      }
    }
    if (!this.session) {
      this.session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      this.executionProvider = "wasm";
    }
    return {
      modelVersion: config.version,
      classCount: config.classes.length,
      precision: config.precision,
      executionProvider: this.executionProvider,
      modelBytes: modelBytes.byteLength,
    };
  }

  async predict(file) {
    if (!this.session || !this.config || !this.rejection) {
      throw new Error("Call load() before predict().");
    }
    const tensor = await imageToTensor(file, this.config);
    const inputName = this.session.inputNames[0];
    const outputName = this.session.outputNames[0];
    const outputs = await this.session.run({ [inputName]: tensor });
    const logits = Array.from(outputs[outputName].data, Number);
    return interpretLogits(logits, this.config, this.rejection, this.speciesByLabel);
  }
}

