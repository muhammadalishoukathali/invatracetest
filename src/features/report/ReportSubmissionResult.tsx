import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReportDraft } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import { AdoptAreaPrompt } from '@/features/areas/AdoptAreaPrompt'
import { api } from '@/services/api-client'
import type { Report, SightingDetail } from '@/types'
import './report-submission-result.css'

/**
 * This is the last screen of the wizard, it only shows up once
 * ReportPreviewStep.tsx has set an outcome - either "submitted" (it made it
 * to the server and is now being screened) or "queued" (it got saved
 * offline and report-queue.ts will retry it later). We didn't add it to
 * REPORT_STEPS because it's not really a form step, it's just the exit.
 */
export function ReportSubmissionResult() {
  const navigate = useNavigate()
  const { outcome, reset } = useReportDraft()

  const done = (destination: string) => {
    // If the server hands us a full URL instead of an internal path, we
    // can't just pass it to react-router - it'll try to treat it as an SPA
    // route and 404. So we open it in a new tab instead and stay on this
    // page, still running the reset below either way.
    if (/^https?:\/\//i.test(destination)) {
      window.open(destination, '_blank', 'noopener,noreferrer')
    } else {
      navigate(destination, { replace: true })
    }
    window.setTimeout(() => {
      reset()
      useScan.getState().reset()
    }, 150)
  }

  // A fresh submission always comes back as `processing` first, so we poll
  // the report until it moves to `screened` (published) - that way this
  // screen can honestly switch from "submitted" to "Report published"
  // instead of just assuming it worked. `rejected` and `needs_rescan` get
  // their own honest states below rather than us pretending it published.
  const initialReport = outcome?.kind === 'submitted' ? outcome.report : null
  const [status, setStatus] = useState<Report['status'] | null>(initialReport?.status ?? null)
  const [sightingId, setSightingId] = useState<string | null>(initialReport?.sightingId ?? null)
  const [adoptable, setAdoptable] = useState<{ areaId: string; areaName: string | null } | null>(null)
  const [retainedReportId, setRetainedReportId] = useState<string | null>(
    initialReport?.retainedReportId ?? null,
  )
  const reportId = initialReport?.id ?? null
  useEffect(() => {
    if (!reportId) return
    if (status && status !== 'processing') return
    let cancelled = false
    const poll = async () => {
      try {
        const latest = await api<Report>(`/api/v1/reports/${reportId}`)
        if (cancelled) return
        setStatus(latest.status)
        setSightingId(latest.sightingId ?? null)
        setRetainedReportId(latest.retainedReportId ?? null)
        // AC 6.1.2 - once we know the published sighting id, look up its
        // area so the "Adopt this area" prompt can surface without a
        // second poll cycle. Failure is silent: the prompt just doesn't
        // render, which is preferable to blocking the result screen.
        if (latest.sightingId && !adoptable) {
          try {
            const detail = await api<SightingDetail>(`/api/v1/sightings/${latest.sightingId}`)
            if (!cancelled && detail.place.areaId) {
              setAdoptable({
                areaId: detail.place.areaId,
                areaName: detail.place.areaName,
              })
            }
          } catch {
            /* prompt stays hidden - never claim a place we can't confirm */
          }
        }
      } catch {
        // If this one poll fails we just leave the "still checking" wording
        // up rather than showing an error - the next interval tick retries.
      }
    }
    void poll()
    const handle = window.setInterval(poll, 2000)
    return () => { cancelled = true; window.clearInterval(handle) }
  }, [reportId, status, adoptable])

  if (!outcome) return null

  const submitted = outcome.kind === 'submitted'
  const trackingDestination = submitted && outcome.kind === 'submitted'
    ? (typeof outcome.report.trackingUrl === 'string' && outcome.report.trackingUrl.length > 0
      ? outcome.report.trackingUrl
      : `/reports/${outcome.report.id}`)
    : null

  if (submitted && status === 'screened') {
    return (
      <main className="report-submission-result">
        <section className="report-submission-result__body" aria-live="polite">
          <h1>Report published</h1>
          <p>Community report - not expert validated</p>
          {adoptable && (
            <AdoptAreaPrompt areaId={adoptable.areaId} areaName={adoptable.areaName} />
          )}
          <div className="report-submission-result__actions">
            <button type="button" onClick={() => done(sightingId ? `/map?sighting=${sightingId}` : '/map')}>
              View on map
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (submitted && status === 'merged') {
    // This handles the case where the new evidence got merged into an
    // existing sighting instead of creating a fresh one. We try to link
    // straight to that existing sighting on the map first, falling back to
    // the retained report if there's no sightingId yet. We deliberately
    // don't show the "published" wording here since merging doesn't put a
    // new marker on the map.
    const retainedTrackingDestination = retainedReportId ? `/reports/${retainedReportId}` : null
    return (
      <main className="report-submission-result">
        <section className="report-submission-result__body" aria-live="polite">
          <h1>Added to a recent nearby report</h1>
          <p>
            A recent report of the same species was already logged nearby, so this
            evidence was merged with that existing sighting instead of creating a
            new marker.
          </p>
          <p>Community report - not expert validated</p>
          <div className="report-submission-result__actions">
            {sightingId && (
              <button type="button" onClick={() => done(`/map?sighting=${sightingId}`)}>
                View existing sighting
              </button>
            )}
            {retainedTrackingDestination && (
              <button
                type="button"
                className="report-submission-result__secondary"
                onClick={() => done(retainedTrackingDestination)}
              >
                View report
              </button>
            )}
            {!sightingId && !retainedTrackingDestination && (
              <button type="button" onClick={() => done('/map')}>
                Back to map
              </button>
            )}
          </div>
        </section>
      </main>
    )
  }

  if (submitted && status === 'needs_rescan') {
    return (
      <main className="report-submission-result">
        <section className="report-submission-result__body" aria-live="polite">
          <h1>A new scan is needed</h1>
          <p>Automated screening could not accept this evidence. Capture a fresh photo and try again.</p>
          <div className="report-submission-result__actions">
            <button type="button" onClick={() => done('/scan')}>Scan again</button>
          </div>
        </section>
      </main>
    )
  }

  if (submitted && status === 'rejected') {
    return (
      <main className="report-submission-result">
        <section className="report-submission-result__body" aria-live="polite">
          <h1>Report not published</h1>
          <p>Automated duplicate or safety checks rejected this evidence.</p>
          <div className="report-submission-result__actions">
            {trackingDestination && (
              <button type="button" onClick={() => done(trackingDestination)}>View report</button>
            )}
            <button type="button" className="report-submission-result__secondary" onClick={() => done('/map')}>Back to map</button>
          </div>
        </section>
      </main>
    )
  }

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
          {trackingDestination && (
            <button type="button" onClick={() => done(trackingDestination)}>
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
