/** Prevent contact details from appearing in profile labels. */
export function safeDisplayName(value?: string | null): string {
  if (!value || looksLikeContactDetail(value)) return 'Local reporter'
  return value
}

/** Return true when a display name resembles an email address or phone number. */
export function looksLikeContactDetail(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/\S+@\S+\.\S+/.test(trimmed)) return true
  const digits = trimmed.replace(/[\s()+\-.]/g, '')
  return /^\d{7,}$/.test(digits)
}
