import { http, HttpResponse, passthrough, type JsonBodyType } from 'msw'
import type {
  AppNotification, MergeCandidate, Report, ReportSubmission, Sighting,
  AccessOverview, PseudonymousProfile, SightingDetail, VerifyCheck, VerifyItem,
} from '@/types'

const url = (p: string) => `*${p}`

const mockReports: Report[] = []
const sessions = new Map<string, { profile: PseudonymousProfile; installationId: string }>()
const MOCK_SERVER_KEY = 'invatrace-mock-server-v2'
const MOCK_HASH_PEPPER = 'development-only-invatrace-mock-pepper'

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
  sessions.set(accessToken, { profile: record.profile, installationId })
  return accessToken
}

const restoreFailures = new Map<string, { count: number; blockedUntil: number }>()
function restoreBlocked(profileId: string): number {
  const entry = restoreFailures.get(profileId)
  return entry && entry.blockedUntil > Date.now()
    ? Math.ceil((entry.blockedUntil - Date.now()) / 1000) : 0
}
function recordRestoreFailure(profileId: string) {
  const previous = restoreFailures.get(profileId) ?? { count: 0, blockedUntil: 0 }
  const count = previous.count + 1
  restoreFailures.set(profileId, {
    count,
    blockedUntil: count < 5 ? 0 : Date.now() + Math.min(60_000, 1000 * 2 ** (count - 5)),
  })
}

/**
 * Mock-only deterministic mapping. It makes page reloads realistic without
 * storing the raw installation token or pretending to be a production data
 * store. The production service must persist a strong server-side token hash.
 */
export async function createMockProfileForToken(
  installationToken: string,
): Promise<PseudonymousProfile> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(installationToken),
  )
  const profileKey = Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return {
    id: `anonymous-${profileKey}`,
    displayName: null,
    role: 'Detector',
    trustLevel: 'New',
  }
}
/**
 * Failure-injection knobs so Playwright / manual tests can exercise the
 * offline queue and retry paths without unplugging the machine.
 *   window.__msw = { failPresign: true }   → next presign returns 503
 *   window.__msw = { failReport: true }    → next POST /reports returns 500
 *   window.__msw = { expireSession: true } → next POST /reports returns 401
 * Cleared automatically after the failing call fires once.
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
  /* Explicit passthroughs — MSW's default bypass is unreliable for module
     workers and cross-origin binary fetches. These paths reach the network
     unmodified, keeping MapLibre's worker and vector tiles working. */
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
    const blockedSeconds = restoreBlocked(profileId)
    const genericError = 'We couldn’t restore this access. Check the profile ID and recovery code, then try again.'
    if (blockedSeconds) {
      return identityJson({ detail: genericError }, 429, { 'Retry-After': String(blockedSeconds) })
    }
    if (!profileId || profileId.length > 80 || !recoveryCode || recoveryCode.length > 64
      || !validInstallationToken(body.installationToken)) {
      recordRestoreFailure(profileId)
      return identityJson({ detail: genericError }, 400)
    }
    const [codeHash, tokenHash] = await Promise.all([secretHash(recoveryCode), secretHash(body.installationToken)])
    const state = loadMockServer()
    const record = state.profiles.find((candidate) => candidate.profile.id === profileId)
    const code = record?.recoveryCodes.find((candidate) => candidate.hash === codeHash && !candidate.usedAt)
    if (!record || !code) {
      recordRestoreFailure(profileId)
      return identityJson({ detail: genericError }, 400)
    }

    // No await occurs between this final state read and save: concurrent uses
    // of one code cannot both observe it as unused in this development mock.
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
    restoreFailures.delete(profileId)
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
    const items = seedNotifications(profile.role)
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

  /* Report flow — presigned upload, submission, own reports. */

  http.post(url('/api/v1/uploads/presign'), async ({ request }) => {
    if (!hasActiveSession(request)) return sessionUnavailable()
    if (shouldInject('failPresign')) {
      return HttpResponse.json({ detail: 'Upload service unavailable' }, { status: 503 })
    }
    const body = (await request.json()) as { contentType: string; sizeBytes: number }
    if (body.sizeBytes > 8 * 1024 * 1024) {
      return HttpResponse.json({ detail: 'Image exceeds 8MB limit' }, { status: 413 })
    }
    const photoKey = `photos/${crypto.randomUUID()}.jpg`
    return HttpResponse.json({
      uploadId: crypto.randomUUID(),
      uploadUrl: `https://mock-s3.local/${photoKey}`,
      photoKey,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    })
  }),

  /* Simulate the S3 PUT so the client's fetch does not hit the network. */
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
    const submission = (await request.json()) as ReportSubmission
    const id = crypto.randomUUID()
    const report: Report = {
      id,
      status: 'candidate',
      createdAt: new Date().toISOString(),
      submission,
      trackingUrl: `/verify/${id}`,
    }
    mockReports.unshift(report)
    return HttpResponse.json(report, { status: 201 })
  }),

  http.get(url('/api/v1/reports/mine'), ({ request }) => {
    if (!hasActiveSession(request)) {
      return HttpResponse.json({ detail: 'API session unavailable' }, { status: 401 })
    }
    return HttpResponse.json({ items: mockReports })
  }),

  /* Threat map — sightings list + detail. Precision policy applied here
     to simulate what the real API will do server-side (Arch §11). */

  http.get(url('/api/v1/sightings'), ({ request }) => {
    const params = new URL(request.url).searchParams
    const speciesFilter = params.getAll('species')
    const statusFilter = params.getAll('status')
    let items = SIGHTINGS
    if (speciesFilter.length) items = items.filter((s) => speciesFilter.includes(s.speciesId))
    if (statusFilter.length) items = items.filter((s) => statusFilter.includes(s.status))
    return HttpResponse.json({ items })
  }),

  http.get(url('/api/v1/sightings/:id'), ({ params }) => {
    const raw = SIGHTINGS.find((s) => s.id === params.id)
    if (!raw) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const detail: SightingDetail = {
      ...raw,
      recommendedAction: RECOMMENDED_ACTION[raw.status],
      reporterTrust: raw.status === 'candidate' ? 'New' : 'Trusted',
    }
    return HttpResponse.json(detail)
  }),

  /* Verify queue — coordinator/expert/admin only. */

  http.get(url('/api/v1/verify/queue'), ({ request }) => {
    if (!coordAllowed(request)) return forbidden()
    return HttpResponse.json({ items: verifyQueue() })
  }),

  http.get(url('/api/v1/verify/:id'), ({ params, request }) => {
    if (!coordAllowed(request)) return forbidden()
    const item = verifyQueue().find((v) => v.id === params.id)
    if (!item) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    return HttpResponse.json(item)
  }),

  http.get(url('/api/v1/verify/:id/merge-candidates'), ({ params, request }) => {
    if (!coordAllowed(request)) return forbidden()
    const item = verifyQueue().find((v) => v.id === params.id)
    if (!item) return HttpResponse.json({ items: [] })
    const candidates: MergeCandidate[] = SIGHTINGS
      .filter((s) => s.speciesId === item.speciesId && s.status !== 'rejected')
      .map((s) => ({
        id: s.id,
        speciesName: s.speciesName,
        status: s.status,
        distanceM: haversine(s.location, item.location),
        reportCount: s.reportCount,
        lastReportedAt: s.lastReportedAt,
      }))
      .filter((c) => c.distanceM < 500)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 5)
    return HttpResponse.json({ items: candidates })
  }),

  http.post(url('/api/v1/verify/:id/confirm'), ({ params, request }) => {
    if (!coordAllowed(request)) return forbidden()
    const r = findReport(params.id as string)
    if (!r) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    r.status = 'confirmed'
    return HttpResponse.json({ ok: true, status: r.status })
  }),

  http.post(url('/api/v1/verify/:id/reject'), ({ params, request }) => {
    if (!coordAllowed(request)) return forbidden()
    const r = findReport(params.id as string)
    if (!r) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    r.status = 'rejected'
    return HttpResponse.json({ ok: true, status: r.status })
  }),

  http.post(url('/api/v1/verify/:id/merge'), async ({ params, request }) => {
    if (!coordAllowed(request)) return forbidden()
    const body = (await request.json()) as { targetId: string }
    const r = findReport(params.id as string)
    const target = SIGHTINGS.find((s) => s.id === body.targetId)
    if (!r || !target) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    r.status = 'confirmed'
    target.reportCount += 1
    target.lastReportedAt = new Date().toISOString()
    return HttpResponse.json({ ok: true, mergedInto: target.id })
  }),
]

/* ── Verify helpers ─────────────────────────────────────── */

/** Roles allowed to open the queue. Detector / Volunteer are not. */
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
function coordAllowed(request: Request): boolean {
  const profile = profileForSession(request)
  return !!profile && ['Coordinator', 'Expert', 'Admin'].includes(profile.role)
}
function forbidden() {
  return HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })
}
function sessionUnavailable() {
  return HttpResponse.json({ detail: 'API session unavailable' }, { status: 401 })
}
/** Look up a report from either the seeded pool or the session pool. */
function findReport(id: string): Report | undefined {
  return SEEDED_REPORTS.find((r) => r.id === id) ?? mockReports.find((r) => r.id === id)
}

/** Turn each `candidate` report into a queue row with derived checks. */
function verifyQueue(): VerifyItem[] {
  // Compose: seeded pool + anything users have submitted this session.
  const all = [...SEEDED_REPORTS, ...mockReports]
  return all
    .filter((r) => r.status === 'candidate')
    .map((r) => {
      const s = r.submission
      const speciesName = SPECIES_NAME[s.speciesId ?? ''] ?? 'Unknown species'
      const latinName = SPECIES_LATIN[s.speciesId ?? ''] ?? '—'
      const trust: VerifyItem['submitterTrust'] = r.id.startsWith('seed-new-')
        ? 'New' : r.id.startsWith('seed-trusted-') ? 'Trusted' : 'New'
      return {
        id: r.id,
        photoUrl: `https://picsum.photos/seed/${r.id}/560/360`,
        speciesId: s.speciesId,
        speciesName,
        latinName,
        outcome: s.outcome,
        confidence: s.confidence,
        modelVersion: s.modelVersion,
        location: s.location,
        locationAccuracyM: s.locationAccuracyM,
        place: nearestPlace(s.location),
        extent: s.extent,
        notes: s.notes,
        submitterId: r.id,
        submitterTrust: trust,
        submittedAt: r.createdAt,
        checks: buildChecks(r, trust),
      }
    })
    .sort((a, b) => a.submittedAt < b.submittedAt ? 1 : -1)  // newest first
}

const SPECIES_NAME: Record<string, string> = {
  'mikania-micrantha': 'Mikania micrantha',
  'chromolaena-odorata': 'Siam weed',
  'eichhornia-crassipes': 'Water hyacinth',
  'clidemia-hirta': "Koster's curse",
}
const SPECIES_LATIN: Record<string, string> = {
  'mikania-micrantha': 'Mikania micrantha',
  'chromolaena-odorata': 'Chromolaena odorata',
  'eichhornia-crassipes': 'Eichhornia crassipes',
  'clidemia-hirta': 'Clidemia hirta',
}

function buildChecks(r: Report, trust: 'New' | 'Trusted' | 'Steward'): VerifyCheck[] {
  const s = r.submission
  const speciesLevel: VerifyCheck['level'] =
    s.outcome === 'target' && s.confidence >= 0.8 ? 'pass'
      : s.outcome === 'uncertain' ? 'warn' : 'warn'
  const locLevel: VerifyCheck['level'] =
    s.locationAccuracyM == null ? 'warn'
      : s.locationAccuracyM < 50 ? 'pass'
      : s.locationAccuracyM < 200 ? 'warn' : 'fail'
  const qualityLevel: VerifyCheck['level'] = 'pass'  // stub adapter already gated
  const trustLevel: VerifyCheck['level'] = trust === 'New' ? 'warn' : 'pass'
  return [
    { id: 'species', label: 'Species identification',
      level: speciesLevel,
      detail: `Model verdict: ${s.outcome} at ${Math.round(s.confidence * 100)}% (${s.modelVersion})` },
    { id: 'location', label: 'Location precision',
      level: locLevel,
      detail: s.locationAccuracyM != null
        ? `GPS accurate to ~${s.locationAccuracyM} m`
        : 'Manual entry — no GPS accuracy recorded' },
    { id: 'quality', label: 'Photo quality',
      level: qualityLevel,
      detail: 'Passed on-device quality gate at scan time' },
    { id: 'trust', label: 'Submitter trust',
      level: trustLevel,
      detail: `Reporter trust level: ${trust}` },
  ]
}

/** Great-circle distance in metres. Good enough for merge-distance display. */
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2)
  const c = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2
  return Math.round(2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c)))
}

/** Simple reverse-geocode stub — nearest Malaysian landmark from a small
 *  hand-curated list. The real API will hit MapTiler / Nominatim scoped to
 *  Malaysia. Iteration 1 is Klang Valley only, so the seed covers that. */
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

function nearestPlace(loc: { lat: number; lng: number }): string {
  let best = PLACES[0]
  let bestD = Number.POSITIVE_INFINITY
  for (const p of PLACES) {
    const d = haversine(loc, { lat: p.lat, lng: p.lng })
    if (d < bestD) { bestD = d; best = p }
  }
  return best.name
}

/** Seed a handful of candidate reports so the queue is not empty on first load. */
const now = Date.now()
const seedReport = (id: string, speciesId: string, outcome: 'target' | 'uncertain',
                    confidence: number, lat: number, lng: number, acc: number | null,
                    extent: 'single' | 'small_patch' | 'large_area', notes: string,
                    hoursAgo: number): Report => ({
  id, status: 'candidate',
  createdAt: new Date(now - hoursAgo * 3600 * 1000).toISOString(),
  trackingUrl: `/verify/${id}`,
  submission: {
    photoKey: `photos/${id}.jpg`,
    speciesId, outcome, confidence, modelVersion: 'stub-v0.1.0',
    location: { lat, lng },
    locationAccuracyM: acc, extent, notes,
    consent: { accurate: true, noPII: true },
  },
})

/* ── Notifications seed ─────────────────────────────────── */

const NOTIFICATIONS: AppNotification[] = [
  { id: 'n-1', kind: 'report_confirmed',
    title: 'Report confirmed',
    body: 'Your Mikania micrantha sighting on the west trail was confirmed by a coordinator.',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    read: false, linkTo: '/map' },
  { id: 'n-2', kind: 'queue_new',
    title: 'New report in verify queue',
    body: 'A trusted reporter submitted a Water hyacinth sighting near the pond.',
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    read: false, linkTo: '/verify' },
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

/** Notifications visible to a given role. Detectors don't see queue events. */
function seedNotifications(role: string): AppNotification[] {
  return NOTIFICATIONS.filter((n) => {
    if (n.kind === 'queue_new') return ['Coordinator', 'Expert', 'Admin'].includes(role)
    return true
  })
}

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

/* ── Sightings seed ─────────────────────────────────────── */

const RECOMMENDED_ACTION: Record<string, string> = {
  candidate: 'Awaiting coordinator verification. Do not act yet.',
  confirmed: 'Approved for removal. Follow safe-removal steps for this species.',
  rejected: 'Marked as misidentified — no action required.',
  removed: 'Removal recorded. Recheck for regrowth in 2–3 weeks.',
}

/** Bukit Kiara centre. All seed pins are within ~1 km of this. */
const BK = { lat: 3.1497, lng: 101.6412 }

/** Deterministic "jitter" so candidate / new-trust pins render at reduced
 *  precision (§11). ~100 m at the equator. Same input → same output. */
function jitter(id: string): { dLat: number; dLng: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  const a = ((h & 0xffff) / 0xffff) * Math.PI * 2
  const r = 0.001  // ~110 m
  return { dLat: Math.sin(a) * r, dLng: Math.cos(a) * r }
}

const SEED: Omit<Sighting, 'location' | 'precisionReduced' | 'lastReportedAt'>[] = [
  { id: 's-01', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'confirmed', risk: 'high', reportCount: 4 },
  { id: 's-02', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'confirmed', risk: 'high', reportCount: 2 },
  { id: 's-03', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'candidate', risk: 'high', reportCount: 1 },
  { id: 's-04', speciesId: 'chromolaena-odorata', speciesName: 'Siam weed', latinName: 'Chromolaena odorata', status: 'confirmed', risk: 'high', reportCount: 3 },
  { id: 's-05', speciesId: 'chromolaena-odorata', speciesName: 'Siam weed', latinName: 'Chromolaena odorata', status: 'candidate', risk: 'high', reportCount: 1 },
  { id: 's-06', speciesId: 'eichhornia-crassipes', speciesName: 'Water hyacinth', latinName: 'Eichhornia crassipes', status: 'confirmed', risk: 'high', reportCount: 5 },
  { id: 's-07', speciesId: 'eichhornia-crassipes', speciesName: 'Water hyacinth', latinName: 'Eichhornia crassipes', status: 'confirmed', risk: 'high', reportCount: 2 },
  { id: 's-08', speciesId: 'clidemia-hirta', speciesName: "Koster's curse", latinName: 'Clidemia hirta', status: 'confirmed', risk: 'watch', reportCount: 3 },
  { id: 's-09', speciesId: 'clidemia-hirta', speciesName: "Koster's curse", latinName: 'Clidemia hirta', status: 'candidate', risk: 'watch', reportCount: 1 },
  { id: 's-10', speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', status: 'removed', risk: 'high', reportCount: 2 },
]

/** Angular offsets from the centre so pins fan out around Bukit Kiara. */
const RADIALS = [
  { r: 0.0032, θ: 0.2 }, { r: 0.0025, θ: 1.1 }, { r: 0.0041, θ: 2.4 },
  { r: 0.0018, θ: 3.6 }, { r: 0.0037, θ: 4.7 }, { r: 0.0028, θ: 5.9 },
  { r: 0.0045, θ: 0.9 }, { r: 0.0022, θ: 2.0 }, { r: 0.0033, θ: 3.1 },
  { r: 0.0016, θ: 4.2 },
]

const SIGHTINGS: Sighting[] = SEED.map((s, i) => {
  const { r, θ } = RADIALS[i]
  const exact = { lat: BK.lat + Math.sin(θ) * r, lng: BK.lng + Math.cos(θ) * r }
  const reduced = s.status === 'candidate'
  const j = reduced ? jitter(s.id) : { dLat: 0, dLng: 0 }
  return {
    ...s,
    location: { lat: exact.lat + j.dLat, lng: exact.lng + j.dLng },
    precisionReduced: reduced,
    lastReportedAt: new Date(Date.now() - (i + 1) * 3600 * 1000).toISOString(),
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
