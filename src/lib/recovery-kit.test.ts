import { describe, expect, it } from 'vitest'
import { recoveryKitText } from './recovery-kit'

describe('recovery kit', () => {
  it('contains the public identifier, all codes, date, and one-time warning as UTF-8 text', () => {
    const text = recoveryKitText({
      profileId: 'IVT-TEST-PROFILE',
      recoveryCodes: ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'],
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    })
    expect(text).toContain('InvaTrace private access recovery kit')
    expect(text).toContain('Public profile ID: IVT-TEST-PROFILE')
    expect(text).toContain('2026-08-28T10:00:00.000Z')
    expect(text).toContain('01. AAAA-BBBB-CCCC')
    expect(text).toContain('02. DDDD-EEEE-FFFF')
    expect(text).toContain('Each recovery code works only once')
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(text.length)
  })
})
