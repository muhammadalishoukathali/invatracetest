import { describe, expect, it } from 'vitest'
import { getGuidanceDecision, saveGuidanceDecision } from './guidance-decision-store'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('guidance decision storage', () => {
  it('restores the cautious choice after the guidance panel is closed', () => {
    const storage = new MemoryStorage()
    saveGuidanceDecision({
      contextId: 'sighting:s-001',
      choice: 'protected_or_unsure',
      plantId: 'mikania-micrantha',
      recordedAt: '2026-09-01T10:00:00.000Z',
    }, storage)

    expect(getGuidanceDecision('sighting:s-001', storage)).toEqual({
      contextId: 'sighting:s-001',
      choice: 'protected_or_unsure',
      plantId: 'mikania-micrantha',
      recordedAt: '2026-09-01T10:00:00.000Z',
    })
  })

  it('keeps decisions separate for each scan or sighting', () => {
    const storage = new MemoryStorage()
    saveGuidanceDecision({ contextId: 'scan:c-001', choice: 'manager_permission', plantId: null }, storage)

    expect(getGuidanceDecision('scan:c-001', storage)?.choice).toBe('manager_permission')
    expect(getGuidanceDecision('scan:c-002', storage)).toBeNull()
  })

  it('ignores damaged browser data', () => {
    const storage = new MemoryStorage()
    storage.setItem('invatrace-guidance-decisions-v1', '{not json')

    expect(getGuidanceDecision('sighting:s-001', storage)).toBeNull()
  })
})
