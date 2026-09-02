import { describe, expect, it } from 'vitest'
import { profileReturnPath, profileStateFromPath } from './profile-navigation'

describe('profile navigation', () => {
  it('exits profile to the map instead of looping back to records', () => {
    expect(profileStateFromPath('/reports')).toEqual({ returnTo: '/map' })
    expect(profileStateFromPath('/reports/report-1')).toEqual({ returnTo: '/map' })
    expect(profileReturnPath({ returnTo: '/reports' })).toBe('/map')
  })

  it('falls back to the map for direct or invalid profile navigation', () => {
    expect(profileStateFromPath('/map')).toEqual({ returnTo: '/map' })
    expect(profileReturnPath(null)).toBe('/map')
    expect(profileReturnPath({ returnTo: '/private-access' })).toBe('/map')
  })
})
