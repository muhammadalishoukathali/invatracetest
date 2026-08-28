/** Thin fetch wrapper. Handlers are mocked by MSW until the backend lands. */
const BASE = import.meta.env.VITE_ENABLE_MOCKS === 'true'
  ? ''
  : (import.meta.env.VITE_API_BASE_URL ?? '')

let accessToken: string | null = null // Arch §7.1 — memory only, never storage
let recoverSession: (() => Promise<boolean>) | null = null

const SESSION_ENTRY_PATHS = new Set([
  '/api/v1/profiles/start',
  '/api/v1/profiles/bootstrap',
  '/api/v1/profiles/restore',
])

const isIdentityPath = (path: string) => path.startsWith('/api/v1/profiles')

export const setAccessToken = (t: string | null) => { accessToken = t }
export const setSessionRecovery = (recover: () => Promise<boolean>) => { recoverSession = recover }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const request = () => fetch(`${BASE}${path}`, {
    ...init,
    // The bootstrap request carries the installation token in its JSON body.
    // A production API may also use a secure httpOnly cookie for session refresh.
    credentials: 'include',
    cache: isIdentityPath(path) ? 'no-store' : init.cache,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  })

  let res = await request()
  if (res.status === 401 && !SESSION_ENTRY_PATHS.has(path) && recoverSession) {
    setAccessToken(null)
    if (await recoverSession()) res = await request()
  }
  if (!res.ok) {
    const raw = await res.text()
    let code: string | null = null
    let message = raw
    try {
      const parsed = JSON.parse(raw) as { code?: unknown; detail?: unknown }
      code = typeof parsed.code === 'string' ? parsed.code : null
      message = typeof parsed.detail === 'string' ? parsed.detail : raw
    } catch { /* Keep the plain-text response. */ }
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

export const health = () => api<{ status: string; database: string }>('/health')
