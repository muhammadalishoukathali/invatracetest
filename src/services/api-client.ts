/** Wraps fetch so every request gets the current access token attached, a
 *  401 triggers one retry after session recovery instead of just failing,
 *  and a bad response gets turned into an `ApiError` instead of a raw
 *  Response object I'd have to unwrap everywhere. */
// mocks are on by default in dev, see main.tsx - only actually hit the real
// backend once I explicitly opt out of that
const MOCKS_ON = import.meta.env.DEV
  && import.meta.env.VITE_ENABLE_MOCKS !== 'false'
const BASE = MOCKS_ON
  ? ''
  : (import.meta.env.VITE_API_BASE_URL ?? '')

/** Absolute URL for an API path. Some non-JSON code paths (streaming
 *  offline-pack files, e.g.) call fetch() directly rather than through
 *  the api() wrapper below; they use this helper so they see the same
 *  BASE resolution and don't hand undici a bare relative URL in
 *  environments that reject those. */
export function apiUrl(path: string): string {
  if (BASE) return `${BASE}${path}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(path, window.location.origin).toString()
  }
  return new URL(path, 'http://localhost').toString()
}

// keeping the token in memory only (not localStorage) so it gets wiped when
// the tab closes - a bit less convenient but felt like the safer default
let accessToken: string | null = null
let recoverSession: (() => Promise<boolean>) | null = null
let recoveryPromise: Promise<boolean> | null = null

const SESSION_ENTRY_PATHS = new Set([
  '/api/v1/profiles/start',
  '/api/v1/profiles/bootstrap',
  '/api/v1/profiles/restore',
])

const isIdentityPath = (path: string) => path.startsWith('/api/v1/profiles')

// the private-access store calls this whenever the token changes (login,
// refresh, logout). I did it this way instead of importing the store
// directly here because that would've created a circular import between
// the two modules.
export const setAccessToken = (t: string | null) => { accessToken = t }
// same idea - the store hands us a callback for re-bootstrapping a session
// so this file doesn't need to know anything about how that store works
export const setSessionRecovery = (recover: () => Promise<boolean>) => { recoverSession = recover }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tokenAtFirstAttempt = accessToken
  const request = () => fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'omit',
    cache: isIdentityPath(path) ? 'no-store' : init.cache,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  })

  let res = await request()
  if (res.status === 401 && !SESSION_ENTRY_PATHS.has(path) && recoverSession) {
    // this took a bit of debugging to get right - if another request already
    // triggered a bootstrap and replaced the token while this one was in
    // flight, we should just retry with that newer token rather than
    // clearing it. sharing one recovery promise is what stops two requests
    // failing at once from triggering two separate bootstraps racing each other
    if (accessToken !== tokenAtFirstAttempt) {
      res = await request()
    } else {
      setAccessToken(null)
      recoveryPromise ??= recoverSession().finally(() => { recoveryPromise = null })
      if (await recoveryPromise) res = await request()
    }
  }
  if (!res.ok) {
    const raw = await res.text()
    let code: string | null = null
    let message = raw
    try {
      const parsed = JSON.parse(raw) as { code?: unknown; detail?: unknown }
      code = typeof parsed.code === 'string' ? parsed.code : null
      message = typeof parsed.detail === 'string' ? parsed.detail : raw
    } catch { /* not JSON, just keep the raw text as the message */ }
    throw new ApiError(res.status, message, code, Number(res.headers.get('Retry-After') ?? 0) || null)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
    public retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
