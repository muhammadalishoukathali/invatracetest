import { describe, expect, it } from 'vitest'
import { scanReturnPath, scanStateFromPath } from './scan-navigation'

describe('scan navigation', () => {
  it('returns to records when the scan starts from records', () => {
    expect(scanStateFromPath('/reports')).toEqual({ returnTo: '/reports' })
    expect(scanStateFromPath('/reports/record-1')).toEqual({ returnTo: '/reports' })
    expect(scanReturnPath({ returnTo: '/reports' })).toBe('/reports')
  })

  it('returns to profile when the scan starts from profile', () => {
    expect(scanStateFromPath('/profile')).toEqual({ returnTo: '/profile' })
    expect(scanReturnPath({ returnTo: '/profile' })).toBe('/profile')
  })

  it('falls back to the map for unknown or malformed state', () => {
    expect(scanStateFromPath('/map')).toEqual({ returnTo: '/map' })
    expect(scanReturnPath(null)).toBe('/map')
    expect(scanReturnPath({ returnTo: '/private-access' })).toBe('/map')
  })
})
