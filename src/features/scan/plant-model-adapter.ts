import type { BBox, QualityResult, IdentifyResult } from '@/types'
import { hashBitmap } from './image-processing'
import { PulihModel } from './pulih-model'

interface ModelAdapter {
  detect(image: ImageBitmap): Promise<{ box: BBox | null }>
  quality(image: ImageBitmap): Promise<QualityResult>
  identify(image: Blob, onProgress?: (loaded: number, total: number) => void): Promise<IdentifyResult>
}

const DEVELOPMENT_MODEL_VERSION = 'development-model-v1'

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
      return { ok: false, reason: 'Image resolution too low — move closer to the plant and retake.' }
    }
    const imageHash = hashBitmap(image)
    if (imageHash % 17 === 0) {
      return { ok: false, reason: 'Subject is too blurry — hold steady and ensure good lighting.' }
    }
    return { ok: true }
  }

  async identify(image: Blob): Promise<IdentifyResult> {
    await waitForMockInference(300)
    const bitmap = await createImageBitmap(image)
    const imageHash = hashBitmap(bitmap)
    bitmap.close()
    const bucket = imageHash % 10

    if (bucket < 6) {
      return {
        outcome: 'target', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha',
        scientificName: 'Mikania micrantha', isInvasive: true, confidence: 0.87,
        modelVersion: DEVELOPMENT_MODEL_VERSION, reportable: true,
      }
    }
    if (bucket < 8) {
      return { outcome: 'other_plant', confidence: 0.73, modelVersion: DEVELOPMENT_MODEL_VERSION, reportable: false }
    }
    return { outcome: 'uncertain', confidence: 0.42, modelVersion: DEVELOPMENT_MODEL_VERSION, reportable: false }
  }

}

/** Keeps scanning fail-closed when the real model is deliberately disabled. */
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
    // Model 1 is a frozen centre-crop classifier, not a detector. Returning the
    // exact crop used by preprocessing keeps framing guidance honest.
    const side = Math.round(Math.min(image.width, image.height) * 0.875)
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
    if (Math.min(image.width, image.height) < 384) {
      return { ok: false, reason: 'Photo resolution is too low — move closer and retake.' }
    }
    return { ok: true }
  }

  identify(image: Blob, onProgress?: (loaded: number, total: number) => void) {
    return this.model.predict(image, onProgress)
  }
}

function waitForMockInference(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

let adapter: ModelAdapter | null = null

export function getAdapter(): ModelAdapter {
  if (!adapter) {
    const fakeModelSetting = import.meta.env.VITE_ENABLE_FAKE_MODEL
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
