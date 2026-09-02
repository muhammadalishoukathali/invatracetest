import { describe, expect, it } from 'vitest'
import { looksLikeContactDetail, safeDisplayName } from './display-name'

describe('looksLikeContactDetail', () => {
  it.each([
    'test@example.com',
    'muhammadalishoukathali@gmail.com',
    'first.last+tag@sub.domain.co',
  ])('flags email-shaped input: %s', (input) => {
    expect(looksLikeContactDetail(input)).toBe(true)
  })

  it.each([
    '+60 12-345 6789',
    '0123456789',
    '+1 (415) 555 2671',
  ])('flags phone-shaped input: %s', (input) => {
    expect(looksLikeContactDetail(input)).toBe(true)
  })

  it.each([
    '',
    'Ali',
    'Bukit Kiara Crew',
    'PJ Volunteer',
    'A.',
    '1 star',
  ])('allows normal names: %s', (input) => {
    expect(looksLikeContactDetail(input)).toBe(false)
  })
})

describe('safeDisplayName', () => {
  it('returns the default label for empty values', () => {
    expect(safeDisplayName(undefined)).toBe('Local reporter')
    expect(safeDisplayName(null)).toBe('Local reporter')
    expect(safeDisplayName('')).toBe('Local reporter')
  })

  it('masks stored values that look like contact details', () => {
    expect(safeDisplayName('leak@example.com')).toBe('Local reporter')
    expect(safeDisplayName('+60 12-345 6789')).toBe('Local reporter')
  })

  it('preserves normal nicknames', () => {
    expect(safeDisplayName('Ali')).toBe('Ali')
    expect(safeDisplayName('Bukit Kiara Crew')).toBe('Bukit Kiara Crew')
  })
})
