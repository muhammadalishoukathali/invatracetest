import type { BBox, QualityResult, IdentifyResult } from '@/types'
import { modelSpeciesCatalog } from '@/data/model-species-catalog'
import { hashBitmap } from './image-processing'
import { PulihModel } from './pulih-model'
import { verifyWithPlantNet } from './plantnet-verify'

/**
 * This is the seam between the scan UI and whatever model is actually
 * running. It picks which ModelAdapter implementation gets used - the real
 * PULIH ONNX model from pulih-model.ts, a deterministic fake for local dev,
 * or a fail-closed stub when nothing is configured - and gives all three the
 * same detect/quality/identify shape, so ScanCapturePage doesn't need to know
 * or care which one it's actually talking to. pulih-model.ts owns the real
 * ONNX session; this file's job is just deciding when to use it and
 * normalizing whatever comes back.
 */
interface ModelAdapter {
  detect(image: ImageBitmap): Promise<{ box: BBox | null }>
  quality(image: ImageBitmap): Promise<QualityResult>
  identify(image: Blob, onProgress?: (loaded: number, total: number) => void): Promise<IdentifyResult>
}

const DEVELOPMENT_MODEL_VERSION = `development-${modelSpeciesCatalog.model_version}`
const DEVELOPMENT_UNKNOWN_BUCKETS = 5

/**
 * A deterministic stand-in for local UI development, so I'm not stuck waiting
 * on the real ~30MB model just to work on the screens. It mirrors the real
 * model's full class catalogue and Malaysia-status split instead of me
 * hand-maintaining a second species list that would inevitably drift out of
 * sync with the real one.
 */
export function developmentIdentifyResultForHash(imageHash: number): IdentifyResult {
  const classes = modelSpeciesCatalog.classes
  const bucket = Math.abs(imageHash) % (classes.length + DEVELOPMENT_UNKNOWN_BUCKETS)
  if (bucket >= classes.length) {
    return {
      outcome: 'uncertain',
      confidence: 0.42,
      modelVersion: DEVELOPMENT_MODEL_VERSION,
      reportable: false,
    }
  }

  const species = classes[bucket]
  const invasive = species.catalogue_approved && species.malaysia_status === 'invasive'
  return {
    outcome: invasive ? 'target' : 'other_plant',
    speciesId: species.machine_label.replaceAll('_', '-'),
    speciesName: species.display_name,
    scientificName: species.scientific_name,
    malaysiaStatus: species.malaysia_status,
    statusSource: species.status_source,
    isInvasive: invasive,
    confidence: Math.min(0.96, 0.82 + (Math.abs(imageHash) % 15) / 100),
    modelVersion: DEVELOPMENT_MODEL_VERSION,
    reportable: invasive,
  }
}

class DevelopmentModelAdapter implements ModelAdapter {
  async detect(image: ImageBitmap): Promise<{ box: BBox | null }> {
    await waitForMockInference(80)
    const paddingRatio = 0.1
    return {
      box: {
        x: Math.round(image.width * paddingRatio),
        y: Math.round(image.height * paddingRatio),
        w: Math.round(image.width * (1 - 2 * paddingRatio)),
        h: Math.round(image.height * (1 - 2 * paddingRatio)),
      },
    }
  }

  async quality(image: ImageBitmap): Promise<QualityResult> {
    await waitForMockInference(120)
    if (image.width < 100 || image.height < 100) {
      return { ok: false, reason: 'Image resolution too low - move closer to the plant and retake.' }
    }
    const imageHash = hashBitmap(image)
    if (imageHash % 17 === 0) {
      return { ok: false, reason: 'Subject is too blurry - hold steady and ensure good lighting.' }
    }
    return { ok: true }
  }

  async identify(image: Blob): Promise<IdentifyResult> {
    await waitForMockInference(300)
    const bitmap = await createImageBitmap(image)
    const imageHash = hashBitmap(bitmap)
    bitmap.close()
    return developmentIdentifyResultForHash(imageHash)
  }

}

/** Makes scanning fail closed on purpose, for whenever the real model is
 *  deliberately turned off rather than just unavailable. */
class UnavailableAdapter implements ModelAdapter {
  async detect(): Promise<{ box: BBox | null }> {
    throw new Error('Plant model unavailable')
  }

  async quality(): Promise<QualityResult> {
    return {
      ok: false,
      reason: 'Plant analysis is not available because no approved model is configured.',
    }
  }

  async identify(): Promise<IdentifyResult> {
    throw new Error('Plant model unavailable')
  }
}

const sharedPulihModel = new PulihModel()

class PulihAdapter implements ModelAdapter {
  private readonly model = sharedPulihModel

  async detect(image: ImageBitmap): Promise<{ box: BBox | null }> {
    // Student33 is a frozen centre-crop classifier, not an actual object
    // detector, so there's no real bounding box to return. Returning the exact
    // crop that preprocessing uses (320 out of a 366-short-side resize, so
    // 320/366 of the shorter dimension) keeps the on-screen framing guide
    // honest about what the model is actually going to look at.
    const side = Math.round(Math.min(image.width, image.height) * (320 / 366))
    return {
      box: {
        x: Math.round((image.width - side) / 2),
        y: Math.round((image.height - side) / 2),
        w: side,
        h: side,
      },
    }
  }

  async quality(image: ImageBitmap): Promise<QualityResult> {
    if (Math.min(image.width, image.height) < 320) {
      return { ok: false, reason: 'Photo resolution is too low - move closer and retake.' }
    }
    return { ok: true }
  }

  async identify(image: Blob, onProgress?: (loaded: number, total: number) => void) {
    // Cheap pre-flight: images below the model's expected crop size can't
    // possibly produce a useful prediction, so short-circuit to a retake CTA
    // before spending the ONNX session. Uses createImageBitmap directly
    // rather than the quality() gate because quality() returns a message
    // for the capture screen; here we want to inject the same signal into
    // the identify pipeline as a structured retakeAdvice.
    try {
      const bitmap = await createImageBitmap(image)
      const minSide = Math.min(bitmap.width, bitmap.height)
      bitmap.close()
      if (minSide > 0 && minSide < 256) {
        const preCheck: IdentifyResult = {
          outcome: 'uncertain',
          confidence: 0,
          modelVersion: 'pulih:pre-check',
          reportable: false,
          retakeAdvice: {
            reason: 'image_too_small',
            message: 'The photo resolution is too low for a reliable identification. Move closer and try again.',
          },
        }
        return preCheck
      }
    } catch {
      // If we can't even decode the image, let the ONNX pipeline throw so the
      // capture screen surfaces its own error path.
    }
    const result = await this.model.predict(image, onProgress)
    // Two-stage identification: the on-device Student33 model runs first and
    // owns the "Invasive" verdict for anything in the 32-species catalogue.
    // When it comes back uncertain, we cross-check the same photo with
    // PlantNet via the backend proxy so the UI can still show a useful
    // "Native Species" or "Not Sure" answer instead of a bare "uncertain".
    if (result.outcome !== 'uncertain') return result
    // Extreme low certainty: the local model already flagged the photo as
    // unrecoverable. Spending a PlantNet call here would burn free-tier quota
    // on a frame that won't produce a useful cross-check; hand the user a
    // retake CTA in the UI instead.
    if (result.retakeAdvice) return result
    const verification = await verifyWithPlantNet(image)
    return { ...result, verification }
  }
}

function waitForMockInference(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

let adapter: ModelAdapter | null = null

export function getAdapter(): ModelAdapter {
  if (!adapter) {
    const fakeModelSetting = import.meta.env.VITE_ENABLE_FAKE_MODEL
    // The fake model only ever runs in dev. VITE_ENABLE_FAKE_MODEL is the
    // explicit switch, but if it's left unset I still fall back to the fake
    // one whenever the rest of the app is already running on mocked API data
    // (VITE_ENABLE_MOCKS) - that way "mock mode" doesn't force downloading the
    // real ~30 MiB model just to poke around the UI.
    const fakeAllowed = import.meta.env.DEV && (
      fakeModelSetting === 'true'
      || (fakeModelSetting !== 'false' && import.meta.env.VITE_ENABLE_MOCKS === 'true')
    )
    const realConfigured = import.meta.env.VITE_ENABLE_REAL_MODEL !== 'false'
    adapter = fakeAllowed
      ? new DevelopmentModelAdapter()
      : realConfigured
        ? new PulihAdapter()
        : new UnavailableAdapter()
  }
  return adapter
}
