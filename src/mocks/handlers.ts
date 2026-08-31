import { http, HttpResponse, passthrough, type JsonBodyType } from 'msw'
import type {
  AppNotification, Report, ReportSubmission, Sighting,
  AccessOverview, PseudonymousProfile, SightingDetail,
} from '@/types'

const url = (p: string) => `*${p}`

const mockReports: Report[] = []
const mockReportIdempotency = new Map<string, { request: string; response: Report }>()
const mockUploadIdempotency = new Map<string, {
  request: string
  response: { uploadId: string; uploadUrl: string; photoKey: string; expiresAt: string }
}>()
const sessions = new Map<string, { profile: PseudonymousProfile; installationId: string; token: string }>()
const MOCK_SERVER_KEY = 'invatrace-mock-server-v2'
const MOCK_HASH_PEPPER = 'development-only-invatrace-mock-pepper'

// AC 2.3.3 — sliding-window submission counters. In-memory; sufficient for
// mock-backend enforcement. Real backend would use Redis or a token bucket.
const REPORT_RATE_PER_TOKEN = 10
const REPORT_RATE_PER_IP = 30
const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000
const reportSubmissionsByToken = new Map<string, number[]>()
const reportSubmissionsByIp = new Map<string, number[]>()

function pruneSlidingWindow(bucket: Map<string, number[]>, key: string, now: number): number[] {
  const cutoff = now - REPORT_RATE_WINDOW_MS
  const arr = (bucket.get(key) ?? []).filter((t) => t > cutoff)
  bucket.set(key, arr)
  return arr
}

function enforceReportRateLimit(profileId: string, clientIp: string): {
  blocked: boolean; detail?: string; retryAfterSeconds?: number
} {
  const now = Date.now()
  const perToken = pruneSlidingWindow(reportSubmissionsByToken, profileId, now)
  const perIp = pruneSlidingWindow(reportSubmissionsByIp, clientIp, now)
  const overToken = perToken.length >= REPORT_RATE_PER_TOKEN
  const overIp = perIp.length >= REPORT_RATE_PER_IP
  if (overToken || overIp) {
    const oldest = Math.min(...(overToken ? perToken : perIp))
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + REPORT_RATE_WINDOW_MS - now) / 1000))
    return {
      blocked: true,
      detail: overToken
        ? `Rate limit: ${REPORT_RATE_PER_TOKEN} reports per token per 10 minutes.`
        : `Rate limit: ${REPORT_RATE_PER_IP} reports per network per 10 minutes.`,
      retryAfterSeconds,
    }
  }
  perToken.push(now)
  perIp.push(now)
  return { blocked: false }
}

// AC 2.3.2 — great-circle distance in metres between two WGS84 points.
function haversineMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lng - a.lng)
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLon / 2)
  const c = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(c)))
}

interface MockRecoveryCode {
  hash: string
  createdAt: string
  usedAt: string | null
}

interface MockInstallation {
  id: string
  tokenHash: string
  createdAt: string
  lastUsedAt: string
  revokedAt: string | null
}

interface MockProfileRecord {
  profile: PseudonymousProfile
  setupAcknowledged: boolean
  recoveryCodes: MockRecoveryCode[]
  installations: MockInstallation[]
}

interface MockServerState { profiles: MockProfileRecord[] }

function loadMockServer(): MockServerState {
  if (typeof localStorage === 'undefined') return { profiles: [] }
  try {
    const parsed = JSON.parse(localStorage.getItem(MOCK_SERVER_KEY) ?? '{"profiles":[]}') as MockServerState
    return Array.isArray(parsed.profiles) ? parsed : { profiles: [] }
  } catch { return { profiles: [] } }
}

function saveMockServer(state: MockServerState): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(MOCK_SERVER_KEY, JSON.stringify(state))
}

async function secretHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${MOCK_HASH_PEPPER}:${secret}`))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomGroupedSecret(byteCount = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount))
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]
  return output.match(/.{1,4}/g)!.join('-')
}

async function freshRecoveryBatch() {
  const createdAt = new Date().toISOString()
  const raw = Array.from({ length: 10 }, () => randomGroupedSecret(16))
  const hashes = await Promise.all(raw.map(secretHash))
  return {
    createdAt,
    raw,
    records: hashes.map((hash) => ({ hash, createdAt, usedAt: null })),
  }
}

function identityJson<T extends JsonBodyType>(data: T, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...headers },
  })
}

function validDisplayName(value: unknown): value is string | null | undefined {
  const hasControlCharacter = typeof value === 'string' && Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  return value === undefined || value === null
    || (typeof value === 'string' && value.trim().length <= 80 && !hasControlCharacter)
}

function validInstallationToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

function issueSession(record: MockProfileRecord, installationId: string) {
  const accessToken = `mock-session-${crypto.randomUUID()}`
  sessions.set(accessToken, { profile: record.profile, installationId, token: accessToken })
  return accessToken
}

// AC 2.1.4 — strict "5 failed restores per profile+IP within a 15-minute
// window" enforcement. Sliding window over timestamps; per-profile counter
// and per-IP counter each cap at 5. Overflow returns 429 with Retry-After
// equal to seconds until the oldest failure in that window ages out.
const RESTORE_MAX_ATTEMPTS = 5
const RESTORE_WINDOW_MS = 15 * 60 * 1000
const restoreFailureTimestamps = new Map<string, number[]>()

function pruneRestoreBucket(key: string, now: number): number[] {
  const cutoff = now - RESTORE_WINDOW_MS
  const arr = (restoreFailureTimestamps.get(key) ?? []).filter((t) => t > cutoff)
  restoreFailureTimestamps.set(key, arr)
  return arr
}

function restoreBlocked(profileId: string, clientIp: string | null): number {
  const now = Date.now()
  const perProfile = pruneRestoreBucket(`p:${profileId}`, now)
  const perIp = clientIp ? pruneRestoreBucket(`i:${clientIp}`, now) : []
  const oldest = perProfile.length >= RESTORE_MAX_ATTEMPTS || perIp.length >= RESTORE_MAX_ATTEMPTS
    ? Math.min(
        ...(perProfile.length >= RESTORE_MAX_ATTEMPTS ? perProfile : perIp),
      )
    : 0
  return oldest ? Math.max(1, Math.ceil((oldest + RESTORE_WINDOW_MS - now) / 1000)) : 0
}

function recordRestoreFailure(profileId: string, clientIp: string | null) {
  const now = Date.now()
  pruneRestoreBucket(`p:${profileId}`, now).push(now)
  if (clientIp) pruneRestoreBucket(`i:${clientIp}`, now).push(now)
}

function clearRestoreFailures(profileId: string, clientIp: string | null) {
  restoreFailureTimestamps.delete(`p:${profileId}`)
  if (clientIp) restoreFailureTimestamps.delete(`i:${clientIp}`)
}

/**
 * Test controls that force one request to fail. Browser tests use these flags
 * to check the offline queue and expired-session recovery without changing the
 * computer's real network connection. Each flag resets after one failure.
 */
declare global {
  interface Window {
    __msw?: {
      failPresign?: boolean
      failReport?: boolean
      expireSession?: boolean
    }
  }
}
const shouldInject = (kind: 'failPresign' | 'failReport' | 'expireSession') => {
  const flags = typeof window !== 'undefined' ? window.__msw : undefined
  if (flags?.[kind]) { flags[kind] = false; return true }
  return false
}

export const handlers = [
  // Do not mock development files, map tiles, fonts, or sample images. These
  // requests must reach their original host so MapLibre and Vite keep working.
  http.all('http://localhost:5173/node_modules/*', () => passthrough()),
  http.all('http://192.168.0.114:5173/node_modules/*', () => passthrough()),
  http.all('https://tiles.openfreemap.org/*', () => passthrough()),
  http.all('https://*.basemaps.cartocdn.com/*', () => passthrough()),
  http.all('https://basemaps.cartocdn.com/*', () => passthrough()),
  http.all('https://fonts.openmaptiles.org/*', () => passthrough()),
  http.all('https://fonts.googleapis.com/*', () => passthrough()),
  http.all('https://fonts.gstatic.com/*', () => passthrough()),
  http.all('https://picsum.photos/*', () => passthrough()),

  http.get(url('/health'), () =>
    HttpResponse.json({ status: 'ok', database: 'ok' })),

  http.post(url('/api/v1/profiles/start'), async ({ request }) => {
    const body = (await request.json()) as { installationToken?: unknown; displayName?: unknown }
    if (!validInstallationToken(body.installationToken) || !validDisplayName(body.displayName)) {
      return identityJson({ code: 'invalid_request', detail: 'Private access could not be started.' }, 400)
    }
    const tokenHash = await secretHash(body.installationToken)
    const state = loadMockServer()
    if (state.profiles.some((record) => record.installations.some((item) => item.tokenHash === tokenHash))) {
      return identityJson({ code: 'installation_exists', detail: 'Private access could not be started.' }, 409)
    }
    const now = new Date().toISOString()
    const batch = await freshRecoveryBatch()
    const profile: PseudonymousProfile = {
      id: `IVT-${randomGroupedSecret(12)}`,
      displayName: typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : null,
      role: 'Detector',
      trustLevel: 'New',
    }
    const installation: MockInstallation = {
      id: `ins_${crypto.randomUUID()}`,
      tokenHash,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
    }
    const record: MockProfileRecord = {
      profile,
      setupAcknowledged: false,
      recoveryCodes: batch.records,
      installations: [installation],
    }
    state.profiles.push(record)
    saveMockServer(state)
    return identityJson({
      accessToken: issueSession(record, installation.id),
      profile,
      recoveryCodes: batch.raw,
      installationId: installation.id,
    }, 201)
  }),

  http.post(url('/api/v1/profiles/bootstrap'), async ({ request }) => {
    const body = (await request.json()) as { installationToken?: unknown }
    if (!validInstallationToken(body.installationToken)) {
      return identityJson({ code: 'invalid_request', detail: 'Invalid installation token' }, 400)
    }
    const tokenHash = await secretHash(body.installationToken)
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.installations.some((item) => item.tokenHash === tokenHash))
    const installation = record?.installations.find((item) => item.tokenHash === tokenHash)
    if (!record || !installation) {
      return identityJson({ code: 'installation_not_found', detail: 'Installation not found' }, 404)
    }
    if (installation.revokedAt) {
      return identityJson({ code: 'installation_revoked', detail: 'Installation unavailable' }, 401)
    }
    installation.lastUsedAt = new Date().toISOString()
    saveMockServer(state)
    return identityJson({
      accessToken: issueSession(record, installation.id),
      profile: record.profile,
      recoverySetupRequired: !record.setupAcknowledged,
    })
  }),

  http.post(url('/api/v1/profiles/restore'), async ({ request }) => {
    const body = (await request.json()) as {
      profileId?: unknown; recoveryCode?: unknown; installationToken?: unknown
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim().toUpperCase() : ''
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim().toUpperCase() : ''
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || null
    const blockedSeconds = restoreBlocked(profileId, clientIp)
    const genericError = 'We couldn’t restore this access. Check the profile ID and recovery code, then try again.'
    if (blockedSeconds) {
      return identityJson({ detail: genericError }, 429, { 'Retry-After': String(blockedSeconds) })
    }
    if (!profileId || profileId.length > 80 || !recoveryCode || recoveryCode.length > 64
      || !validInstallationToken(body.installationToken)) {
      recordRestoreFailure(profileId, clientIp)
      return identityJson({ detail: genericError }, 400)
    }
    const [codeHash, tokenHash] = await Promise.all([secretHash(recoveryCode), secretHash(body.installationToken)])
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.profile.id === profileId)
    const code = record?.recoveryCodes.find((candidate) => candidate.hash === codeHash && !candidate.usedAt)
    if (!record || !code) {
      recordRestoreFailure(profileId, clientIp)
      return identityJson({ detail: genericError }, 400)
    }

    // This read and update are synchronous. Two restore requests cannot both
    // see the same one-time code as unused in the development mock.
    const now = new Date().toISOString()
    code.usedAt = now
    const installation: MockInstallation = {
      id: `ins_${crypto.randomUUID()}`,
      tokenHash,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
    }
    record.installations.push(installation)
    saveMockServer(state)
    clearRestoreFailures(profileId, clientIp)
    return identityJson({
      accessToken: issueSession(record, installation.id),
      profile: record.profile,
      installationId: installation.id,
    })
  }),

  http.patch(url('/api/v1/profiles/me'), async ({ request }) => {
    const session = sessionForRequest(request)
    if (!session) return identityJson({ detail: 'API session unavailable' }, 401)
    const body = (await request.json()) as { displayName?: unknown }
    if (!Object.prototype.hasOwnProperty.call(body, 'displayName') || !validDisplayName(body.displayName)) {
      return identityJson({ detail: 'Display name is invalid.' }, 400)
    }
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.profile.id === session.profile.id)!
    record.profile.displayName = typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim() : null
    saveMockServer(state)
    for (const value of sessions.values()) {
      if (value.profile.id === record.profile.id) value.profile = record.profile
    }
    return identityJson(record.profile)
  }),

  http.post(url('/api/v1/profiles/me/recovery-setup/acknowledge'), ({ request }) => {
    const session = sessionForRequest(request)
    if (!session) return identityJson({ detail: 'API session unavailable' }, 401)
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.profile.id === session.profile.id)!
    record.setupAcknowledged = true
    saveMockServer(state)
    return new HttpResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
  }),

  http.post(url('/api/v1/profiles/me/recovery-codes/rotate'), async ({ request }) => {
    const session = sessionForRequest(request)
    if (!session) return identityJson({ detail: 'API session unavailable' }, 401)
    const batch = await freshRecoveryBatch()
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.profile.id === session.profile.id)!
    record.recoveryCodes = batch.records
    saveMockServer(state)
    return identityJson({ recoveryCodes: batch.raw, createdAt: batch.createdAt })
  }),

  http.get(url('/api/v1/profiles/me/access'), ({ request }) => {
    const session = sessionForRequest(request)
    if (!session) return identityJson({ detail: 'API session unavailable' }, 401)
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.profile.id === session.profile.id)!
    const overview: AccessOverview = {
      profileId: record.profile.id,
      unusedRecoveryCodeCount: record.recoveryCodes.filter((code) => !code.usedAt).length,
      installations: record.installations.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        lastUsedAt: item.lastUsedAt,
        revokedAt: item.revokedAt,
        current: item.id === session.installationId,
      })),
    }
    return identityJson(overview)
  }),

  http.post(url('/api/v1/profiles/me/installations/:id/revoke'), ({ params, request }) => {
    const session = sessionForRequest(request)
    if (!session) return identityJson({ detail: 'API session unavailable' }, 401)
    const installationId = params.id as string
    if (installationId === session.installationId) {
      return identityJson({ detail: 'The current installation cannot revoke itself.' }, 400)
    }
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.profile.id === session.profile.id)!
    const installation = record.installations.find((item) => item.id === installationId && !item.revokedAt)
    if (!installation) return identityJson({ detail: 'Installation not found.' }, 404)
    installation.revokedAt = new Date().toISOString()
    saveMockServer(state)
    for (const [token, value] of sessions) {
      if (value.installationId === installationId) sessions.delete(token)
    }
    return new HttpResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
  }),

  http.get(url('/api/v1/species'), () =>
    HttpResponse.json({
      items: [
        { id: 'mikania-micrantha', name: 'Mikania micrantha', latinName: 'Mikania micrantha', isInvasive: true },
        { id: 'chromolaena-odorata', name: 'Siam weed', latinName: 'Chromolaena odorata', isInvasive: true },
        { id: 'eichhornia-crassipes', name: 'Water hyacinth', latinName: 'Eichhornia crassipes', isInvasive: true },
        { id: 'clidemia-hirta', name: "Koster's curse", latinName: 'Clidemia hirta', isInvasive: true },
        { id: 'dicranopteris-linearis', name: 'Resam fern', latinName: 'Dicranopteris linearis', isInvasive: false },
      ],
    })),

  http.get(url('/api/v1/species/:id'), ({ params }) => {
    const detail = SPECIES_DETAIL[params.id as string]
    if (!detail) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    return HttpResponse.json(detail)
  }),

  http.get(url('/api/v1/notifications'), ({ request }) => {
    const profile = profileForSession(request)
    if (!profile) return HttpResponse.json({ items: [], unread: 0 })
    const items = seedNotifications()
    return HttpResponse.json({
      items, unread: items.filter((n) => !n.read).length,
    })
  }),

  http.post(url('/api/v1/notifications/:id/read'), ({ params, request }) => {
    if (!hasActiveSession(request)) return sessionUnavailable()
    const n = NOTIFICATIONS.find((x) => x.id === params.id)
    if (n) n.read = true
    return HttpResponse.json({ ok: true })
  }),

  http.post(url('/api/v1/notifications/read-all'), ({ request }) => {
    if (!hasActiveSession(request)) return sessionUnavailable()
    NOTIFICATIONS.forEach((n) => { n.read = true })
    return HttpResponse.json({ ok: true })
  }),

  // Report upload and submission endpoints.

  http.post(url('/api/v1/uploads/presign'), async ({ request }) => {
    if (!hasActiveSession(request)) return sessionUnavailable()
    if (shouldInject('failPresign')) {
      return HttpResponse.json({ detail: 'Upload service unavailable' }, { status: 503 })
    }
    const body = (await request.json()) as { contentType: string; sizeBytes: number }
    const idempotencyKey = request.headers.get('Idempotency-Key')
    if (!idempotencyKey) {
      return HttpResponse.json({ code: 'invalid_idempotency_key', detail: 'A valid Idempotency-Key is required.' }, { status: 400 })
    }
    if (body.sizeBytes > 8 * 1024 * 1024) {
      return HttpResponse.json({ detail: 'Image exceeds 8MB limit' }, { status: 413 })
    }
    const session = sessionForRequest(request)!
    const scope = `${session.profile.id}:${idempotencyKey}`
    const serialized = JSON.stringify(body)
    const existing = mockUploadIdempotency.get(scope)
    if (existing) {
      if (existing.request !== serialized) {
        return HttpResponse.json({ code: 'idempotency_conflict', detail: 'This key was used for a different upload.' }, { status: 409 })
      }
      return HttpResponse.json(existing.response)
    }
    const photoKey = `uploads/${crypto.randomUUID()}.jpg`
    const response = {
      uploadId: crypto.randomUUID(),
      uploadUrl: `https://mock-s3.local/${photoKey}`,
      photoKey,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }
    mockUploadIdempotency.set(scope, { request: serialized, response })
    return HttpResponse.json(response)
  }),

  // Accept the temporary upload request without contacting external storage.
  http.put('https://mock-s3.local/*', () => HttpResponse.text('', { status: 200 })),

  http.post(url('/api/v1/reports'), async ({ request }) => {
    if (shouldInject('expireSession')) {
      const token = bearerToken(request)
      if (token) sessions.delete(token)
      return HttpResponse.json({ detail: 'API session expired' }, { status: 401 })
    }
    if (!hasActiveSession(request)) return sessionUnavailable()
    if (shouldInject('failReport')) {
      return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
    }
    const session = sessionForRequest(request)!
    const idempotencyKey = request.headers.get('Idempotency-Key')
    if (!idempotencyKey) {
      return HttpResponse.json({ code: 'invalid_idempotency_key', detail: 'A valid Idempotency-Key is required.' }, { status: 400 })
    }

    // AC 2.3.3 — token + IP submission rate limit. Sliding 10-minute window;
    // 10 per token, 30 per IP. Reads a stand-in IP from a proxy header (falls
    // back to a per-session identifier for MSW where no real client IP exists).
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || `session:${session.token.slice(0, 12)}`
    const rateCheck = enforceReportRateLimit(session.profile.id, clientIp)
    if (rateCheck.blocked) {
      return new HttpResponse(
        JSON.stringify({ code: 'rate_limited', detail: rateCheck.detail, retryAfterSeconds: rateCheck.retryAfterSeconds }),
        {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': String(rateCheck.retryAfterSeconds) },
        },
      )
    }

    const submission = (await request.json()) as ReportSubmission
    const idempotencyScope = `${session.profile.id}:${idempotencyKey}`
    const serialized = JSON.stringify(submission)
    const existing = mockReportIdempotency.get(idempotencyScope)
    if (existing) {
      if (existing.request !== serialized) {
        return HttpResponse.json({ code: 'idempotency_conflict', detail: 'This key was used for a different report.' }, { status: 409 })
      }
      return HttpResponse.json(existing.response, { status: 201 })
    }

    // AC 2.2.2 / 4.1.2: clamp any client observedAt that lies more than five
    // minutes in the future back to the server's submission time. Prevents
    // spoofed clocks from placing sightings ahead of the current moment.
    const createdAt = new Date()
    const FIVE_MIN_MS = 5 * 60 * 1000
    const rawObserved = submission.observedAt ? new Date(submission.observedAt) : null
    const clampedObservedAt = rawObserved && rawObserved.getTime() > createdAt.getTime() + FIVE_MIN_MS
      ? createdAt.toISOString()
      : submission.observedAt

    // AC 2.3.1 — exact-image duplicate: same owner + same SHA-256 + same
    // species → return the existing report ID with status:'merged'. No second
    // public marker is created.
    if (submission.imageSha256) {
      const dup = mockReports.find((r) =>
        r.submission.imageSha256 === submission.imageSha256
        && r.submission.speciesId === submission.speciesId
        && r.ownerProfileId === session.profile.id,
      )
      if (dup) return HttpResponse.json({ ...dup, status: 'merged' as const }, { status: 200 })
    }

    // AC 2.3.2 — near-duplicate merge: same owner + same species + within
    // 25 m + within 10 min → return the earlier report with status:'merged'.
    const TEN_MIN_MS = 10 * 60 * 1000
    const NEAR_M = 25
    const near = mockReports.find((r) => {
      if (r.ownerProfileId !== session.profile.id) return false
      if (r.submission.speciesId !== submission.speciesId) return false
      if (createdAt.getTime() - new Date(r.createdAt).getTime() > TEN_MIN_MS) return false
      return haversineMetres(r.submission.location, submission.location) <= NEAR_M
    })
    if (near) return HttpResponse.json({ ...near, status: 'merged' as const }, { status: 200 })

    const id = crypto.randomUUID()
    const storedSubmission = {
      ...submission,
      observedAt: clampedObservedAt,
      photoKey: `evidence/${session.profile.id}/${id}.jpg`,
    }
    const report: Report = {
      id,
      status: 'processing',
      createdAt: createdAt.toISOString(),
      submission: storedSubmission,
      trackingUrl: `/reports/${id}`,
      validation: {
        reasonCodes: [], retryable: false, policyVersion: null, screeningMethod: null,
      },
      sightingId: null,
      ownerProfileId: session.profile.id,
    }
    mockReports.unshift(report)
    mockReportIdempotency.set(idempotencyScope, { request: serialized, response: report })
    setTimeout(() => {
      report.status = 'screened'
      report.validation = {
        reasonCodes: ['automated_rule_screened'],
        retryable: false,
        policyVersion: 'deterministic-rules-v1.0',
        screeningMethod: 'deterministic_rules',
      }
      report.sightingId = SIGHTINGS[0].id
    }, 750)
    return HttpResponse.json(report, { status: 201 })
  }),

  http.get(url('/api/v1/reports/mine'), ({ request }) => {
    if (!hasActiveSession(request)) {
      return HttpResponse.json({ detail: 'API session unavailable' }, { status: 401 })
    }
    return HttpResponse.json({ items: mockReports })
  }),

  http.get(url('/api/v1/reports/:id'), ({ params, request }) => {
    if (!hasActiveSession(request)) return sessionUnavailable()
    const report = findReport(params.id as string)
    return report
      ? HttpResponse.json(report)
      : HttpResponse.json({ detail: 'Not found' }, { status: 404 })
  }),

  // Threat-map endpoints. Sensitive coordinates are reduced here because the
  // production API is also expected to apply this privacy rule on the server.

  http.get(url('/api/v1/sightings'), ({ request }) => {
    const params = new URL(request.url).searchParams
    const speciesFilter = params.getAll('species')
    const statusFilter = params.getAll('status')
    const riskFilter = params.getAll('risk')
    const search = params.get('q')?.trim().toLowerCase() ?? ''
    let items = SIGHTINGS
    if (speciesFilter.length) items = items.filter((s) => speciesFilter.includes(s.speciesId))
    if (statusFilter.length) items = items.filter((s) => statusFilter.includes(s.status))
    if (riskFilter.length) items = items.filter((s) => riskFilter.includes(s.risk))
    if (search) items = items.filter((s) => s.speciesName.toLowerCase().includes(search)
      || s.latinName.toLowerCase().includes(search))
    return HttpResponse.json({ items })
  }),

  http.get(url('/api/v1/sightings/:id'), ({ params }) => {
    const raw = SIGHTINGS.find((s) => s.id === params.id)
    if (!raw) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const detail: SightingDetail = {
      ...raw,
      recommendedAction: RECOMMENDED_ACTION[raw.status],
      reporterTrust: 'Trusted',
      actionGuide: raw.speciesId === 'mikania-micrantha' ? MOCK_ACTION_GUIDE : null,
    }
    return HttpResponse.json(detail)
  }),

]

// Helpers for report tracking responses.

/** Read the bearer token used to find the current mock session. */
function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization')
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
}
function sessionForRequest(request: Request) {
  const token = bearerToken(request)
  return token ? sessions.get(token) ?? null : null
}
function profileForSession(request: Request): PseudonymousProfile | null {
  return sessionForRequest(request)?.profile ?? null
}
function hasActiveSession(request: Request): boolean {
  return !!profileForSession(request)
}
function sessionUnavailable() {
  return HttpResponse.json({ detail: 'API session unavailable' }, { status: 401 })
}
/** Look up a report from either the seeded pool or the session pool. */
function findReport(id: string): Report | undefined {
  return SEEDED_REPORTS.find((report) => report.id === id)
    ?? mockReports.find((report) => report.id === id)
}

/** Development landmarks mirror the server's seed fallback for place labels. */
const PLACES: { name: string; lat: number; lng: number }[] = [
  { name: 'Bukit Kiara · West Trail',        lat: 3.1497, lng: 101.6412 },
  { name: 'Bukit Kiara · Look-out',           lat: 3.1523, lng: 101.6440 },
  { name: 'Bukit Kiara · Picnic Area',        lat: 3.1489, lng: 101.6398 },
  { name: 'Bukit Kiara · Ridge Path',         lat: 3.1516, lng: 101.6371 },
  { name: 'Taman Tugu · Pond edge',           lat: 3.1502, lng: 101.6688 },
  { name: 'Bukit Nanas · Reserve entrance',   lat: 3.1521, lng: 101.7020 },
  { name: 'FRIM Kepong · Canopy walk',        lat: 3.2340, lng: 101.6293 },
  { name: 'KLCC Park · East pond',            lat: 3.1570, lng: 101.7145 },
  { name: 'Kota Damansara Community Forest',  lat: 3.1691, lng: 101.5900 },
  { name: 'Bukit Gasing · North gate',        lat: 3.1044, lng: 101.6538 },
]

/** Seed report records used by report-status mock responses. */
const now = Date.now()
const seedReport = (id: string, speciesId: string, outcome: 'target' | 'uncertain',
                    confidence: number, lat: number, lng: number, acc: number | null,
                    extent: 'single' | 'small_patch' | 'large_area', notes: string,
                    hoursAgo: number): Report => ({
  id, status: 'processing',
  createdAt: new Date(now - hoursAgo * 3600 * 1000).toISOString(),
  trackingUrl: `/reports/${id}`,
  validation: {
    reasonCodes: [], retryable: false, policyVersion: null, screeningMethod: null,
  },
  sightingId: null,
  submission: {
    photoKey: `evidence/seed/${id}.jpg`,
    speciesId, outcome, confidence, modelVersion: 'development-model-v1',
    observedAt: new Date(now - hoursAgo * 3600 * 1000).toISOString(),
    captureId: crypto.randomUUID(),
    captureSource: 'camera',
    location: { lat, lng },
    locationAccuracyM: acc, extent, notes,
    consent: { accurate: true, noPII: true },
  },
})

// Sample notifications used by the development API.

const NOTIFICATIONS: AppNotification[] = [
  { id: 'n-1', kind: 'report_screened',
    title: 'Report rule-screened',
    body: 'Automated rules published your Mikania micrantha report on the west trail.',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    read: false, linkTo: '/map' },
  { id: 'n-2', kind: 'report_needs_rescan',
    title: 'A fresh scan is needed',
    body: 'Automated rules requested a new Water hyacinth photo.',
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    read: false, linkTo: '/scan' },
  { id: 'n-3', kind: 'sync_ok',
    title: 'Queued report synced',
    body: '1 offline report reached the server after reconnect.',
    createdAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    read: false },
  { id: 'n-4', kind: 'report_rejected',
    title: 'Report needs review',
    body: 'A previous submission was marked as misidentified. Feel free to try again.',
    createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    read: true },
]

function seedNotifications(): AppNotification[] { return NOTIFICATIONS }

const SEEDED_REPORTS: Report[] = [
  seedReport('seed-trusted-01', 'mikania-micrantha', 'target', 0.91,
    3.1512, 101.6440, 12, 'small_patch',
    'Climbing along the trail rope. Fresh growth.', 2),
  seedReport('seed-new-02', 'chromolaena-odorata', 'target', 0.82,
    3.1489, 101.6398, 180, 'single',
    'Single shrub near picnic area.', 4),
  seedReport('seed-new-03', 'mikania-micrantha', 'uncertain', 0.51,
    3.1524, 101.6421, null, 'small_patch',
    'Not sure if same vine — looks slightly different.', 7),
  seedReport('seed-trusted-04', 'clidemia-hirta', 'target', 0.87,
    3.1476, 101.6432, 8, 'large_area',
    'Dense understory patch spreading fast.', 12),
  seedReport('seed-new-05', 'eichhornia-crassipes', 'target', 0.94,
    3.1503, 101.6455, 25, 'large_area',
    'Pond fully covered.', 20),
]

// Sample sightings used by the development API.

const RECOMMENDED_ACTION: Record<string, string> = {
  processing: 'Automated rule screening is running. Do not act yet.',
  screened: 'Rule-screened report. Follow the reviewed guidance for this species.',
  rejected: 'Duplicate evidence was rejected. No new map record was created.',
  removed: 'Removal recorded. Recheck for regrowth in 2–3 weeks.',
}

/** Bukit Kiara centre. Sample sightings are placed within about 1 km. */
const BK = { lat: 3.1497, lng: 101.6412 }

/** Move private coordinates by about 100 m. The same sighting ID always gets
 *  the same offset, so its marker does not jump between page loads. */
function jitter(id: string): { dLat: number; dLng: number } {
  let hash = 0
  for (let index = 0; index < id.length; index++) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0
  }
  const angle = ((hash & 0xffff) / 0xffff) * Math.PI * 2
  const distanceInDegrees = 0.001 // About 110 m at the equator.
  return {
    dLat: Math.sin(angle) * distanceInDegrees,
    dLng: Math.cos(angle) * distanceInDegrees,
  }
}

const SEED: Omit<Sighting, 'location' | 'precisionReduced' | 'lastReportedAt' | 'place' | 'thumbnailUrl' | 'screeningMethod'>[] = [
  { id: 's-01', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'screened', risk: 'high', reportCount: 4 },
  { id: 's-02', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'screened', risk: 'high', reportCount: 2 },
  { id: 's-03', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'screened', risk: 'high', reportCount: 1 },
  { id: 's-04', speciesId: 'chromolaena-odorata', speciesName: 'Siam weed', latinName: 'Chromolaena odorata', status: 'screened', risk: 'high', reportCount: 3 },
  { id: 's-05', speciesId: 'chromolaena-odorata', speciesName: 'Siam weed', latinName: 'Chromolaena odorata', status: 'screened', risk: 'high', reportCount: 1 },
  { id: 's-06', speciesId: 'eichhornia-crassipes', speciesName: 'Water hyacinth', latinName: 'Eichhornia crassipes', status: 'screened', risk: 'high', reportCount: 5 },
  { id: 's-07', speciesId: 'eichhornia-crassipes', speciesName: 'Water hyacinth', latinName: 'Eichhornia crassipes', status: 'screened', risk: 'high', reportCount: 2 },
  { id: 's-08', speciesId: 'clidemia-hirta', speciesName: "Koster's curse", latinName: 'Clidemia hirta', status: 'screened', risk: 'watch', reportCount: 3 },
  { id: 's-09', speciesId: 'clidemia-hirta', speciesName: "Koster's curse", latinName: 'Clidemia hirta', status: 'screened', risk: 'watch', reportCount: 1 },
  { id: 's-10', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'removed', risk: 'high', reportCount: 2 },
]

/** Angular offsets from the centre so pins fan out around Bukit Kiara. */
const RADIALS = [
  { radius: 0.0032, angle: 0.2 }, { radius: 0.0025, angle: 1.1 }, { radius: 0.0041, angle: 2.4 },
  { radius: 0.0018, angle: 3.6 }, { radius: 0.0037, angle: 4.7 }, { radius: 0.0028, angle: 5.9 },
  { radius: 0.0045, angle: 0.9 }, { radius: 0.0022, angle: 2.0 }, { radius: 0.0033, angle: 3.1 },
  { radius: 0.0016, angle: 4.2 },
]

const SIGHTINGS: Sighting[] = SEED.map((sighting, index) => {
  const { radius, angle } = RADIALS[index]
  const exactLocation = {
    lat: BK.lat + Math.sin(angle) * radius,
    lng: BK.lng + Math.cos(angle) * radius,
  }
  const precisionReduced = index < 3
  const offset = precisionReduced ? jitter(sighting.id) : { dLat: 0, dLng: 0 }
  return {
    ...sighting,
    location: {
      lat: exactLocation.lat + offset.dLat,
      lng: exactLocation.lng + offset.dLng,
    },
    precisionReduced,
    place: {
      displayName: PLACES[index].name,
      areaName: PLACES[index].name.split(' · ')[0] ?? null,
      trailName: PLACES[index].name.includes(' · ') ? PLACES[index].name.split(' · ')[1] : null,
      source: 'seed',
    },
    // Stand-in per-sighting photo — real deployments store the user's
    // uploaded capture at this URL. The mock reuses the species' curated
    // reference photo so the sheet demonstrates "the reporter's photo" +
    // "typical example" as two distinct blocks.
    thumbnailUrl: `/reference-images/${sighting.speciesId.replaceAll('-', '_')}.jpg`,
    screeningMethod: 'deterministic_rules',
    lastReportedAt: new Date(Date.now() - (index + 1) * 3600 * 1000).toISOString(),
  }
})

const SPECIES_DETAIL: Record<string, unknown> = {
  'mikania-micrantha': {
    id: 'mikania-micrantha',
    name: 'Mikania micrantha',
    latinName: 'Mikania micrantha',
    commonNames: ['Mile-a-minute weed', 'Chinese creeper'],
    isInvasive: true,
    risk: 'high',
    reportable: true,
    reportEligible: true,
    actionEligible: true,
    statusReviewedAt: '2026-07-15',
    statusSourceId: 'MYBIS-IAS-2024.1',
    referenceImageUrl: '/reference-images/mikania-micrantha.jpg',
    referenceImageCredit: 'Wikimedia · CC BY-SA',
    traits: [
      { label: 'Leaf shape', value: 'Heart-shaped, opposite, 5–13 cm' },
      { label: 'Flower', value: 'Small white heads in dense clusters' },
      { label: 'Growth', value: 'Climbing vine, up to 27 mm per day' },
      { label: 'Stem', value: 'Ridged, green to brown, hairy at nodes' },
    ],
    nativeTwin: {
      id: 'dicranopteris-linearis',
      name: 'Resam fern',
      latinName: 'Dicranopteris linearis',
      distinguishingTraits: [
        'Resam is a fern with forked fronds, not a vine',
        'No heart-shaped leaves',
        'Does not climb or smother other plants',
      ],
      referenceImageUrl: '/reference-images/dicranopteris-linearis.jpg',
      referenceImageCredit: 'Wikimedia · Starr Environmental',
    },
    removalSteps: [
      { order: 1, action: 'Cut the vine at ground level', safe: true },
      { order: 2, action: 'Pull roots carefully if soil is moist', safe: true },
      { order: 3, action: 'Bag all cut material — fragments can re-root', safe: true },
      { order: 4, action: 'Check back in 2–3 weeks for regrowth', safe: true },
    ],
    doNotDo: [
      'Do not compost — viable fragments will re-establish',
      'Do not leave cut material on soil',
    ],
  },
  'chromolaena-odorata': {
    id: 'chromolaena-odorata',
    name: 'Siam weed',
    latinName: 'Chromolaena odorata',
    commonNames: ['Siam weed', 'Devil weed'],
    isInvasive: true,
    risk: 'high',
    reportable: false,
    // Chromolaena reporting deferred until Iteration 2 look-alike guide ships.
    reportEligible: false,
    actionEligible: false,
    statusReviewedAt: '2026-07-15',
    statusSourceId: 'GRIIS-MYS-1.3',
    referenceImageUrl: '/reference-images/chromolaena-odorata.jpg',
    referenceImageCredit: 'Wikimedia · CC BY-SA',
    traits: [
      { label: 'Leaf shape', value: 'Opposite, ovate, 5–12 cm with serrated edges' },
      { label: 'Flower', value: 'Pale purple to white, in terminal clusters' },
      { label: 'Growth', value: 'Woody shrub or scrambler, 2–5 m' },
      { label: 'Stem', value: 'Soft-wooded, hairy, strong odour when crushed' },
    ],
    nativeTwin: null,
    removalSteps: [
      { order: 1, action: 'Cut stems close to ground before flowering', safe: true },
      { order: 2, action: 'Remove root crown to prevent re-sprouting', safe: true },
      { order: 3, action: 'Bag and dispose of all flowering parts', safe: true },
    ],
    doNotDo: [
      'Do not slash during seed season — seeds spread by wind',
      'Do not burn on-site without permit',
    ],
  },
}

const MOCK_ACTION_GUIDE = {
  actionMode: 'remove' as const,
  title: 'Cut, bag, and prevent re-rooting',
  summary: 'Cut at ground level and bag every fragment.',
  validMonths: Array.from({ length: 12 }, (_, index) => index + 1),
  steps: [
    { order: 1, action: 'Cut the vine at ground level', safe: true },
    { order: 2, action: 'Bag every cut fragment', safe: true },
  ],
  doNotDo: ['Do not compost or leave fragments on soil'],
  ppe: ['Gloves', 'Covered footwear'],
  decontamination: ['Remove fragments from tools and boots before leaving'],
  revision: 'field-guide-2026-08-automated-v1',
}
