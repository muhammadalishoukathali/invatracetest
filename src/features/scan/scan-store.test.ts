import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveScanHistoryRecord } from './scan-history-store'
import { captureScanLocation, useScan } from './scan-store'

vi.mock('./scan-history-store', () => ({ saveScanHistoryRecord: vi.fn() }))

function bitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap
}

afterEach(() => {
  useScan.getState().reset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scan image lifecycle', () => {
  it('releases the previous bitmap and object URL when a new image replaces it', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const first = bitmap()
    const second = bitmap()

    useScan.getState().setImage('blob:first', first, new Blob(), 'camera', 'one', 'now')
    useScan.getState().setImage('blob:second', second, new Blob(), 'camera', 'two', 'later')

    expect(first.close).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:first')
    expect(second.close).not.toHaveBeenCalled()
  })

  it('releases the decoded bitmap after inference while keeping the report photo', () => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const decoded = bitmap()
    useScan.getState().setImage('blob:photo', decoded, new Blob(), 'camera', 'one', 'now')

    useScan.getState().setResult({
      outcome: 'uncertain',
      confidence: 0.4,
      modelVersion: 'test',
      reportable: false,
    }, null)

    expect(decoded.close).toHaveBeenCalledOnce()
    expect(useScan.getState().imageBitmap).toBeNull()
    expect(useScan.getState().imageBlob).toBeInstanceOf(Blob)
    expect(useScan.getState().imageUrl).toBe('blob:photo')
  })

  it('records a completed identification before the temporary scan state is cleared', () => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    useScan.getState().setImage(
      'blob:photo', bitmap(), new Blob(), 'gallery', 'capture-1', '2026-09-01T10:00:00.000Z',
    )

    useScan.getState().setResult({
      outcome: 'target',
      speciesId: 'mikania-micrantha',
      speciesName: 'Mile-a-minute weed',
      confidence: 0.93,
      modelVersion: 'test',
      reportable: true,
    }, null)

    expect(saveScanHistoryRecord).toHaveBeenCalledWith(expect.objectContaining({
      captureId: 'capture-1',
      observedAt: '2026-09-01T10:00:00.000Z',
      captureSource: 'gallery',
      speciesId: 'mikania-micrantha',
    }))
  })

  it('adds a location that arrives after identification', () => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    useScan.getState().setImage(
      'blob:photo', bitmap(), new Blob(), 'camera', 'capture-late', '2026-09-01T10:00:00.000Z',
    )
    useScan.getState().setResult({
      outcome: 'target',
      speciesId: 'mikania-micrantha',
      confidence: 0.93,
      modelVersion: 'test',
      reportable: true,
    }, null)

    useScan.getState().setLocation({
      point: { lat: 3.1497, lng: 101.6412 },
      accuracyM: 15,
      capturedAt: '2026-09-01T10:00:01.000Z',
    })

    expect(saveScanHistoryRecord).toHaveBeenLastCalledWith(expect.objectContaining({
      captureId: 'capture-late',
      location: { lat: 3.1497, lng: 101.6412 },
      locationAccuracyM: 15,
    }))
  })

  it('ignores a location callback from an earlier capture attempt', () => {
    const callbacks: PositionCallback[] = []
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((success: PositionCallback) => callbacks.push(success)),
      },
    })

    captureScanLocation()
    captureScanLocation()

    callbacks[0]({ coords: { latitude: 1, longitude: 101, accuracy: 5 } } as GeolocationPosition)
    expect(useScan.getState().location).toBeNull()

    callbacks[1]({ coords: { latitude: 3.1, longitude: 101.6, accuracy: 12 } } as GeolocationPosition)
    expect(useScan.getState().location).toEqual(expect.objectContaining({
      point: { lat: 3.1, lng: 101.6 },
      accuracyM: 12,
    }))
  })

  it('ignores success and failure callbacks after the scan is reset', () => {
    let successCallback!: PositionCallback
    let failureCallback!: PositionErrorCallback
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
          successCallback = success
          failureCallback = failure
        }),
      },
    })

    captureScanLocation()
    expect(useScan.getState().locationStatus).toBe('locating')
    useScan.getState().reset()

    successCallback({ coords: { latitude: 3.1, longitude: 101.6, accuracy: 12 } } as GeolocationPosition)
    failureCallback({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError)

    expect(useScan.getState().location).toBeNull()
    expect(useScan.getState().locationStatus).toBe('idle')
  })
})
