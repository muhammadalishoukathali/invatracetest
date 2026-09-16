import * as ort from 'onnxruntime-web/webgpu'
import type { IdentifyResult } from '@/types'
import { findApprovedSpecies, findPlantStatus } from '@shared/catalogue'

/**
 * ONNX inference boundary for the InvaTrace Student33 model. Owns the model
 * session end to end: downloading the ONNX file, verifying its SHA-256 against
 * the runtime manifest, starting the onnxruntime-web session (WebGPU with a
 * WASM fallback), turning a photo into the tensor shape the model expects, and
 * turning the raw logits back into an IdentifyResult. Unknown handling uses a
 * calibrated max-core-probability threshold; class index 32 is the
 * Unknown/Other bucket.
 *
 * plant-model-adapter.ts sits above this file and doesn't touch ONNX at all -
 * it picks which model implementation the app should run (this real one, a
 * fake dev one, or a disabled stub) and adapts whichever gets picked to the
 * shape the UI expects. Nothing outside plant-model-adapter.ts should import
 * this file directly.
 */

const MODEL_ROOT = import.meta.env.VITE_MODEL_BASE_URL || '/models/invatrace-student33-v1'

interface RuntimeManifest {
  schemaVersion: 'invatrace.student33-runtime.v1'
  modelVersion: string
  modelFile: string
  sha256: string
  bytes: number
  inputName: string
  inputShape: [number, number, number, number]
  outputName: string
  classCount: number
  unknownIndex: number
  inputSize: number
  resizeShortSide: number
  mean: [number, number, number]
  std: [number, number, number]
  temperature: number
  unknownProbabilityThreshold: number
  /** Max core probability at or above which the local model's answer is used
   *  directly - no PlantNet handover. */
  confidentThreshold?: number
  /** Below `confidentThreshold` but at or above this value, the adapter asks
   *  PlantNet for a second opinion. */
  handoverThreshold?: number
  /** At or below this value the adapter refuses to spend a PlantNet call on
   *  the photo and asks the user to retake instead. */
  retakeThreshold?: number
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
  schema_version: string
  model_version: string
  class_count: number
  unknown_index: number
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

// The ONNX file is fetched once, streamed for progress, and SHA-256'd against
// the runtime manifest before it's ever handed to onnxruntime. Since this is
// on-device inference over a network path I don't fully trust, a corrupted or
// tampered download needs to fail loudly right here rather than silently
// producing garbage predictions further down the line.
async function verifiedModelBytes(manifest: RuntimeManifest, onProgress?: Progress): Promise<Uint8Array> {
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > 128 * 1024 * 1024) {
    throw new PlantModelRuntimeError('integrity', 'The plant model manifest size is invalid.')
  }
  const response = await fetch(`${MODEL_ROOT}/${manifest.modelFile}`, { cache: 'force-cache' })
  if (!response.ok) {
    throw new PlantModelRuntimeError(
      'download',
      `Failed to load ${manifest.modelFile}: HTTP ${response.status}`,
    )
  }
  const contentLength = response.headers.get('content-length')
  const declaredLength = contentLength === null ? null : Number(contentLength)
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength !== manifest.bytes) {
    throw new PlantModelRuntimeError('integrity', 'Model download size does not match manifest.')
  }
  const combined = new Uint8Array(manifest.bytes)
  let loaded = 0
  const reader = response.body?.getReader()
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (loaded + value.byteLength > manifest.bytes) {
        await reader.cancel()
        throw new PlantModelRuntimeError('integrity', 'Model download is larger than manifest declared.')
      }
      combined.set(value, loaded)
      loaded += value.byteLength
      onProgress?.(loaded, manifest.bytes)
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== manifest.bytes) {
      throw new PlantModelRuntimeError('integrity', 'Model download is incomplete.')
    }
    combined.set(bytes, 0)
    loaded = bytes.byteLength
    onProgress?.(loaded, manifest.bytes)
  }
  if (loaded !== manifest.bytes) {
    throw new PlantModelRuntimeError('integrity', 'Model download is incomplete.')
  }
  const digest = hex(await crypto.subtle.digest('SHA-256', combined))
  if (digest !== manifest.sha256) {
    throw new PlantModelRuntimeError('integrity', 'Plant model checksum is invalid.')
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

async function imageToTensor(image: Blob, manifest: RuntimeManifest): Promise<ort.Tensor> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Image dimensions are invalid.')
    const size = manifest.inputSize
    // Match the validation pipeline exactly: resize so the shorter side is
    // resizeShortSide pixels, then centre-crop to size x size. Getting this
    // wrong makes every prediction subtly off because the model would see a
    // slightly different field of view than it learned on.
    const resizeShortSide = manifest.resizeShortSide
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
    // ONNX wants channel-first (CHW) data, but canvas gives back interleaved
    // RGBA (HWC). This loop de-interleaves and applies per-channel normalize
    // in one pass since it runs on-device for every scan.
    const chw = new Float32Array(3 * plane)
    for (let index = 0; index < plane; index += 1) {
      chw[index] = (rgba[index * 4] / 255 - manifest.mean[0]) / manifest.std[0]
      chw[plane + index] = (rgba[index * 4 + 1] / 255 - manifest.mean[1]) / manifest.std[1]
      chw[plane * 2 + index] = (rgba[index * 4 + 2] / 255 - manifest.mean[2]) / manifest.std[2]
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
  manifest: RuntimeManifest,
  catalog: SpeciesCatalog,
  speciesByLabel: Map<string, SpeciesEntry>,
): IdentifyResult {
  if (logits.length !== catalog.class_count) {
    throw new Error(`Expected ${catalog.class_count} logits but received ${logits.length}.`)
  }
  // Temperature scaling on the logits before softmax is what makes the
  // model's confidence numbers actually mean something for the calibrated
  // Unknown gate.
  const temperature = manifest.temperature
  const scaled = logits.map((value) => value / temperature)
  const maximum = Math.max(...scaled)
  const exponentials = scaled.map((value) => Math.exp(value - maximum))
  const denominator = exponentials.reduce((sum, value) => sum + value, 0)
  const probabilities = exponentials.map((value) => value / denominator)

  const unknownIndex = manifest.unknownIndex
  const coreProbabilities = probabilities.slice(0, unknownIndex)
  const coreRanked = coreProbabilities
    .map((probability, classIndex) => ({ probability, classIndex }))
    .sort((left, right) => right.probability - left.probability)
  const bestCore = coreRanked[0]
  const maxCoreProbability = bestCore.probability

  // Three-tier confidence band, tuned by the runtime manifest so we can
  // shift the boundaries without an app release. The bands are:
  //   * >= confidentThreshold           - trust the local classification
  //   * [handoverThreshold, confident)  - uncertain, hand over to PlantNet
  //   * [retakeThreshold, handover)     - too weak for PlantNet, retake first
  //   *  < retakeThreshold              - extreme low certainty, retake with a
  //                                       stronger nudge
  // confidentThreshold falls back to the historical unknownProbabilityThreshold
  // so a manifest without the new fields keeps the old two-tier behaviour.
  const confidentThreshold = manifest.confidentThreshold ?? manifest.unknownProbabilityThreshold
  const handoverThreshold = manifest.handoverThreshold ?? manifest.unknownProbabilityThreshold
  const retakeThreshold = manifest.retakeThreshold ?? 0
  const isUnknown = maxCoreProbability < confidentThreshold
  const retakeAdvice = maxCoreProbability < retakeThreshold
    ? {
        reason: 'low_certainty' as const,
        message: 'The plant could not be recognised from this photo. Try again with better lighting and one leaf or flower in focus.',
      }
    : maxCoreProbability < handoverThreshold
      ? {
          reason: 'low_certainty' as const,
          message: 'The photo was too unclear for a reliable identification. Retake with the plant filling the frame and even lighting.',
        }
      : undefined

  const topPredictions = coreRanked.slice(0, 3).map((item) => {
    const entry = catalog.classes[item.classIndex]
    const metadata = speciesByLabel.get(entry.machine_label)
    return {
      speciesId: entry.machine_label.replaceAll('_', '-'),
      name: metadata?.display_name ?? entry.display_name ?? entry.scientific_name,
      confidence: item.probability,
      isInvasive: metadata ? isInvasive(metadata) : false,
    }
  })

  if (isUnknown) {
    return {
      outcome: 'uncertain',
      confidence: maxCoreProbability,
      modelVersion: manifest.modelVersion,
      unknownProbability: probabilities[unknownIndex] ?? (1 - maxCoreProbability),
      topPredictions,
      reportable: false,
      ...(retakeAdvice ? { retakeAdvice } : {}),
    }
  }

  const entry = catalog.classes[bestCore.classIndex]
  const species = speciesByLabel.get(entry.machine_label)
  if (!species) {
    return {
      outcome: 'uncertain',
      confidence: maxCoreProbability,
      modelVersion: manifest.modelVersion,
      unknownProbability: probabilities[unknownIndex] ?? (1 - maxCoreProbability),
      topPredictions,
      reportable: false,
      ...(retakeAdvice ? { retakeAdvice } : {}),
    }
  }
  return {
    outcome: isInvasive(species) ? 'target' : 'other_plant',
    speciesId: entry.machine_label.replaceAll('_', '-'),
    speciesName: species.display_name,
    scientificName: species.scientific_name,
    malaysiaStatus: species.malaysia_status,
    statusSource: species.status_source,
    isInvasive: isInvasive(species),
    confidence: maxCoreProbability,
    modelVersion: manifest.modelVersion,
    unknownProbability: probabilities[unknownIndex] ?? (1 - maxCoreProbability),
    topPredictions,
    reportable: false,
  }
}

export class PulihModel {
  private session: ort.InferenceSession | null = null
  private manifest: RuntimeManifest | null = null
  private catalog: SpeciesCatalog | null = null
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
    const [manifest, catalog] = await Promise.all([
      fetchJson<RuntimeManifest>('runtime-manifest.json'),
      fetchJson<SpeciesCatalog>('student33_species.json'),
    ])
    if (manifest.modelVersion !== catalog.model_version) {
      throw new PlantModelRuntimeError('integrity', 'Plant model metadata versions do not agree.')
    }
    if (catalog.class_count !== manifest.classCount || catalog.classes.length !== manifest.classCount) {
      throw new PlantModelRuntimeError(
        'integrity',
        `The plant model integration requires exactly ${manifest.classCount} classes.`,
      )
    }
    if (catalog.unknown_index !== manifest.unknownIndex) {
      throw new PlantModelRuntimeError('integrity', 'Plant model unknown index disagrees with catalogue.')
    }
    const downloadStartedAt = performance.now()
    const modelBytes = await verifiedModelBytes(manifest, onProgress)
    const downloadMs = recordMeasure('invatrace:model-download', downloadStartedAt)
    let provider: ExecutionProvider | null = null
    let webGpuFallback = false
    const webGpuNavigator = navigator as Navigator & { gpu?: unknown }
    // WebGPU is a lot faster so it's preferred whenever the device advertises
    // it, but not every browser exposing navigator.gpu can actually create a
    // working session in practice; falling through to WASM here beats failing
    // the whole scan over a GPU quirk.
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
    this.manifest = manifest
    this.catalog = catalog
    // The model manifest's own malaysia_status field is ignored - the shared
    // catalogue's approved list is the trusted source. If a class has no
    // approved-catalogue record, it gets downgraded to status_uncertain so an
    // older bundled model can never quietly unlock reporting on its own.
    this.speciesByLabel = new Map(
      catalog.classes.map((entry) => {
        const record = findPlantStatus({ modelLabel: entry.machine_label })
        const approved = findApprovedSpecies({ scientificName: entry.scientific_name })
        const overlaidStatus = approved ? 'invasive' : 'status_uncertain'
        const overlaidSource = approved?.evidence_source_ids[0] ?? record?.status_source_ids[0] ?? ''
        return [
          entry.machine_label,
          { ...entry, malaysia_status: overlaidStatus, status_source: overlaidSource },
        ]
      }),
    )
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
    if (!this.session || !this.manifest || !this.catalog) {
      throw new PlantModelRuntimeError('runtime', 'Plant model unavailable.')
    }
    let tensor: ort.Tensor
    try {
      tensor = await imageToTensor(image, this.manifest)
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
    return interpret(logits, this.manifest, this.catalog, this.speciesByLabel)
  }

  getDiagnostics(): ModelRuntimeDiagnostics {
    return { ...this.diagnostics }
  }
}
