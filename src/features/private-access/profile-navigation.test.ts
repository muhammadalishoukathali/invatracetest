import { describe, expect, it } from 'vitest'
import { profileReturnPath, profileStateFromPath } from './profile-navigation'

describe('profile navigation', () => {
  it('returns to records when profile was opened from a records page', () => {
    expect(profileStateFromPath('/reports')).toEqual({ returnTo: '/reports' })
    expect(profileStateFromPath('/reports/report-1')).toEqual({ returnTo: '/reports' })
    expect(profileReturnPath({ returnTo: '/reports' })).toBe('/reports')
  })

  it('falls back to the map for direct or invalid profile navigation', () => {
    expect(profileStateFromPath('/map')).toEqual({ returnTo: '/map' })
    expect(profileReturnPath(null)).toBe('/map')
    expect(profileReturnPath({ returnTo: '/private-access' })).toBe('/map')
  })
})
