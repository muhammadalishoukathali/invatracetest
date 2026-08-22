import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useReport, REPORT_STEPS } from '@/lib/report-store'
import { Location } from './Location'
import { Extent } from './Extent'
import { Consent } from './Consent'
import { Preview } from './Preview'
import { Submitted } from './Submitted'

const STEP_LABEL: Record<string, string> = {
  location: 'Location',
  extent: 'Extent',
  consent: 'Consent',
  preview: 'Preview',
}

export function ReportLayout() {
  const navigate = useNavigate()
  const { step, draft, outcome, back, reset } = useReport()

  useEffect(() => {
    if (!draft && !outcome) navigate('/scan', { replace: true })
  }, [draft, outcome, navigate])

  if (!draft && !outcome) return null

  if (outcome) return <Submitted />

  const stepIndex = REPORT_STEPS.indexOf(step)
  const isFirst = stepIndex === 0

  const handleBack = () => {
    if (isFirst) {
      reset()
      navigate('/scan/result')
    } else {
      back()
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <button type="button" onClick={handleBack} aria-label="Back" style={{
          width: 40, height: 40, borderRadius: '50%', border: 'none',
          background: 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="ChevronLeft" size={22} color="var(--ink)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Report a sighting</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Step {stepIndex + 1} of {REPORT_STEPS.length} · {STEP_LABEL[step]}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', background: 'var(--surface)' }}>
        {REPORT_STEPS.map((s, i) => (
          <div key={s} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= stepIndex ? 'var(--green)' : 'var(--border)',
            transition: 'background 0.2s ease',
          }} />
        ))}
      </div>

      <main style={{ flex: 1, overflowY: 'auto' }}>
        {step === 'location' && <Location />}
        {step === 'extent' && <Extent />}
        {step === 'consent' && <Consent />}
        {step === 'preview' && <Preview />}
      </main>
    </div>
  )
}
