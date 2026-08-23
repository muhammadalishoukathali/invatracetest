import { http, HttpResponse, passthrough } from 'msw'
import type {
  AppNotification, MergeCandidate, Report, ReportSubmission, Sighting,
  SightingDetail, User, VerifyCheck, VerifyItem,
} from '@/types'

const BASE = ''
const url = (p: string) => `${BASE}${p}`

const mockUsers = new Map<string, { user: User; password: string }>()
const mockReports: Report[] = []

/** Session survives a page reload by piggy-backing on sessionStorage. The real
 *  API achieves the same thing with an httpOnly refresh cookie; without this
 *  the fake session evaporates on refresh and every route bounces to sign-in. */
const SESSION_KEY = 'invatrace-mock-session'
function loadSession(): User | null {
  if (typeof sessionStorage === 'undefined') return null
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') }
  catch { return null }
}
function saveSession(u: User | null) {
  if (typeof sessionStorage === 'undefined') return
  if (u) sessionStorage.setItem(SESSION_KEY, JSON.stringify(u))
  else sessionStorage.removeItem(SESSION_KEY)
}
let mockSession: User | null = loadSession()
const setSession = (u: User | null) => { mockSession = u; saveSession(u) }
/**
 * Failure-injection knobs so Playwright / manual tests can exercise the
 * offline queue and retry paths without unplugging the machine.
 *   window.__msw = { failPresign: true }   → next presign returns 503
 *   window.__msw = { failReport: true }    → next POST /reports returns 500
 * Cleared automatically after the failing call fires once.
 */
declare global {
  interface Window { __msw?: { failPresign?: boolean; failReport?: boolean } }
}
const shouldFail = (kind: 'failPresign' | 'failReport') => {
  const flags = typeof window !== 'undefined' ? window.__msw : undefined
  if (flags?.[kind]) { flags[kind] = false; return true }
  return false
}

mockUsers.set('nadia@example.org', {
  password: 'demo1234',
  user: {
    id: 'dev-coordinator',
    name: 'Nadia',
    email: 'nadia@example.org',
    isPseudonymous: false,
    role: 'Coordinator',
    trustLevel: 'Steward',
  },
})

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

  http.post(url('/api/v1/auth/login'), async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    const entry = mockUsers.get(body.email)
    if (!entry || entry.password !== body.password) {
      return HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 })
    }
    setSession(entry.user)
    return HttpResponse.json({ accessToken: `mock-${entry.user.id}`, user: entry.user })
  }),

  http.post(url('/api/v1/auth/register'), async ({ request }) => {
    const body = (await request.json()) as { name: string; email: string; password: string; role: string }
    if (mockUsers.has(body.email)) {
      return HttpResponse.json({ detail: 'Email already registered' }, { status: 409 })
    }
    const user: User = {
      id: crypto.randomUUID(),
      name: body.name,
      email: body.email,
      isPseudonymous: false,
      role: body.role as User['role'],
      trustLevel: 'New',
    }
    mockUsers.set(body.email, { user, password: body.password })
    setSession(user)
    return HttpResponse.json({ accessToken: `mock-${user.id}`, user })
  }),

  http.post(url('/api/v1/profiles/bootstrap'), () => {
    const user: User = {
      id: crypto.randomUUID(),
      name: null,
      email: null,
      isPseudonymous: true,
      role: 'Detector',
      trustLevel: 'New',
    }
    setSession(user)
    return HttpResponse.json({ accessToken: `mock-${user.id}`, user })
  }),

  http.post(url('/api/v1/auth/refresh'), () => {
    if (!mockSession) {
      return HttpResponse.json({ detail: 'No session' }, { status: 401 })
    }
    return HttpResponse.json({ accessToken: `mock-${mockSession.id}`, user: mockSession })
  }),

  http.post(url('/api/v1/auth/logout'), () => {
    setSession(null)
    return HttpResponse.json({ ok: true })
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

  http.get(url('/api/v1/notifications'), () => {
    if (!mockSession) return HttpResponse.json({ items: [], unread: 0 })
    const items = seedNotifications(mockSession.role)
    return HttpResponse.json({
      items, unread: items.filter((n) => !n.read).length,
    })
  }),

  http.post(url('/api/v1/notifications/:id/read'), ({ params }) => {
    const n = NOTIFICATIONS.find((x) => x.id === params.id)
    if (n) n.read = true
    return HttpResponse.json({ ok: true })
  }),

  http.post(url('/api/v1/notifications/read-all'), () => {
    NOTIFICATIONS.forEach((n) => { n.read = true })
    return HttpResponse.json({ ok: true })
  }),

  /* Report flow — presigned upload, submission, own reports. */

  http.post(url('/api/v1/uploads/presign'), async ({ request }) => {
    if (shouldFail('failPresign')) {
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
    if (!mockSession) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }
    if (shouldFail('failReport')) {
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

  http.get(url('/api/v1/reports/mine'), () => {
    if (!mockSession) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })
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

  http.get(url('/api/v1/verify/queue'), () => {
    if (!coordAllowed()) return unauth()
    return HttpResponse.json({ items: verifyQueue() })
  }),

  http.get(url('/api/v1/verify/:id'), ({ params }) => {
    if (!coordAllowed()) return unauth()
    const item = verifyQueue().find((v) => v.id === params.id)
    if (!item) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    return HttpResponse.json(item)
  }),

  http.get(url('/api/v1/verify/:id/merge-candidates'), ({ params }) => {
    if (!coordAllowed()) return unauth()
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

  http.post(url('/api/v1/verify/:id/confirm'), ({ params }) => {
    if (!coordAllowed()) return unauth()
    const r = findReport(params.id as string)
    if (!r) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    r.status = 'confirmed'
    return HttpResponse.json({ ok: true, status: r.status })
  }),

  http.post(url('/api/v1/verify/:id/reject'), ({ params }) => {
    if (!coordAllowed()) return unauth()
    const r = findReport(params.id as string)
    if (!r) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    r.status = 'rejected'
    return HttpResponse.json({ ok: true, status: r.status })
  }),

  http.post(url('/api/v1/verify/:id/merge'), async ({ params, request }) => {
    if (!coordAllowed()) return unauth()
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
function coordAllowed(): boolean {
  return !!mockSession && ['Coordinator', 'Expert', 'Admin'].includes(mockSession.role)
}
function unauth() {
  return HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })
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
