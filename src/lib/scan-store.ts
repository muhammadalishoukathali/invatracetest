import { create } from 'zustand'
import type { GeoPoint, QualityResult, IdentifyResult, SpeciesDetail } from '@/types'

type ScanStep = 'capture' | 'processing' | 'result'

/** GPS fix captured at scan time — pre-fills the Report location step so the
 *  user does not have to grant geolocation twice. */
export interface ScanLocation {
  point: GeoPoint
  accuracyM: number | null
  capturedAt: string  // ISO
}

interface ScanState {
  step: ScanStep
  imageUrl: string | null
  imageBitmap: ImageBitmap | null
  imageBlob: Blob | null
  quality: QualityResult | null
  result: IdentifyResult | null
  speciesDetail: SpeciesDetail | null
  location: ScanLocation | null
  locationStatus: 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'timeout'

  setImage: (url: string, bitmap: ImageBitmap, blob: Blob) => void
  setQuality: (q: QualityResult) => void
  startProcessing: () => void
  setResult: (r: IdentifyResult, detail: SpeciesDetail | null) => void
  setLocation: (loc: ScanLocation) => void
  setLocationStatus: (s: ScanState['locationStatus']) => void
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
  location: null,
  locationStatus: 'idle',

  setImage: (url, bitmap, blob) => {
    const prev = get().imageUrl
    if (prev) URL.revokeObjectURL(prev)
    set({ imageUrl: url, imageBitmap: bitmap, imageBlob: blob,
          quality: null, result: null, speciesDetail: null })
  },

  setQuality: (q) => set({ quality: q }),

  startProcessing: () => set({ step: 'processing' }),

  setResult: (r, detail) => set({ step: 'result', result: r, speciesDetail: detail }),

  setLocation: (loc) => set({ location: loc, locationStatus: 'ok' }),
  setLocationStatus: (s) => set({ locationStatus: s }),

  reset: () => {
    const prev = get().imageUrl
    if (prev) URL.revokeObjectURL(prev)
    set({
      step: 'capture', imageUrl: null, imageBitmap: null, imageBlob: null,
      quality: null, result: null, speciesDetail: null,
      location: null, locationStatus: 'idle',
    })
  },
}))

/** Kick off a background GPS fix. Non-blocking — user can keep scanning
 *  while the browser prompts for permission. Result lands in the store. */
export function captureScanLocation() {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    useScan.getState().setLocationStatus('unavailable')
    return
  }
  useScan.getState().setLocationStatus('locating')
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      useScan.getState().setLocation({
        point: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        accuracyM: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
        capturedAt: new Date().toISOString(),
      })
    },
    (err) => {
      useScan.getState().setLocationStatus(
        err.code === err.PERMISSION_DENIED ? 'denied'
          : err.code === err.TIMEOUT ? 'timeout' : 'unavailable',
      )
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  )
}
