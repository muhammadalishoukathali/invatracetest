/**
 * Offline report queue backed by IndexedDB (Arch §9 — reports may be captured
 * offline and must survive a page reload). Flow:
 *   1. Client calls submit(): if online → try presign+upload+create.
 *      If any step fails → enqueue.
 *   2. Reconnection restores the API session, then calls flushQueue().
 * The IDB store keeps the JPEG blob until the create succeeds.
 */
import type { PresignedUpload, QueuedReport, Report, ReportSubmission } from '@/types'
import { api } from './api'

const DB_NAME = 'invatrace'
const DB_VERSION = 1
const STORE = 'report-queue'

/* ── IndexedDB ──────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

async function idbAll(): Promise<QueuedReport[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as QueuedReport[])
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(item: QueuedReport): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/* ── Submission pipeline ────────────────────────────────── */

/** Ask the API for a signed URL, then PUT the blob to it. Returns the key. */
async function uploadImage(blob: Blob): Promise<string> {
  const presigned = await api<PresignedUpload>('/api/v1/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: blob.type, sizeBytes: blob.size }),
  })
  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  if (!putRes.ok) throw new Error(`Upload failed: HTTP ${putRes.status}`)
  return presigned.photoKey
}

async function createReport(submission: ReportSubmission): Promise<Report> {
  return api<Report>('/api/v1/reports', {
    method: 'POST',
    body: JSON.stringify(submission),
  })
}

export interface SubmitOutcome {
  status: 'submitted' | 'queued'
  report?: Report
  queuedId?: string
  error?: string
}

/**
 * Submit one report end-to-end. On any network / server failure the item is
 * enqueued to IndexedDB with `photoKey === ''` — the queue drainer will retry
 * presign+upload+create from scratch when connectivity returns.
 */
export async function submitReport(
  submission: Omit<ReportSubmission, 'photoKey'>,
  imageBlob: Blob,
): Promise<SubmitOutcome> {
  try {
    const photoKey = await uploadImage(imageBlob)
    const report = await createReport({ ...submission, photoKey })
    return { status: 'submitted', report }
  } catch (err) {
    const queuedId = crypto.randomUUID()
    await idbPut({
      id: queuedId,
      createdAt: new Date().toISOString(),
      attempts: 1,
      lastError: err instanceof Error ? err.message : String(err),
      submission: { ...submission, photoKey: '' },
      imageBlob,
    })
    notifyQueueChanged()
    return { status: 'queued', queuedId, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Try every queued item once. Successful items are removed from IDB. */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { sent: 0, failed: 0 }
  const items = await idbAll()
  let sent = 0, failed = 0
  for (const item of items) {
    try {
      const photoKey = await uploadImage(item.imageBlob)
      await createReport({ ...item.submission, photoKey })
      await idbDelete(item.id)
      sent++
    } catch (err) {
      item.attempts++
      item.lastError = err instanceof Error ? err.message : String(err)
      await idbPut(item)
      failed++
    }
  }
  if (sent > 0) notifyQueueChanged()
  return { sent, failed }
}

export const listQueue = () => idbAll()

/* ── Change notification ────────────────────────────────── */

const listeners = new Set<() => void>()
export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function notifyQueueChanged() { listeners.forEach((fn) => fn()) }
