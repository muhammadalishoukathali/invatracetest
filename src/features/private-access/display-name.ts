// Single job: stop people from accidentally deanonymizing themselves by
// typing an email or phone number into the optional display-name field.
// Profiles are meant to be pseudonymous (see docs/product.md Identity Model),
// so we do a best-effort client-side check rather than trust the field blindly.

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
