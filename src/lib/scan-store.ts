import { create } from 'zustand'
import type { QualityResult, IdentifyResult, SpeciesDetail } from '@/types'

type ScanStep = 'capture' | 'processing' | 'result'

interface ScanState {
  step: ScanStep
  imageUrl: string | null
  imageBitmap: ImageBitmap | null
  imageBlob: Blob | null
  quality: QualityResult | null
  result: IdentifyResult | null
  speciesDetail: SpeciesDetail | null

  setImage: (url: string, bitmap: ImageBitmap, blob: Blob) => void
  setQuality: (q: QualityResult) => void
  startProcessing: () => void
  setResult: (r: IdentifyResult, detail: SpeciesDetail | null) => void
  reset: () => void
}

export const useScan = create<ScanState>((set, get) => ({
  step: 'capture',
  imageUrl: null,
  imageBitmap: null,
  imageBlob: null,
  quality: null,
  result: null,
  speciesDetail: null,

  setImage: (url, bitmap, blob) => {
    const prev = get().imageUrl
    if (prev) URL.revokeObjectURL(prev)
    set({ imageUrl: url, imageBitmap: bitmap, imageBlob: blob,
          quality: null, result: null, speciesDetail: null })
  },

  setQuality: (q) => set({ quality: q }),

  startProcessing: () => set({ step: 'processing' }),

  setResult: (r, detail) => set({ step: 'result', result: r, speciesDetail: detail }),

  reset: () => {
    const prev = get().imageUrl
    if (prev) URL.revokeObjectURL(prev)
    set({
      step: 'capture', imageUrl: null, imageBitmap: null, imageBlob: null,
      quality: null, result: null, speciesDetail: null,
    })
  },
}))
