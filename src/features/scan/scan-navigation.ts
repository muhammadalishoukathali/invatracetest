/**
 * The scan flow can be opened from a few different places - the map, the
 * reports list, the profile screen - and "back"/"cancel" needs to actually
 * return the user to wherever they came from, not just default to the map
 * every time. This file centralizes that round-trip logic: encode the origin
 * into router state on the way in, decode it on the way out, so
 * ScanFlowLayout and every scan screen are all reading the same shape
 * instead of each one guessing at router state on its own.
 */
export interface ScanNavigationState {
  returnTo: '/map' | '/reports' | '/profile' | '/areas'
}

const VALID: readonly ScanNavigationState['returnTo'][] = ['/map', '/reports', '/profile', '/areas']

export function scanReturnPath(state: unknown): ScanNavigationState['returnTo'] {
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return '/map'
  const returnTo = (state as { returnTo?: unknown }).returnTo
  return (VALID as readonly string[]).includes(returnTo as string)
    ? (returnTo as ScanNavigationState['returnTo'])
    : '/map'
}

export function scanStateFromPath(pathname: string): ScanNavigationState {
  if (pathname.startsWith('/reports')) return { returnTo: '/reports' }
  if (pathname === '/profile') return { returnTo: '/profile' }
  if (pathname.startsWith('/areas')) return { returnTo: '/areas' }
  return { returnTo: '/map' }
}
