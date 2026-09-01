export interface ProfileNavigationState {
  returnTo: '/map' | '/reports'
}

export function profileReturnPath(state: unknown): ProfileNavigationState['returnTo'] {
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return '/map'
  return (state as { returnTo?: unknown }).returnTo === '/reports' ? '/reports' : '/map'
}

export function profileStateFromPath(pathname: string): ProfileNavigationState {
  return { returnTo: pathname.startsWith('/reports') ? '/reports' : '/map' }
}
