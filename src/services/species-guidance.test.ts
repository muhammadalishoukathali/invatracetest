import { describe, expect, it } from 'vitest'

import { validateServerGuidance } from './species-guidance'

const VALID_PAYLOAD = {
  actionMode: 'active_guidance',
  guidanceMode: 'active_guidance',
  plantId: 'mikania-micrantha',
  contentVersion: '2025.09.13',
  lastReviewed: '2025-09-01',
  title: 'Mile-a-minute weed',
  summary: '...',
  validMonths: [1, 2, 3],
  steps: [],
  doNotDo: [],
  ppe: [],
  decontamination: [],
  stopConditions: [],
  spreadPrevention: [],
  prohibitedActions: [],
  sources: [],
  revision: 'r1',
}

describe('validateServerGuidance', () => {
  it('accepts a fully populated response', () => {
    const result = validateServerGuidance(VALID_PAYLOAD)
    expect(result).not.toBeNull()
    expect(result?.plantId).toBe('mikania-micrantha')
  })

  it('rejects null / non-object input', () => {
    expect(validateServerGuidance(null)).toBeNull()
    expect(validateServerGuidance(undefined)).toBeNull()
    expect(validateServerGuidance('nope')).toBeNull()
    expect(validateServerGuidance(42)).toBeNull()
  })

  it('rejects unknown guidance modes', () => {
    expect(
      validateServerGuidance({ ...VALID_PAYLOAD, guidanceMode: 'freestyle_removal' }),
    ).toBeNull()
  })

  it('rejects when required identifiers are missing', () => {
    expect(validateServerGuidance({ ...VALID_PAYLOAD, plantId: '' })).toBeNull()
    expect(validateServerGuidance({ ...VALID_PAYLOAD, contentVersion: '' })).toBeNull()
    expect(validateServerGuidance({ ...VALID_PAYLOAD, revision: '' })).toBeNull()
  })

  it('rejects when required array fields are not arrays', () => {
    expect(
      validateServerGuidance({ ...VALID_PAYLOAD, spreadPrevention: 'not-an-array' }),
    ).toBeNull()
    expect(
      validateServerGuidance({ ...VALID_PAYLOAD, stopConditions: null }),
    ).toBeNull()
    expect(
      validateServerGuidance({ ...VALID_PAYLOAD, prohibitedActions: {} }),
    ).toBeNull()
  })
})
