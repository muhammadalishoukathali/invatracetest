interface RecoveryKitInput {
  profileId: string
  recoveryCodes: string[]
  createdAt: Date
}

export function recoveryKitText({ profileId, recoveryCodes, createdAt }: RecoveryKitInput): string {
  return [
    'InvaTrace private access recovery kit',
    '',
    `Public profile ID: ${profileId}`,
    `Created: ${createdAt.toISOString()}`,
    '',
    'Recovery codes (secret):',
    ...recoveryCodes.map((code, index) => `${String(index + 1).padStart(2, '0')}. ${code}`),
    '',
    'Each recovery code works only once. Keep this file private.',
    'To use this profile on another device, open InvaTrace, choose “Restore existing access”,',
    'then enter the public profile ID and one unused recovery code.',
    '',
    'Losing every active installation and every unused recovery code makes this profile unrecoverable.',
    '',
  ].join('\n')
}

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is unavailable in this browser.')
  }
  await navigator.clipboard.writeText(text)
}

export function downloadRecoveryKit(input: RecoveryKitInput): void {
  const blob = new Blob([recoveryKitText(input)], { type: 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = `invatrace-recovery-${input.profileId}.txt`
  link.rel = 'noopener'
  link.click()
  URL.revokeObjectURL(href)
}
