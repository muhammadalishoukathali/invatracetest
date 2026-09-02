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
