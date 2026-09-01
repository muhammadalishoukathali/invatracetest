import type { IdentifyResult } from '@/types'

export interface ScanHistoryRecord {
  captureId: string
  observedAt: string
  captureSource: 'camera' | 'gallery'
  outcome: IdentifyResult['outcome']
  speciesId: string | null
  speciesName: string | null
  scientificName: string | null
  confidence: number
  modelVersion: string
  reportable: boolean
  recordedAt: string
}

interface StoredScanHistory {
  version: 1
  records: ScanHistoryRecord[]
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const STORAGE_KEY = 'invatrace-scan-history-v1'
const MAX_SAVED_SCANS = 50

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is ScanHistoryRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ScanHistoryRecord>
  return typeof record.captureId === 'string'
    && typeof record.observedAt === 'string'
    && (record.captureSource === 'camera' || record.captureSource === 'gallery')
    && (record.outcome === 'target' || record.outcome === 'other_plant' || record.outcome === 'uncertain')
    && (record.speciesId === null || typeof record.speciesId === 'string')
    && (record.speciesName === null || typeof record.speciesName === 'string')
    && (record.scientificName === null || typeof record.scientificName === 'string')
    && typeof record.confidence === 'number'
    && Number.isFinite(record.confidence)
    && typeof record.modelVersion === 'string'
    && typeof record.reportable === 'boolean'
    && typeof record.recordedAt === 'string'
}

export function listScanHistory(storage: StorageLike | null = browserStorage()): ScanHistoryRecord[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '') as Partial<StoredScanHistory>
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) return []
    return parsed.records.filter(isRecord)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
      .slice(0, MAX_SAVED_SCANS)
  } catch {
    return []
  }
}

export function saveScanHistoryRecord(
  input: Omit<ScanHistoryRecord, 'recordedAt'> & { recordedAt?: string },
  storage: StorageLike | null = browserStorage(),
): ScanHistoryRecord | null {
  if (!storage) return null
  const record: ScanHistoryRecord = {
    ...input,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  }
  const records = [
    record,
    ...listScanHistory(storage).filter((item) => item.captureId !== record.captureId),
  ].slice(0, MAX_SAVED_SCANS)
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records } satisfies StoredScanHistory))
    return record
  } catch {
    return null
  }
}
