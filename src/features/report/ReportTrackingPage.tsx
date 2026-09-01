import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import type { Report, ReportStatus } from '@/types'
import './report-tracking.css'

const COPY: Record<ReportStatus, { icon: string; title: string; body: string }> = {
  processing: {
    icon: 'LoaderCircle',
    title: 'Automated rule screening is running',
    body: 'The report stays private while the server checks image quality, duplicates, location, and submission patterns.',
  },
  screened: {
    icon: 'CircleCheck',
    title: 'Report published',
    body: 'Community report — not expert validated. The Iteration 1 rules passed, so this observation now appears on the shared map.',
  },
  merged: {
    icon: 'GitMerge',
    title: 'Matched an existing plant',
    body: 'The same species was reported nearby within the screening time window, so your evidence was added to that map sighting.',
  },
  needs_rescan: {
    icon: 'ScanLine',
    title: 'A fresh scan is needed',
    body: 'One or more screening rules need a better image or location. Use the in-app camera again at the plant.',
  },
  rejected: {
    icon: 'XOctagon',
    title: 'Duplicate evidence rejected',
    body: 'The image or capture identifier matched evidence that was already submitted.',
  },
  validation_unavailable: {
    icon: 'WifiOff',
    title: 'Screening is temporarily unavailable',
    body: 'The report remains private until the required screening services recover.',
  },
}

export function ReportTrackingPage() {
  const { reportId } = useParams()
  const query = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => api<Report>(`/api/v1/reports/${reportId}`),
    enabled: !!reportId,
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
        <section className="report-tracking__card report-tracking__card--loading" role="status" aria-label="Loading report status">
          <span className="report-tracking__skeleton-icon invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--short invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--title invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--medium invatrace-skeleton" aria-hidden />
          <span className="sr-only">Loading report status…</span>
        </section>
      </section>
    )
  }
  if (query.isError || !query.data) {
    return (
      <section className="report-tracking" aria-label="Report status">
        <section className="report-tracking__card report-tracking__card--error" role="alert">
          <span className="report-tracking__icon" aria-hidden>
            <Icon name="WifiOff" size={32} color="currentColor" />
          </span>
          <h1>Report unavailable</h1>
          <p>We could not load this report. Check the connection and try again.</p>
          <div className="report-tracking__actions">
            <button type="button" onClick={() => void query.refetch()}>Try again</button>
            <Link to="/map" className="report-tracking__secondary">Back to map</Link>
          </div>
        </section>
      </section>
    )
  }

  const report = query.data
  const copy = COPY[report.status]
  return (
    <section className={`report-tracking report-tracking--${report.status}`} aria-label="Report status">
      <section className="report-tracking__card" aria-live="polite">
        <span className="report-tracking__icon" aria-hidden>
          <Icon name={copy.icon} size={34} color="currentColor" />
        </span>
        <p className="report-tracking__eyebrow">Reference {report.id.slice(0, 8)}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {report.validation.reasonCodes.length > 0 && (
          <div className="report-tracking__checks">
            <strong>Rule screening result</strong>
            <ul>{report.validation.reasonCodes.map((reason) => (
              <li key={reason}>{humanize(reason)}</li>
            ))}</ul>
          </div>
        )}
        {report.validation.screeningMethod === 'deterministic_rules' && (
          <p className="report-tracking__scope-note">
            Screening covers image quality, duplicate evidence, location, and submission patterns.
          </p>
        )}
        <div className="report-tracking__actions">
          {report.status === 'needs_rescan' && <Link to="/scan">Retake scan</Link>}
          {report.sightingId && <Link to={`/map`}>View shared map</Link>}
          <Link to="/map" className="report-tracking__secondary">Back to map</Link>
        </div>
      </section>
    </section>
  )
}

const REASON_COPY: Record<string, string> = {
  automated_rule_screened: 'Automated checks passed',
  exact_photo_replay: 'This photo was already submitted',
  perceptual_photo_replay: 'Very similar to an earlier photo of the same species',
  same_species_nearby_recent: 'Someone recently reported the same species nearby',
  image_too_small: 'The photo is too small to check',
  image_too_dark: 'The photo is too dark',
  image_too_bright: 'The photo is too bright',
  image_low_contrast: 'The plant is hard to see against the background',
  image_too_blurry: 'The photo is too blurry',
  invalid_or_corrupt_image: 'The photo could not be read',
  location_accuracy_insufficient: 'GPS needs to be accurate to within 100 m',
  plant_identification_not_reportable: 'This species is not on the reportable list yet',
  unsupported_client_model_version: 'Update the app to submit this report',
}

const humanize = (reason: string) => REASON_COPY[reason]
  ?? reason.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())
