import { describe, expect, it } from 'vitest'
import { copyText, recoveryKitBlob, recoveryKitFileName, recoveryKitText } from './recovery-kit'

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

  it('falls back to selection-based copy when Clipboard API permission is denied', async () => {
    let fallbackText = ''
    await copyText('private recovery text', {
      writeClipboard: async () => { throw new Error('permission denied') },
      legacyCopy: (text) => { fallbackText = text; return true },
    })
    expect(fallbackText).toBe('private recovery text')
  })

  it('reports an actionable error when neither copy method works', async () => {
    await expect(copyText('private recovery text', {
      writeClipboard: async () => { throw new Error('permission denied') },
      legacyCopy: () => false,
    })).rejects.toThrow('use Download recovery kit')
  })

  it('downloads a named UTF-8 text file with a byte-order marker', async () => {
    const input = {
      profileId: 'IVT-TEST-PROFILE',
      recoveryCodes: ['AAAA-BBBB-CCCC'],
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    }
    const bytes = new Uint8Array(await recoveryKitBlob(input).arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF])
    expect(recoveryKitFileName(input.profileId)).toBe('invatrace-recovery-kit-IVT-TEST-PROFILE.txt')
  })
})
