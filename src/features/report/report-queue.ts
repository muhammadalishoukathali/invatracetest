/**
 * Stores reports in IndexedDB when submission cannot finish. A submission first
 * requests an upload URL, uploads the photo, and creates the report. If any step
 * fails, the report and photo are saved locally. `flushQueue` retries the same
 * steps after the connection and API session are available again.
 */
import type { PresignedUpload, QueuedReport, Report, ReportSubmission } from '@/types'
import { api, ApiError } from '@/services/api-client'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { updateScanHistorySubmission } from '@/features/scan/scan-history-store'

const REPORT_QUEUE_DB_NAME = 'invatrace'
const REPORT_QUEUE_DB_VERSION = 1
const REPORT_QUEUE_STORE_NAME = 'report-queue'

function openReportQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPORT_QUEUE_DB_NAME, REPORT_QUEUE_DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(REPORT_QUEUE_STORE_NAME)) {
        database.createObjectStore(REPORT_QUEUE_STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

async function readQueuedReports(): Promise<QueuedReport[]> {
  const database = await openReportQueueDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_QUEUE_STORE_NAME, 'readonly')
    const request = transaction.objectStore(REPORT_QUEUE_STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result as QueuedReport[])
    request.onerror = () => reject(request.error)
  })
}

async function saveQueuedReport(item: QueuedReport): Promise<void> {
  const database = await openReportQueueDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_QUEUE_STORE_NAME, 'readwrite')
    transaction.objectStore(REPORT_QUEUE_STORE_NAME).put(item)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

async function deleteQueuedReport(id: string): Promise<void> {
  const database = await openReportQueueDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_QUEUE_STORE_NAME, 'readwrite')
    transaction.objectStore(REPORT_QUEUE_STORE_NAME).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/** Ask the API for a temporary upload URL, upload the image, and return the
 *  photo key that must be included in the report request. */
async function uploadImage(blob: Blob, idempotencyKey: string): Promise<string> {
  const presigned = await api<PresignedUpload>('/api/v1/uploads/presign', {
    method: 'POST',
    headers: { 'Idempotency-Key': `${idempotencyKey}:upload` },
    body: JSON.stringify({ contentType: blob.type, sizeBytes: blob.size }),
  })
  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  if (!putRes.ok) throw new UploadError(putRes.status)
  return presigned.photoKey
}

class UploadError extends Error {
  constructor(public status: number) {
    super(`Upload failed: HTTP ${status}`)
    this.name = 'UploadError'
  }
}

const REUSABLE_UPLOAD_ERRORS = new Set([
  'upload_expired',
  'upload_not_issued',
  'upload_incomplete',
  'upload_mismatch',
  'upload_changed',
])

/** Decides whether a failed submission gets queued for retry or just fails
 *  outright. Anything that looks transient (offline, network blip, upload
 *  URL expiry, server overload/rate-limit) is retryable; a rejection from
 *  the trust pipeline itself (4xx other than the upload-token codes) is not
 *  — retrying wouldn't change the outcome and would just spam the API. */
function shouldRetry(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (error instanceof UploadError || error instanceof TypeError) return true
  if (!(error instanceof ApiError)) return false
  return error.status >= 500
    || [408, 425, 429].includes(error.status)
    || (error.code !== null && REUSABLE_UPLOAD_ERRORS.has(error.code))
}

async function createReport(
  submission: ReportSubmission,
  idempotencyKey: string,
  queuedRetry: boolean,
): Promise<Report> {
  return api<Report>('/api/v1/reports', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      ...(queuedRetry ? { 'X-InvaTrace-Queued': 'true' } : {}),
    },
    body: JSON.stringify(submission),
  })
}

interface SubmitOutcome {
  status: 'submitted' | 'queued'
  report?: Report
  queuedId?: string
  error?: string
}

/**
 * Submit one report from start to finish. A network or server failure stores
 * the report locally with an empty photo key. The retry starts with a new upload
 * URL because temporary upload URLs can expire.
 */
export async function submitReport(
  submission: Omit<ReportSubmission, 'photoKey'>,
  imageBlob: Blob,
): Promise<SubmitOutcome> {
  const ownerProfileId = usePrivateAccess.getState().profile?.id
  if (!ownerProfileId) throw new Error('Private access must be ready before submitting a report.')
  const queuedId = crypto.randomUUID()
  // Hash the raw capture once so the server can
  // reject exact duplicates from this identity. Hash lives on the submission
  // only; the raw bytes never leave the device beyond the presigned upload.
  const imageSha256 = await sha256Hex(imageBlob)
  let photoKey = ''
  try {
    photoKey = await uploadImage(imageBlob, queuedId)
    const report = await createReport({ ...submission, photoKey, imageSha256 }, queuedId, false)
    updateScanHistorySubmission(submission.captureId, { status: 'submitted', reportId: report.id })
    return { status: 'submitted', report }
  } catch (error) {
    if (!shouldRetry(error)) throw error
    await saveQueuedReport({
      id: queuedId,
      ownerProfileId,
      createdAt: new Date().toISOString(),
      attempts: 1,
      retryable: true,
      lastError: error instanceof Error ? error.message : String(error),
      submission: { ...submission, photoKey, imageSha256 },
      imageBlob,
    })
    updateScanHistorySubmission(submission.captureId, { status: 'queued' })
    notifyQueueChanged()
    return { status: 'queued', queuedId, error: error instanceof Error ? error.message : String(error) }
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sendQueuedReport(item: QueuedReport): Promise<Report> {
  if (!item.submission.photoKey) {
    item.submission.photoKey = await uploadImage(item.imageBlob, item.id)
    await saveQueuedReport(item)
  }
  try {
    return await createReport(item.submission, item.id, true)
  } catch (error) {
    // A stale/expired upload URL isn't fixable by retrying createReport as-is —
    // we have to redo the upload with a fresh presigned URL first. The retry
    // idempotency key is suffixed with the attempt count so it doesn't collide
    // with the original (now-dead) upload key on the server.
    if (!(error instanceof ApiError) || !error.code || !REUSABLE_UPLOAD_ERRORS.has(error.code)) {
      throw error
    }
    item.submission.photoKey = ''
    await saveQueuedReport(item)
    item.submission.photoKey = await uploadImage(
      item.imageBlob,
      `${item.id}:retry:${item.attempts}`,
    )
    await saveQueuedReport(item)
    return createReport(item.submission, item.id, true)
  }
}

/** Try each retryable report owned by the current private profile once. */
export async function flushQueue(): Promise<{ sent: number; failed: number; skipped: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { sent: 0, failed: 0, skipped: 0 }
  }
  const ownerProfileId = usePrivateAccess.getState().profile?.id
  if (!ownerProfileId) return { sent: 0, failed: 0, skipped: 0 }
  const items = await readQueuedReports()
  let sent = 0, failed = 0, skipped = 0
  for (const item of items) {
    // The queue is one shared IndexedDB store, so it can hold reports from a
    // previous private profile on this device (e.g. after a restore) or ones
    // the trust pipeline already told us won't succeed on retry — skip both
    // rather than resending them under the wrong identity or forever.
    if (item.ownerProfileId !== ownerProfileId || item.retryable === false) {
      skipped++
      continue
    }
    try {
      const report = await sendQueuedReport(item)
      await deleteQueuedReport(item.id)
      updateScanHistorySubmission(item.submission.captureId, { status: 'submitted', reportId: report.id })
      sent++
    } catch (error) {
      item.attempts++
      item.retryable = shouldRetry(error)
      item.lastError = error instanceof Error ? error.message : String(error)
      await saveQueuedReport(item)
      failed++
    }
  }
  if (sent > 0 || failed > 0) notifyQueueChanged()
  return { sent, failed, skipped }
}

export async function listQueuedReports(
  ownerProfileId: string | null | undefined = usePrivateAccess.getState().profile?.id,
): Promise<QueuedReport[]> {
  if (!ownerProfileId) return []
  return (await readQueuedReports()).filter((item) => item.ownerProfileId === ownerProfileId)
}
export async function discardQueuedReport(id: string): Promise<void> {
  const item = (await readQueuedReports()).find((candidate) => candidate.id === id)
  await deleteQueuedReport(id)
  if (item) updateScanHistorySubmission(item.submission.captureId, undefined)
  notifyQueueChanged()
}

const listeners = new Set<() => void>()
export function onReportQueueChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notifyQueueChanged() { listeners.forEach((fn) => fn()) }
