// Formats and downloads the recovery kit (profile ID + one-time codes) as a
// local text file. This is all client-side string/Blob work — no network
// calls here. Recovery codes are shown to the user only once, during setup
// or rotation (see docs/product.md), and the client never persists the raw
// codes anywhere. That's why there's no "load saved recovery kit" function
// in this file — once the codes leave memory (tab closed, page navigated
// away without downloading) they're gone from the client for good, same as
// they are on the server after they're consumed.

interface RecoveryKitInput {
  profileId: string
  recoveryCodes: string[]
  createdAt: Date
}

export interface CopyTextDependencies {
  writeClipboard?: (text: string) => Promise<void>
  legacyCopy?: (text: string) => boolean
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

function browserCopyDependencies(): CopyTextDependencies {
  return {
    writeClipboard: typeof navigator !== 'undefined' && navigator.clipboard?.writeText
      ? (text) => navigator.clipboard.writeText(text)
      : undefined,
    legacyCopy: legacyCopyText,
  }
}

function legacyCopyText(text: string): boolean {
  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.cssText = 'position:fixed;inset:0 auto auto:-9999px;opacity:0;pointer-events:none;'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

export async function copyText(text: string, dependencies: CopyTextDependencies = browserCopyDependencies()): Promise<void> {
  if (dependencies.writeClipboard) {
    try {
      await dependencies.writeClipboard(text)
      return
    } catch {
      // Clipboard permission can be denied even after a user click. The
      // selection-based fallback still works in browsers that allow it.
    }
  }

  if (dependencies.legacyCopy?.(text)) return
  throw new Error('Copy failed. Select the recovery information and copy it manually, or use Download recovery kit.')
}

export function recoveryKitFileName(profileId: string): string {
  return `invatrace-recovery-kit-${profileId}.txt`
}

export function recoveryKitBlob(input: RecoveryKitInput): Blob {
  // A UTF-8 BOM keeps the plain-text file readable in older Windows editors.
  return new Blob(['\uFEFF', recoveryKitText(input)], { type: 'text/plain;charset=utf-8' })
}

export function downloadRecoveryKit(input: RecoveryKitInput): string {
  const blob = recoveryKitBlob(input)
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = recoveryKitFileName(input.profileId)
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Delay the revoke by a tick so the browser has actually started the
  // download before we free the object URL out from under it.
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
  return link.download
}
