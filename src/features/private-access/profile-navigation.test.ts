import { describe, expect, it } from 'vitest'
import { profileReturnPath, profileStateFromPath } from './profile-navigation'

describe('profile navigation', () => {
  it('remembers the peer route the user came from', () => {
    expect(profileStateFromPath('/reports')).toEqual({ returnTo: '/reports' })
    expect(profileStateFromPath('/reports/report-1')).toEqual({ returnTo: '/reports' })
    expect(profileStateFromPath('/plants')).toEqual({ returnTo: '/plants' })
    expect(profileStateFromPath('/plants/some-species')).toEqual({ returnTo: '/plants' })
    expect(profileStateFromPath('/areas')).toEqual({ returnTo: '/areas' })
  })

  it('falls back to the map for direct or unknown profile navigation', () => {
    expect(profileStateFromPath('/map')).toEqual({ returnTo: '/map' })
    expect(profileStateFromPath('/settings/offline')).toEqual({ returnTo: '/map' })
  })

  it('reads back a valid returnTo from router state', () => {
    expect(profileReturnPath({ returnTo: '/reports' })).toBe('/reports')
    expect(profileReturnPath({ returnTo: '/plants' })).toBe('/plants')
    expect(profileReturnPath({ returnTo: '/areas' })).toBe('/areas')
    expect(profileReturnPath({ returnTo: '/map' })).toBe('/map')
  })

  it('falls back to the map for missing or invalid state', () => {
    expect(profileReturnPath(null)).toBe('/map')
    expect(profileReturnPath(undefined)).toBe('/map')
    expect(profileReturnPath({ returnTo: '/private-access' })).toBe('/map')
    expect(profileReturnPath({})).toBe('/map')
  })
})
