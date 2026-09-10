/** Iteration 2 Phase 4 - Epic 4 community sighting-removal reporting.
 *
 *  Wraps ``POST /api/v1/reports/{reportId}/removal``. Server-authoritative
 *  vicinity + accuracy checks; the client never re-derives the thresholds -
 *  copy shown to the user is driven from ``useLimits()`` so a redeploy that
 *  changes the ceiling doesn't strand hardcoded numbers in the UI.
 *
 *  Idempotency-Key is UUIDv4 per submission (mint fresh for a new attempt so
 *  a change of coordinates never replays a prior stored response).
 */
import { api, ApiError } from './api-client'

export type RemovalReportSubmission = {
  latitude: number
  longitude: number
  accuracyM: number
}

export type RemovalReportResult = {
  sightingId: string
  reportId: string
  fromStatus: string
  toStatus: 'removal_reported'
  calculatedDistanceM: number
  proximityMaxM: number
  accuracyCeilingM: number
  eventTimeUtc: string
}

/** Error codes the server returns in the ``code`` field on a 422/429.
 *  Client copy switches on these instead of parsing the free-form ``detail``
 *  so a translation of the message doesn't drift out of sync with the code. */
export type RemovalErrorCode =
  | 'LOCATION_UNAVAILABLE'
  | 'LOCATION_INACCURATE'
  | 'LOCATION_OUT_OF_RANGE'
  | 'LOCATION_PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'SIGHTING_NOT_ELIGIBLE'
  | 'SIGHTING_NOT_FOUND'

const REMOVAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'LOCATION_UNAVAILABLE',
  'LOCATION_INACCURATE',
  'LOCATION_OUT_OF_RANGE',
  'LOCATION_PERMISSION_DENIED',
  'RATE_LIMITED',
  'SIGHTING_NOT_ELIGIBLE',
  'SIGHTING_NOT_FOUND',
])

export function isRemovalError(value: unknown): value is ApiError & { code: RemovalErrorCode } {
  return value instanceof ApiError
    && typeof value.code === 'string'
    && REMOVAL_ERROR_CODES.has(value.code)
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback for jsdom without WebCrypto - only ever hits in tests. Shape
  // matches ``IDEMPOTENCY_PATTERN`` in the backend so a fallback UUID still
  // clears the 400 gate.
  const random = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')
  return `${random()}${random()}-${random()}-${random()}-${random()}-${random()}${random()}${random()}`
}

export async function submitRemovalReport(
  reportId: string,
  body: RemovalReportSubmission,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<RemovalReportResult> {
  return api<RemovalReportResult>(`/api/v1/reports/${encodeURIComponent(reportId)}/removal`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  })
}
