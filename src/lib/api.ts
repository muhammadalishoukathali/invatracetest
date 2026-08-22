/** Thin fetch wrapper. Endpoint surface mirrors Arch §7 exactly; handlers are
 *  mocked by MSW until the backend lands. */
const BASE = import.meta.env.VITE_ENABLE_MOCKS === 'true'
  ? ''
  : (import.meta.env.VITE_API_BASE_URL ?? '')

let accessToken: string | null = null // Arch §7.1 — memory only, never storage

export const setAccessToken = (t: string | null) => { accessToken = t }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include', // refresh token travels as an httpOnly cookie
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export const health = () => api<{ status: string; database: string }>('/health')
