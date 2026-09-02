import { create } from 'zustand'
import type { GeoPoint, QualityResult, IdentifyResult, SpeciesDetail } from '@/types'
import { saveScanHistoryRecord } from './scan-history-store'

let locationRequestGeneration = 0

type ScanStep = 'capture' | 'processing' | 'result'

/** Location captured when scanning. The report form reuses this value so the
 *  browser does not need to ask for location permission a second time. */
interface ScanLocation {
  point: GeoPoint
  accuracyM: number | null
  capturedAt: string  // ISO timestamp for when the coordinates were recorded.
}

interface ScanState {
  step: ScanStep
  imageUrl: string | null
  imageBitmap: ImageBitmap | null
  imageBlob: Blob | null
  captureSource: 'camera' | 'gallery' | null
  captureId: string | null
  observedAt: string | null
  quality: QualityResult | null
  result: IdentifyResult | null
  speciesDetail: SpeciesDetail | null
  location: ScanLocation | null
  locationStatus: 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'timeout'

  setImage: (
    url: string,
    bitmap: ImageBitmap,
    blob: Blob,
    source: 'camera' | 'gallery',
    captureId: string,
    observedAt: string,
  ) => void
  setQuality: (q: QualityResult) => void
  startProcessing: () => void
  cancelProcessing: () => void
  setResult: (r: IdentifyResult, detail: SpeciesDetail | null) => void
  setLocation: (loc: ScanLocation) => void
  setLocationStatus: (s: ScanState['locationStatus']) => void
  reset: () => void
}

function saveCurrentScan(
  scan: ScanState,
  result: IdentifyResult,
  detail: SpeciesDetail | null,
  location: ScanLocation | null,
): void {
  if (!scan.captureId || !scan.observedAt || !scan.captureSource) return
  saveScanHistoryRecord({
    captureId: scan.captureId,
    observedAt: scan.observedAt,
    captureSource: scan.captureSource,
    outcome: result.outcome,
    speciesId: result.speciesId ?? null,
    speciesName: result.speciesName ?? detail?.name ?? null,
    scientificName: result.scientificName ?? detail?.latinName ?? null,
    confidence: result.confidence,
    modelVersion: result.modelVersion,
    reportable: result.reportable,
    location: location?.point ?? null,
    locationAccuracyM: location?.accuracyM ?? null,
  })
}

export const useScan = create<ScanState>((set, get) => ({
  step: 'capture',
  imageUrl: null,
  imageBitmap: null,
  imageBlob: null,
  captureSource: null,
  captureId: null,
  observedAt: null,
  quality: null,
  result: null,
  speciesDetail: null,
  location: null,
  locationStatus: 'idle',

  setImage: (url, bitmap, blob, captureSource, captureId, observedAt) => {
    const previous = get()
    if (previous.imageUrl) URL.revokeObjectURL(previous.imageUrl)
    previous.imageBitmap?.close()
    set({ imageUrl: url, imageBitmap: bitmap, imageBlob: blob,
          captureSource, captureId, observedAt,
          quality: null, result: null, speciesDetail: null })
  },

  setQuality: (q) => set({ quality: q }),

  startProcessing: () => set({ step: 'processing' }),

  cancelProcessing: () => set({ step: 'capture' }),

  setResult: (r, detail) => {
    const scan = get()
    scan.imageBitmap?.close()
    saveCurrentScan(scan, r, detail, scan.location)
    set({ step: 'result', imageBitmap: null, result: r, speciesDetail: detail })
  },

  setLocation: (loc) => {
    const scan = get()
    // A warm model can finish before the GPS request. Update the already-saved
    // history row when that late fix arrives so View on map is still available.
    if (scan.result) saveCurrentScan(scan, scan.result, scan.speciesDetail, loc)
    set({ location: loc, locationStatus: 'ok' })
  },
  setLocationStatus: (s) => set({ locationStatus: s }),

  reset: () => {
    locationRequestGeneration += 1
    const previous = get()
    if (previous.imageUrl) URL.revokeObjectURL(previous.imageUrl)
    previous.imageBitmap?.close()
    set({
      step: 'capture', imageUrl: null, imageBitmap: null, imageBlob: null,
      captureSource: null, captureId: null, observedAt: null,
      quality: null, result: null, speciesDetail: null,
      location: null, locationStatus: 'idle',
    })
  },
}))

/** Start a location request without blocking the scan screen. The result or
 *  failure state is saved in the scan store for the report form to read later. */
export function captureScanLocation() {
  const requestGeneration = ++locationRequestGeneration
  useScan.setState({ location: null, locationStatus: 'locating' })
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    if (requestGeneration === locationRequestGeneration) {
      useScan.getState().setLocationStatus('unavailable')
    }
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (requestGeneration !== locationRequestGeneration) return
      useScan.getState().setLocation({
        point: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        accuracyM: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
        capturedAt: new Date().toISOString(),
      })
    },
    (err) => {
      if (requestGeneration !== locationRequestGeneration) return
      useScan.getState().setLocationStatus(
        err.code === err.PERMISSION_DENIED ? 'denied'
          : err.code === err.TIMEOUT ? 'timeout' : 'unavailable',
      )
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  )
}
