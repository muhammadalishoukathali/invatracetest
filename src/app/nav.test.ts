import { describe, it, expect } from 'vitest'
import { NAV, isEnabled, visibleNav } from './nav'

describe('navigation gating', () => {
  it('enables only destinations available in the current release', () => {
    const enabled = NAV.filter((i) => isEnabled(i, 'Volunteer')).map((i) => i.id)
    expect(enabled).toEqual(['map'])
  })

  it('keeps later-iteration destinations visible for every role', () => {
    for (const role of ['Detector', 'Volunteer'] as const) {
      const ids = visibleNav(role).map((i) => i.id)
      expect(ids).toEqual(expect.arrayContaining(['trail', 'sessions', 'impact']))
      expect(NAV.filter((i) => i.iteration > 1).every((i) => !isEnabled(i, role))).toBe(true)
    }
  })
})
