import * as ort from 'onnxruntime-web/webgpu'
import type { IdentifyResult } from '@/types'

const MODEL_ROOT = import.meta.env.VITE_MODEL_BASE_URL || '/models/pulih-model1-v4'

interface RuntimeManifest {
  schemaVersion: 'invatrace.pulih-model-runtime.v1'
  modelVersion: string
  sha256: string
  bytes: number
  chunks: Array<{ name: string; bytes: number }>
}

interface InferenceConfig {
  version: string
  precision: string
  input_size: number
  mean: [number, number, number]
  std: [number, number, number]
  classes: string[]
}

interface RejectionConfig {
  classification_temperature: number
  decision: {
    feature_order: Array<'msp' | 'margin' | 'energy' | 'entropy'>
    scaler_mean: number[]
    scaler_scale: number[]
    coefficient: number[]
    intercept: number
    unknown_probability_threshold: number
  }
}

interface SpeciesEntry {
  class_index: number
  machine_label: string
  scientific_name: string
  display_name: string
  recognition_category: string
  malaysia_status: string
  status_source: string
}

interface SpeciesCatalog {
  model_version: string
  class_count: number
  classes: SpeciesEntry[]
}

type Progress = (loaded: number, total: number) => void
type ExecutionProvider = 'webgpu' | 'wasm'

export interface ModelRuntimeDiagnostics {
  provider: ExecutionProvider | null
  loadMs: number | null
  downloadMs: number | null
  lastInferenceMs: number | null
  webGpuFallback: boolean
}

export class PlantModelRuntimeError extends Error {
  constructor(
    readonly code: 'download' | 'integrity' | 'runtime' | 'image' | 'inference',
    message: string,
  ) {
    super(message)
    this.name = 'PlantModelRuntimeError'
  }
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

function recordMeasure(name: string, startedAt: number): number {
  const duration = elapsed(startedAt)
  try {
    performance.clearMeasures(name)
    performance.measure(name, { start: startedAt, duration })
  } catch {
    // Instrumentation must never prevent identification on older browsers.
  }
  return duration
}

function sigmoid(value: number): number {
  return value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value))
}

async function fetchJson<T>(name: string): Promise<T> {
  const response = await fetch(`${MODEL_ROOT}/${name}`, { cache: 'force-cache' })
  if (!response.ok) {
    throw new PlantModelRuntimeError(
      'download',
      `Failed to load ${name}: HTTP ${response.status}`,
    )
  }
  return response.json() as Promise<T>
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifiedModelBytes(manifest: RuntimeManifest, onProgress?: Progress): Promise<Uint8Array> {
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > 128 * 1024 * 1024) {
    throw new PlantModelRuntimeError('integrity', 'The PULIH model manifest size is invalid.')
  }
  const combined = new Uint8Array(manifest.bytes)
  let loaded = 0
  for (const chunk of manifest.chunks) {
    if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || loaded + chunk.bytes > manifest.bytes) {
      throw new PlantModelRuntimeError('integrity', `Model chunk ${chunk.name} has an invalid size.`)
    }
    const response = await fetch(`${MODEL_ROOT}/${chunk.name}`, { cache: 'force-cache' })
    if (!response.ok) {
      throw new PlantModelRuntimeError(
        'download',
        `Failed to load ${chunk.name}: HTTP ${response.status}`,
      )
    }
    const contentLength = response.headers.get('content-length')
    const declaredLength = contentLength === null ? null : Number(contentLength)
    if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength !== chunk.bytes) {
      throw new PlantModelRuntimeError('integrity', `Model chunk ${chunk.name} is incomplete.`)
    }
    const reader = response.body?.getReader()
    if (reader) {
      let chunkOffset = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (chunkOffset + value.byteLength > chunk.bytes) {
          await reader.cancel()
          throw new PlantModelRuntimeError('integrity', `Model chunk ${chunk.name} is too large.`)
        }
        combined.set(value, loaded + chunkOffset)
        chunkOffset += value.byteLength
        onProgress?.(loaded + chunkOffset, manifest.bytes)
      }
      if (chunkOffset !== chunk.bytes) {
        throw new PlantModelRuntimeError('integrity', `Model chunk ${chunk.name} is incomplete.`)
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength !== chunk.bytes) {
        throw new PlantModelRuntimeError('integrity', `Model chunk ${chunk.name} is incomplete.`)
      }
      combined.set(bytes, loaded)
      onProgress?.(loaded + bytes.byteLength, manifest.bytes)
    }
    loaded += chunk.bytes
  }
  if (loaded !== manifest.bytes) {
    throw new PlantModelRuntimeError('integrity', 'The PULIH model download is incomplete.')
  }
  const digest = hex(await crypto.subtle.digest('SHA-256', combined))
  if (digest !== manifest.sha256) {
    throw new PlantModelRuntimeError('integrity', 'The PULIH model checksum is invalid.')
  }
  return combined
}

function canvas(size: number): OffscreenCanvas | HTMLCanvasElement {
  if ('OffscreenCanvas' in globalThis) return new OffscreenCanvas(size, size)
  const element = document.createElement('canvas')
  element.width = size
  element.height = size
  return element
}

async function imageToTensor(image: Blob, config: InferenceConfig): Promise<ort.Tensor> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Image dimensions are invalid.')
    const size = config.input_size
    const resizeShortSide = Math.ceil(size / 0.875)
    const scale = resizeShortSide / Math.min(bitmap.width, bitmap.height)
    const cropWidth = size / scale
    const cropHeight = size / scale
    const sourceX = (bitmap.width - cropWidth) / 2
    const sourceY = (bitmap.height - cropHeight) / 2
    const target = canvas(size)
    const context = target.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!context) throw new Error('A 2D canvas is required for plant-model preprocessing.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, sourceX, sourceY, cropWidth, cropHeight, 0, 0, size, size)

    const rgba = context.getImageData(0, 0, size, size).data
    const plane = size * size
    const chw = new Float32Array(3 * plane)
    for (let index = 0; index < plane; index += 1) {
      chw[index] = (rgba[index * 4] / 255 - config.mean[0]) / config.std[0]
      chw[plane + index] = (rgba[index * 4 + 1] / 255 - config.mean[1]) / config.std[1]
      chw[plane * 2 + index] = (rgba[index * 4 + 2] / 255 - config.mean[2]) / config.std[2]
    }
    return new ort.Tensor('float32', chw, [1, 3, size, size])
  } finally {
    bitmap.close()
  }
}

function isInvasive(entry: SpeciesEntry): boolean {
  return entry.malaysia_status === 'invasive'
}

function interpret(
  logits: number[],
  config: InferenceConfig,
  rejection: RejectionConfig,
  speciesByLabel: Map<string, SpeciesEntry>,
): IdentifyResult {
  if (logits.length !== config.classes.length) {
    throw new Error(`Expected ${config.classes.length} logits but received ${logits.length}.`)
  }
  const temperature = rejection.classification_temperature
  const scaled = logits.map((value) => value / temperature)
  const maximum = Math.max(...scaled)
  const exponentials = scaled.map((value) => Math.exp(value - maximum))
  const denominator = exponentials.reduce((sum, value) => sum + value, 0)
  const probabilities = exponentials.map((value) => value / denominator)
  const ranked = probabilities
    .map((probability, classIndex) => ({ probability, classIndex }))
    .sort((left, right) => right.probability - left.probability)
  const signals = {
    msp: ranked[0].probability,
    margin: ranked[0].probability - ranked[1].probability,
    energy: -temperature * (maximum + Math.log(denominator)),
    entropy: -probabilities.reduce(
      (sum, probability) => sum + probability * Math.log(Math.max(probability, 1e-12)),
      0,
    ) / Math.log(probabilities.length),
  }
  let unknownLogit = rejection.decision.intercept
  rejection.decision.feature_order.forEach((name, index) => {
    unknownLogit += (
      (signals[name] - rejection.decision.scaler_mean[index])
      / rejection.decision.scaler_scale[index]
    ) * rejection.decision.coefficient[index]
  })
  const unknownProbability = sigmoid(unknownLogit)
  const accepted = unknownProbability <= rejection.decision.unknown_probability_threshold
  const best = ranked[0]
  const machineLabel = config.classes[best.classIndex]
  const species = speciesByLabel.get(machineLabel)
  const topPredictions = ranked.slice(0, 3).map((item) => {
    const label = config.classes[item.classIndex]
    const metadata = speciesByLabel.get(label)
    return {
      speciesId: label.replaceAll('_', '-'),
      name: metadata?.display_name ?? metadata?.scientific_name ?? label.replaceAll('_', ' '),
      confidence: item.probability,
      isInvasive: metadata ? isInvasive(metadata) : false,
    }
  })

  if (!accepted || !species) {
    return {
      outcome: 'uncertain',
      confidence: best.probability,
      modelVersion: config.version,
      unknownProbability,
      topPredictions,
      reportable: false,
    }
  }
  return {
    outcome: isInvasive(species) ? 'target' : 'other_plant',
    speciesId: machineLabel.replaceAll('_', '-'),
    speciesName: species.display_name,
    scientificName: species.scientific_name,
    malaysiaStatus: species.malaysia_status,
    statusSource: species.status_source,
    isInvasive: isInvasive(species),
    confidence: best.probability,
    modelVersion: config.version,
    unknownProbability,
    topPredictions,
    reportable: false,
  }
}

export class PulihModel {
  private session: ort.InferenceSession | null = null
  private config: InferenceConfig | null = null
  private rejection: RejectionConfig | null = null
  private speciesByLabel = new Map<string, SpeciesEntry>()
  private loading: Promise<void> | null = null
  private progress: { loaded: number; total: number } | null = null
  private progressListeners = new Set<Progress>()
  private diagnostics: ModelRuntimeDiagnostics = {
    provider: null,
    loadMs: null,
    downloadMs: null,
    lastInferenceMs: null,
    webGpuFallback: false,
  }

  async load(onProgress?: Progress): Promise<void> {
    if (onProgress) {
      this.progressListeners.add(onProgress)
      if (this.progress) onProgress(this.progress.loaded, this.progress.total)
    }
    if (this.session) {
      if (onProgress) this.progressListeners.delete(onProgress)
      return
    }
    if (!this.loading) {
      this.loading = this.loadOnce((loaded, total) => {
        this.progress = { loaded, total }
        this.progressListeners.forEach((listener) => listener(loaded, total))
      }).catch((error) => {
        this.progress = null
        throw error
      }).finally(() => {
        this.loading = null
      })
    }
    try {
      await this.loading
    } finally {
      if (onProgress) this.progressListeners.delete(onProgress)
    }
  }

  private async loadOnce(onProgress?: Progress): Promise<void> {
    const loadStartedAt = performance.now()
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
      : 1
    ort.env.wasm.initTimeout = 30_000
    const [manifest, config, rejection, catalog] = await Promise.all([
      fetchJson<RuntimeManifest>('runtime-manifest.json'),
      fetchJson<InferenceConfig>('inference_config.json'),
      fetchJson<RejectionConfig>('open_set_rejection_config_v1.json'),
      fetchJson<SpeciesCatalog>('species_31.json'),
    ])
    if (manifest.modelVersion !== config.version || catalog.model_version !== config.version) {
      throw new PlantModelRuntimeError('integrity', 'PULIH model metadata versions do not agree.')
    }
    if (config.classes.length !== 31 || catalog.class_count !== 31) {
      throw new PlantModelRuntimeError(
        'integrity',
        'The validated PULIH v4 integration requires exactly 31 classes.',
      )
    }
    const downloadStartedAt = performance.now()
    const modelBytes = await verifiedModelBytes(manifest, onProgress)
    const downloadMs = recordMeasure('invatrace:model-download', downloadStartedAt)
    let provider: ExecutionProvider | null = null
    let webGpuFallback = false
    const webGpuNavigator = navigator as Navigator & { gpu?: unknown }
    if (webGpuNavigator.gpu) {
      try {
        this.session = await ort.InferenceSession.create(modelBytes, {
          executionProviders: ['webgpu'], graphOptimizationLevel: 'all',
        })
        provider = 'webgpu'
      } catch {
        webGpuFallback = true
      }
    }
    if (!this.session) {
      try {
        this.session = await ort.InferenceSession.create(modelBytes, {
          executionProviders: ['wasm'], graphOptimizationLevel: 'all',
        })
        provider = 'wasm'
      } catch (error) {
        throw new PlantModelRuntimeError(
          'runtime',
          `The plant model runtime could not start: ${error instanceof Error ? error.message : 'unknown error'}`,
        )
      }
    }
    this.config = config
    this.rejection = rejection
    this.speciesByLabel = new Map(catalog.classes.map((entry) => [entry.machine_label, entry]))
    this.diagnostics = {
      provider,
      loadMs: recordMeasure('invatrace:model-load', loadStartedAt),
      downloadMs,
      lastInferenceMs: null,
      webGpuFallback,
    }
  }

  async predict(image: Blob, onProgress?: Progress): Promise<IdentifyResult> {
    await this.load(onProgress)
    if (!this.session || !this.config || !this.rejection) {
      throw new PlantModelRuntimeError('runtime', 'PULIH model unavailable.')
    }
    let tensor: ort.Tensor
    try {
      tensor = await imageToTensor(image, this.config)
    } catch (error) {
      throw new PlantModelRuntimeError(
        'image',
        `The image could not be prepared for analysis: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
    const inferenceStartedAt = performance.now()
    let outputs: ort.InferenceSession.OnnxValueMapType
    try {
      outputs = await this.session.run({ [this.session.inputNames[0]]: tensor })
    } catch (error) {
      throw new PlantModelRuntimeError(
        'inference',
        `Plant analysis failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
    this.diagnostics.lastInferenceMs = recordMeasure(
      'invatrace:model-inference',
      inferenceStartedAt,
    )
    const logits = Array.from(outputs[this.session.outputNames[0]].data, Number)
    return interpret(logits, this.config, this.rejection, this.speciesByLabel)
  }

  getDiagnostics(): ModelRuntimeDiagnostics {
    return { ...this.diagnostics }
  }
}
