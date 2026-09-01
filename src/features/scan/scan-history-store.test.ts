import { describe, expect, it } from 'vitest'
import { listScanHistory, saveScanHistoryRecord } from './scan-history-store'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function record(captureId: string, observedAt: string) {
  return {
    captureId,
    observedAt,
    captureSource: 'camera' as const,
    outcome: 'target' as const,
    speciesId: 'mikania-micrantha',
    speciesName: 'Mile-a-minute weed',
    scientificName: 'Mikania micrantha',
    confidence: 0.93,
    modelVersion: 'test',
    reportable: true,
    recordedAt: observedAt,
  }
}

describe('scan history storage', () => {
  it('keeps completed scans across page visits with newest first', () => {
    const storage = new MemoryStorage()
    saveScanHistoryRecord(record('older', '2026-09-01T09:00:00.000Z'), storage)
    saveScanHistoryRecord(record('newer', '2026-09-01T10:00:00.000Z'), storage)

    expect(listScanHistory(storage).map((item) => item.captureId)).toEqual(['newer', 'older'])
  })

  it('updates an existing capture instead of duplicating it', () => {
    const storage = new MemoryStorage()
    saveScanHistoryRecord(record('same', '2026-09-01T09:00:00.000Z'), storage)
    saveScanHistoryRecord({ ...record('same', '2026-09-01T10:00:00.000Z'), confidence: 0.98 }, storage)

    expect(listScanHistory(storage)).toHaveLength(1)
    expect(listScanHistory(storage)[0]?.confidence).toBe(0.98)
  })

  it('ignores damaged browser data', () => {
    const storage = new MemoryStorage()
    storage.setItem('invatrace-scan-history-v1', '{not json')

    expect(listScanHistory(storage)).toEqual([])
  })
})
