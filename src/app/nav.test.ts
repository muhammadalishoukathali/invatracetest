import { describe, it, expect } from 'vitest'
import { NAV, isEnabled, visibleNav } from './nav'

describe('navigation gating', () => {
  it('enables only Iteration-1 destinations', () => {
    const enabled = NAV.filter((i) => isEnabled(i, 'Coordinator')).map((i) => i.id)
    expect(enabled).toEqual(['map', 'verify'])
  })

  it('hides the verify queue from non-coordinator roles', () => {
    expect(visibleNav('Detector').map((i) => i.id)).not.toContain('verify')
    expect(visibleNav('Volunteer').map((i) => i.id)).not.toContain('verify')
    expect(visibleNav('Coordinator').map((i) => i.id)).toContain('verify')
    expect(visibleNav('Expert').map((i) => i.id)).toContain('verify')
  })

  it('keeps later-iteration destinations visible for every role', () => {
    for (const role of ['Detector', 'Volunteer', 'Coordinator'] as const) {
      const ids = visibleNav(role).map((i) => i.id)
      expect(ids).toEqual(expect.arrayContaining(['trail', 'sessions', 'impact']))
      expect(NAV.filter((i) => i.iteration > 1).every((i) => !isEnabled(i, role))).toBe(true)
    }
  })
})
