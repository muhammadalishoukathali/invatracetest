import type { BBox, QualityResult, IdentifyResult } from '@/types'
import { hashBitmap } from './image-utils'

export interface ModelAdapter {
  detect(img: ImageBitmap): Promise<{ box: BBox | null }>
  quality(img: ImageBitmap): Promise<QualityResult>
  identify(img: ImageBitmap): Promise<IdentifyResult>
  embed(img: ImageBitmap): Promise<Float32Array>
}

const STUB_VERSION = 'stub-v0.1.0'

export class StubAdapter implements ModelAdapter {
  async detect(img: ImageBitmap): Promise<{ box: BBox | null }> {
    await tick(80)
    const pad = 0.1
    return {
      box: {
        x: Math.round(img.width * pad),
        y: Math.round(img.height * pad),
        w: Math.round(img.width * (1 - 2 * pad)),
        h: Math.round(img.height * (1 - 2 * pad)),
      },
    }
  }

  async quality(img: ImageBitmap): Promise<QualityResult> {
    await tick(120)
    if (img.width < 100 || img.height < 100) {
      return { ok: false, reason: 'Image resolution too low — move closer to the plant and retake.' }
    }
    const h = hashBitmap(img)
    if (h % 17 === 0) {
      return { ok: false, reason: 'Subject is too blurry — hold steady and ensure good lighting.' }
    }
    return { ok: true }
  }

  async identify(img: ImageBitmap): Promise<IdentifyResult> {
    await tick(300)
    const h = hashBitmap(img)
    const bucket = h % 10

    if (bucket < 6) {
      return { outcome: 'target', speciesId: 'mikania-micrantha', confidence: 0.87, modelVersion: STUB_VERSION }
    }
    if (bucket < 8) {
      return { outcome: 'other_plant', confidence: 0.73, modelVersion: STUB_VERSION }
    }
    return { outcome: 'uncertain', confidence: 0.42, modelVersion: STUB_VERSION }
  }

  async embed(_img: ImageBitmap): Promise<Float32Array> {
    await tick(60)
    const vec = new Float32Array(128)
    for (let i = 0; i < 128; i++) vec[i] = Math.sin(i * 0.1)
    return vec
  }
}

function tick(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

let adapter: ModelAdapter | null = null

export function getAdapter(): ModelAdapter {
  if (!adapter) adapter = new StubAdapter()
  return adapter
}
