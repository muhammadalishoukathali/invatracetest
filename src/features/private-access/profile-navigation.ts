// Single job: decide where "Back" goes from the profile screen. We honour
// the peer route the user came from (records, plants, areas, map) so a
// mobile "Back" gesture on the profile lands the user back on their prior
// screen. The back button on the profile page is rendered with
// `navigate(..., { replace: true })`, so hopping profile ↔ records replaces
// entries instead of stacking them, which keeps browser history clean and
// avoids the endless loop that was worried about in the old comment.

export interface ProfileNavigationState {
  returnTo: '/map' | '/reports' | '/plants' | '/areas'
}

const VALID_RETURN: readonly ProfileNavigationState['returnTo'][] = [
  '/map',
  '/reports',
  '/plants',
  '/areas',
]

function isValidReturn(value: unknown): value is ProfileNavigationState['returnTo'] {
  return typeof value === 'string' && (VALID_RETURN as readonly string[]).includes(value)
}

export function profileReturnPath(state: unknown): ProfileNavigationState['returnTo'] {
  if (state && typeof state === 'object' && 'returnTo' in state) {
    const returnTo = (state as { returnTo?: unknown }).returnTo
    if (isValidReturn(returnTo)) return returnTo
  }
  return '/map'
}

export function profileStateFromPath(pathname: string): ProfileNavigationState {
  if (pathname.startsWith('/reports')) return { returnTo: '/reports' }
  if (pathname.startsWith('/plants')) return { returnTo: '/plants' }
  if (pathname.startsWith('/areas')) return { returnTo: '/areas' }
  return { returnTo: '/map' }
}
