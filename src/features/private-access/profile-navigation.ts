// Single job: decide where "Back" goes from the profile/records screens.
// Both functions currently just return '/map' no matter what's passed in —
// that's intentional (see the comment below), not a stub waiting to be filled in.

export interface ProfileNavigationState {
  returnTo: '/map' | '/reports'
}

export function profileReturnPath(state: unknown): ProfileNavigationState['returnTo'] {
  // Profile and records link to each other. Letting either page become the
  // other's Back destination creates an endless Profile ↔ Records loop.
  // The map is the stable parent for both peer destinations.
  void state
  return '/map'
}

export function profileStateFromPath(pathname: string): ProfileNavigationState {
  void pathname
  return { returnTo: '/map' }
}
