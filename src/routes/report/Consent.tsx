import { Icon } from '@/components/Icon'
import { useReport } from '@/lib/report-store'
import { NextButton } from './parts/NextButton'

export function Consent() {
  const { draft, setConsent, next } = useReport()
  if (!draft) return null

  const canProceed = draft.consentAccurate && draft.consentNoPII

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        display: 'flex', gap: 12, padding: '14px 16px',
        background: 'var(--green-light)', border: '1px solid var(--green-border)',
        borderRadius: 'var(--r-card)',
      }}>
        <Icon name="Info" size={20} color="var(--green)" />
        <p style={{ fontSize: 13, color: 'var(--green-dark)', lineHeight: 1.55 }}>
          Please confirm your submission before it enters the verification queue.
          Your photo, coordinates and notes will be visible to coordinators and experts.
        </p>
      </div>

      <CheckRow
        checked={draft.consentAccurate}
        onToggle={(v) => setConsent({ consentAccurate: v })}
        title="This report is accurate to the best of my knowledge"
        body="The plant, location and extent shown here match what I saw on the ground."
      />

      <CheckRow
        checked={draft.consentNoPII}
        onToggle={(v) => setConsent({ consentNoPII: v })}
        title="My photo does not contain personal information"
        body="No identifiable faces, licence plates, addresses or private-property signage."
      />

      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 4 }}>
        Coordinates are stored at up to 5-decimal precision (~1 m). Reports use a pseudonymous installation profile.
      </p>

      <NextButton disabled={!canProceed} onClick={next} label="Review submission" />
    </div>
  )
}

function CheckRow({ checked, onToggle, title, body }: {
  checked: boolean
  onToggle: (v: boolean) => void
  title: string
  body: string
}) {
  return (
    <label style={{
      display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
      padding: '14px 16px', borderRadius: 'var(--r-card)',
      background: 'var(--surface)',
      border: `1px solid ${checked ? 'var(--green)' : 'var(--border)'}`,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        style={{
          width: 20, height: 20, marginTop: 2, accentColor: 'var(--green)',
          cursor: 'pointer', flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{body}</div>
      </div>
    </label>
  )
}
