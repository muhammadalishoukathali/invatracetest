import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import '../private-access.css'

// These controls keep buttons, fields, notices, and recovery codes consistent
// across every private-access screen. The field also connects hint and error
// text to its input so screen readers announce the same help as visual users.

export function PrivateAccessButton({
  kind = 'primary',
  icon,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'quiet' | 'danger'
  icon?: string
}) {
  return (
    <button {...props} className={`access-button access-button--${kind} ${className}`.trim()}>
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  )
}

export function PrivateAccessLink({ href, children, icon }: { href: string; children: ReactNode; icon?: string }) {
  // Route via React Router so the app shell isn't torn down on internal hops
  // (external URLs fall back to a native anchor).
  const isInternal = href.startsWith('/')
  if (isInternal) {
    return (
      <Link className="access-link-button" to={href}>
        {icon && <Icon name={icon} size={18} />}
        <span>{children}</span>
      </Link>
    )
  }
  return (
    <a className="access-link-button" href={href}>
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </a>
  )
}

export function PrivateAccessField({
  label,
  hint,
  error,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string | null
  id: string
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="access-field">
      <label htmlFor={id}>{label}</label>
      {hint && <p id={hintId} className="access-field__hint">{hint}</p>}
      <input
        {...props}
        id={id}
        className="access-field__input"
        aria-invalid={!!error}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      />
      {error && <p id={errorId} className="access-field__error">{error}</p>}
    </div>
  )
}

export function PrivateAccessNotice({
  tone,
  title,
  children,
  live = false,
}: {
  tone: 'info' | 'warning' | 'error' | 'success'
  title: string
  children: ReactNode
  live?: boolean
}) {
  const icon = tone === 'error' ? 'XOctagon'
    : tone === 'warning' ? 'AlertTriangle'
      : tone === 'success' ? 'CircleCheck' : 'Info'
  return (
    <div
      className={`access-notice access-notice--${tone}`}
      role={tone === 'error' ? 'alert' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <Icon name={icon} size={20} />
      <div><strong>{title}</strong><p>{children}</p></div>
    </div>
  )
}

export function RecoveryCodeGrid({ codes }: { codes: string[] }) {
  return (
    <ol className="recovery-code-grid" aria-label="One-time recovery codes">
      {codes.map((code, index) => (
        <li key={index}>
          <span aria-hidden>{String(index + 1).padStart(2, '0')}</span>
          <code>{code}</code>
        </li>
      ))}
    </ol>
  )
}
