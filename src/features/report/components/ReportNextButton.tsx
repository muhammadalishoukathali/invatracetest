import { Icon } from '@/components/Icon'

interface Props {
  disabled?: boolean
  onClick: () => void
  label: string
  loading?: boolean
  variant?: 'primary' | 'submit'
}

/**
 * Shared primary CTA button used across every step of the report wizard
 * (ReportLocationStep.tsx, ReportExtentStep.tsx, ReportConsentStep.tsx,
 * ReportPreviewStep.tsx). "submit" variant swaps the chevron for a send
 * icon and shows a spinner while the final submission is in flight.
 */
export function ReportNextButton({ disabled, onClick, label, loading, variant = 'primary' }: Props) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      aria-busy={loading || undefined} style={{
      marginTop: 4, width: '100%', height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
      border: 'none', background: 'var(--green)', color: '#fff',
      fontWeight: 600, fontSize: 15, cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      {loading ? (
        <><Spinner /><span>{label}…</span></>
      ) : (
        <>
          {variant === 'submit' && <Icon name="Send" size={16} color="#fff" />}
          {label}
          {variant === 'primary' && <Icon name="ChevronRight" size={18} color="#fff" />}
        </>
      )}
    </button>
  )
}

function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" fill="none" />
      <path d="M9 2a7 7 0 0 1 7 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
