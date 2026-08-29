import { describe, it, expect } from 'vitest'
import { NAV, isEnabled, visibleNav } from './nav'

describe('navigation gating', () => {
  it('enables only destinations available in the current release', () => {
    const enabled = NAV.filter((i) => isEnabled(i, 'Coordinator')).map((i) => i.id)
    expect(enabled).toEqual(['map'])
  })

  it('does not expose a manual verification destination to any role', () => {
    for (const role of ['Detector', 'Volunteer', 'Coordinator', 'Expert', 'Admin'] as const) {
      expect(visibleNav(role).map((i) => i.id)).not.toContain('verify')
    }
  })

  it('keeps later-iteration destinations visible for every role', () => {
    for (const role of ['Detector', 'Volunteer', 'Coordinator'] as const) {
      const ids = visibleNav(role).map((i) => i.id)
      expect(ids).toEqual(expect.arrayContaining(['trail', 'sessions', 'impact']))
      expect(NAV.filter((i) => i.iteration > 1).every((i) => !isEnabled(i, role))).toBe(true)
    }
  })
})
