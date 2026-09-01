import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useReportDraft, REPORT_STEPS } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import { ReportLocationStep } from './ReportLocationStep'
import { ReportExtentStep } from './ReportExtentStep'
import { ReportConsentStep } from './ReportConsentStep'
import { ReportPreviewStep } from './ReportPreviewStep'
import { ReportSubmissionResult } from './ReportSubmissionResult'

const STEP_LABEL: Record<string, string> = {
  location: 'Location',
  extent: 'Extent',
  consent: 'Consent',
  preview: 'Preview',
}

export function ReportWizardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { step, draft, outcome, back, reset } = useReportDraft()

  useEffect(() => {
    if (!draft && !outcome) navigate('/scan', { replace: true, state: location.state })
  }, [draft, outcome, location.state, navigate])

  if (!draft && !outcome) return null

  if (outcome) return <ReportSubmissionResult />

  const stepIndex = REPORT_STEPS.indexOf(step)
  const isFirst = stepIndex === 0

  const handleBack = () => {
    if (isFirst) {
      // Only return to the result page if the scan is still in memory; otherwise
      // /scan/result immediately redirects to /scan and the user lands on a
      // blank camera. Fall back to the map so back always goes somewhere useful.
      const hasScan = !!useScan.getState().result
      reset()
      navigate(hasScan ? '/scan/result' : '/map', { state: location.state })
    } else {
      back()
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px',
        paddingTop: 'calc(12px + env(safe-area-inset-top))',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <button type="button" onClick={handleBack} aria-label="Back" style={{
          width: 44, height: 44, borderRadius: '50%', border: 'none',
          background: 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="ChevronLeft" size={22} color="var(--ink)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Report a sighting</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Step {stepIndex + 1} of {REPORT_STEPS.length} · {STEP_LABEL[step]}
          </div>
        </div>
      </header>

      <div role="progressbar" aria-label={`Report progress: step ${stepIndex + 1} of ${REPORT_STEPS.length}`}
        aria-valuemin={1} aria-valuemax={REPORT_STEPS.length} aria-valuenow={stepIndex + 1}
        style={{ display: 'flex', gap: 4, padding: '8px 16px', background: 'var(--surface)' }}>
        {REPORT_STEPS.map((s, i) => (
          <div key={s} aria-hidden style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= stepIndex ? 'var(--green)' : 'var(--border)',
            transition: 'background 0.2s ease',
          }} />
        ))}
      </div>

      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {step === 'location' && <ReportLocationStep />}
        {step === 'extent' && <ReportExtentStep />}
        {step === 'consent' && <ReportConsentStep />}
        {step === 'preview' && <ReportPreviewStep />}
      </main>
    </div>
  )
}
