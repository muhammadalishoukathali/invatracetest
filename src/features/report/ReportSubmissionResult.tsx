import { useNavigate } from 'react-router-dom'
import { useReportDraft } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import './report-submission-result.css'

export function ReportSubmissionResult() {
  const navigate = useNavigate()
  const { outcome, reset } = useReportDraft()

  const done = (destination: string) => {
    navigate(destination, { replace: true })
    window.setTimeout(() => {
      reset()
      useScan.getState().reset()
    }, 150)
  }

  if (!outcome) return null

  const submitted = outcome.kind === 'submitted'

  return (
    <main className="report-submission-result">
      <section className="report-submission-result__body" aria-live="polite">
        <h1>{submitted ? 'Report submitted' : 'Saved for later'}</h1>

        {submitted ? (
          <p>
            We’re checking the photo, location and submission details. You can follow the report’s status from My records.
          </p>
        ) : (
          <p>The report is stored on this device and will retry when a connection is available.</p>
        )}

        <div className="report-submission-result__actions">
          {submitted && outcome.kind === 'submitted' && (
            <button type="button" onClick={() => done(outcome.report.trackingUrl)}>
              View report
            </button>
          )}
          <button type="button" className="report-submission-result__secondary" onClick={() => done('/map')}>
            Back to map
          </button>
        </div>
      </section>
    </main>
  )
}
