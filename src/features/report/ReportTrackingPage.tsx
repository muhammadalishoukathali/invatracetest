import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/services/api-client'
import type { Report, ReportStatus } from '@/types'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import './report-tracking.css'

const COPY: Record<ReportStatus, { title: string; body: string }> = {
  processing: {
    title: 'Screening in progress',
    body: 'This report remains private while its photo, location and submission details are checked.',
  },
  screened: {
    title: 'Report published',
    body: 'Community report - not expert validated. This report is now visible on the shared map.',
  },
  merged: {
    title: 'Added to an existing sighting',
    body: 'A recent report of the same species was found nearby, so this evidence was added to that sighting.',
  },
  needs_rescan: {
    title: 'A new scan is needed',
    body: 'The current photo or location could not be checked. Retake the scan at the plant.',
  },
  rejected: {
    title: 'Report not accepted',
    body: 'This evidence matches a report that was already submitted.',
  },
  validation_unavailable: {
    title: 'Screening unavailable',
    body: 'This report remains private until screening is available again.',
  },
}

export function ReportTrackingPage() {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const goBack = () => {
    // History depth is unreliable when opened from a notification, so fall back
    // to the records index whenever we cannot pop within the app.
    if (window.history.length > 1) navigate(-1)
    else navigate('/reports')
  }
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  const query = useQuery({
    queryKey: ['report', profileId, reportId],
    queryFn: () => api<Report>(`/api/v1/reports/${reportId}`),
    enabled: !!profileId && !!reportId,
    refetchInterval: (state) => (
      state.state.data?.status === 'processing'
        || (state.state.data?.status === 'validation_unavailable'
          && state.state.data.validation.retryable)
        ? 3_000
        : false
    ),
  })

  if (query.isLoading) {
    return (
      <section className="report-tracking" aria-label="Report status">
        <article className="report-tracking__content report-tracking__content--loading" role="status">
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--short invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--title invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--medium invatrace-skeleton" aria-hidden />
          <span className="sr-only">Loading report status…</span>
        </article>
      </section>
    )
  }

  if (query.isError || !query.data) {
    return (
      <section className="report-tracking" aria-label="Report status">
        <article className="report-tracking__content" role="alert">
          <h1>Report unavailable</h1>
          <p>We could not load this report. Check the connection and try again.</p>
          <div className="report-tracking__actions">
            <button type="button" onClick={() => void query.refetch()}>Try again</button>
            <Link to="/reports" className="report-tracking__secondary">Back to my records</Link>
          </div>
        </article>
      </section>
    )
  }

  const report = query.data
  const copy = COPY[report.status]
  const usefulReasons = report.validation.reasonCodes.filter((reason) => reason !== 'automated_rule_screened')

  return (
    <section className={`report-tracking report-tracking--${report.status}`} aria-label="Report status">
      <article className="report-tracking__content" aria-live="polite">
        <button type="button" onClick={goBack} className="report-tracking__back">
          &larr; Back
        </button>
        <p className="report-tracking__reference">Report {report.id.slice(0, 8)}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>

        <dl className="report-tracking__meta">
          <div>
            <dt>Reported location</dt>
            <dd className="report-tracking__coordinates">
              {report.submission.location.lat.toFixed(5)}, {report.submission.location.lng.toFixed(5)}
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatSubmittedAt(report.createdAt)}</dd>
          </div>
        </dl>

        {usefulReasons.length > 0 && (
          <section className="report-tracking__reasons" aria-labelledby="report-reasons-heading">
            <h2 id="report-reasons-heading">Details</h2>
            {usefulReasons.map((reason) => <p key={reason}>{humanize(reason)}</p>)}
          </section>
        )}

        <div className="report-tracking__actions">
          {report.status === 'needs_rescan' && <Link to="/scan" state={{ returnTo: '/reports' }}>Retake scan</Link>}
          {report.sightingId && (
            <Link to={`/map?sighting=${encodeURIComponent(report.sightingId)}`}>View shared map</Link>
          )}
          <Link to="/reports" className="report-tracking__secondary">Back to my records</Link>
        </div>
      </article>
    </section>
  )
}

const REASON_COPY: Record<string, string> = {
  exact_photo_replay: 'This photo was already submitted.',
  perceptual_photo_replay: 'This photo is very similar to an earlier report of the same species.',
  same_species_nearby_recent: 'The same species was reported nearby recently.',
  image_too_small: 'The photo is too small to check.',
  image_too_dark: 'The photo is too dark.',
  image_too_bright: 'The photo is too bright.',
  image_low_contrast: 'The plant is difficult to distinguish from the background.',
  image_too_blurry: 'The photo is too blurry.',
  invalid_or_corrupt_image: 'The photo could not be read.',
  location_accuracy_insufficient: 'Location accuracy must be within 100 metres.',
  plant_identification_not_reportable: 'This species is not currently reportable.',
  unsupported_client_model_version: 'Update the app before submitting this report.',
}

const humanize = (reason: string) => REASON_COPY[reason]
  ?? `${reason.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())}.`

const formatSubmittedAt = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))
