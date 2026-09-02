/**
 * The scan flow can be entered from a few different places (the map, the
 * reports list, the profile screen), and "back"/"cancel" needs to return the
 * user to wherever they came from rather than always landing on the map.
 * This file centralizes that round-trip logic — encoding the origin into
 * router state on the way in, decoding it on the way out — so ScanFlowLayout
 * and every scan screen agree on the same shape instead of each guessing at
 * router state independently.
 */
export interface ScanNavigationState {
  returnTo: '/map' | '/reports' | '/profile'
}

export function scanReturnPath(state: unknown): ScanNavigationState['returnTo'] {
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return '/map'
  const returnTo = (state as { returnTo?: unknown }).returnTo
  return returnTo === '/reports' || returnTo === '/profile' ? returnTo : '/map'
}

export function scanStateFromPath(pathname: string): ScanNavigationState {
  if (pathname.startsWith('/reports')) return { returnTo: '/reports' }
  if (pathname === '/profile') return { returnTo: '/profile' }
  return { returnTo: '/map' }
}
