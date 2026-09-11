import { describe, it, expect } from 'vitest'
import {
  accuracyExceedsThreshold,
  formatAccuracyMessage,
  LOCATION_ACCURACY_INSUFFICIENT_MESSAGE,
} from './gps-policy'

// AC 7.3.1 - the client must not carry a hardcoded copy of the server's
// accuracy limit. The helpers below take the threshold as an argument so
// the caller can inject whatever `/api/v1/config/limits` currently reports;
// these tests pin that contract.

describe('accuracyExceedsThreshold', () => {
  it('returns true when the reported accuracy is above the threshold', () => {
    expect(accuracyExceedsThreshold(300, 250)).toBe(true)
  })

  it('returns false when the reported accuracy is at or below the threshold', () => {
    expect(accuracyExceedsThreshold(250, 250)).toBe(false)
    expect(accuracyExceedsThreshold(50, 250)).toBe(false)
  })

  it('treats null / non-finite accuracy as not exceeding', () => {
    expect(accuracyExceedsThreshold(null, 250)).toBe(false)
    expect(accuracyExceedsThreshold(undefined, 250)).toBe(false)
    expect(accuracyExceedsThreshold(Number.NaN, 250)).toBe(false)
    expect(accuracyExceedsThreshold(Number.POSITIVE_INFINITY, 250)).toBe(false)
  })

  it('honours whatever threshold the caller passes rather than a hardcoded number', () => {
    expect(accuracyExceedsThreshold(120, 100)).toBe(true)
    expect(accuracyExceedsThreshold(120, 500)).toBe(false)
  })
})

describe('formatAccuracyMessage', () => {
  it('interpolates the threshold the caller supplies', () => {
    expect(formatAccuracyMessage(400, 250)).toContain('above 250 m')
    expect(formatAccuracyMessage(400, 500)).toContain('above 500 m')
  })

  it('appends the reported accuracy when finite', () => {
    expect(formatAccuracyMessage(400.4, 250)).toContain('about 400 m')
  })

  it('omits the reported accuracy suffix when accuracy is missing', () => {
    const msg = formatAccuracyMessage(null, 250)
    expect(msg).toContain('above 250 m')
    expect(msg).not.toContain('about')
  })
})

describe('LOCATION_ACCURACY_INSUFFICIENT_MESSAGE', () => {
  it('does not embed a literal metre threshold', () => {
    // AC 7.3.1: the client must not carry a hardcoded copy of the server
    // limit. The reason-code copy stays threshold-free; the numeric value
    // is shown once, in the live warning that reads from useLimits().
    expect(LOCATION_ACCURACY_INSUFFICIENT_MESSAGE).not.toMatch(/\d+\s*m/)
  })
})
