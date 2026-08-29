/** Shared HTTP client. It adds the current access token, retries a request once
 *  after session recovery, and converts failed responses into `ApiError`. */
const BASE = import.meta.env.VITE_ENABLE_MOCKS === 'true'
  ? ''
  : (import.meta.env.VITE_API_BASE_URL ?? '')

// The access token stays in memory so it is cleared when the page closes.
let accessToken: string | null = null
let recoverSession: (() => Promise<boolean>) | null = null
let recoveryPromise: Promise<boolean> | null = null

const SESSION_ENTRY_PATHS = new Set([
  '/api/v1/profiles/start',
  '/api/v1/profiles/bootstrap',
  '/api/v1/profiles/restore',
])

const isIdentityPath = (path: string) => path.startsWith('/api/v1/profiles')

export const setAccessToken = (t: string | null) => { accessToken = t }
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
    // A concurrent bootstrap may already have replaced the token used by this
    // request. Never clear that newer token; just retry with it. Otherwise one
    // shared recovery prevents duplicate bootstraps from racing each other.
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
    } catch { /* Keep the plain response text. */ }
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
