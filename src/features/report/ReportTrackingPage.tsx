import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import type { Report, ReportStatus } from '@/types'
import './report-tracking.css'

const COPY: Record<ReportStatus, { icon: string; title: string; body: string }> = {
  processing: {
    icon: 'LoaderCircle',
    title: 'Automated checks are running',
    body: 'The report is private while the server checks the image, identity, location, and duplicates.',
  },
  confirmed: {
    icon: 'CircleCheck',
    title: 'Confirmed and published',
    body: 'Every automated check passed. This observation now appears on the shared map.',
  },
  merged: {
    icon: 'GitMerge',
    title: 'Matched an existing plant',
    body: 'Your photo strengthens an existing sighting instead of creating a duplicate map pin.',
  },
  needs_rescan: {
    icon: 'ScanLine',
    title: 'A fresh scan is needed',
    body: 'The evidence could not be validated. Use the in-app camera again at the plant.',
  },
  rejected: {
    icon: 'XOctagon',
    title: 'Evidence rejected',
    body: 'Automated integrity checks found evidence that cannot be accepted.',
  },
  validation_unavailable: {
    icon: 'WifiOff',
    title: 'Validation is temporarily unavailable',
    body: 'The report remains private. It cannot appear on the map until the server validator is available.',
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

  if (query.isLoading) return <main className="report-tracking"><p role="status">Loading report status…</p></main>
  if (query.isError || !query.data) {
    return (
      <main className="report-tracking">
        <h1>Report unavailable</h1>
        <p>We could not load this report. Check the connection and try again.</p>
        <button type="button" onClick={() => void query.refetch()}>Try again</button>
      </main>
    )
  }

  const report = query.data
  const copy = COPY[report.status]
  return (
    <main className={`report-tracking report-tracking--${report.status}`}>
      <section className="report-tracking__card" aria-live="polite">
        <span className="report-tracking__icon" aria-hidden>
          <Icon name={copy.icon} size={34} color="currentColor" />
        </span>
        <p className="report-tracking__eyebrow">Report {report.id.slice(0, 8)}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {report.validation.reasonCodes.length > 0 && (
          <div className="report-tracking__checks">
            <strong>Validation result</strong>
            <ul>{report.validation.reasonCodes.map((reason) => (
              <li key={reason}>{humanize(reason)}</li>
            ))}</ul>
          </div>
        )}
        <div className="report-tracking__actions">
          {report.status === 'needs_rescan' && <Link to="/scan">Retake scan</Link>}
          {report.sightingId && <Link to={`/map`}>View shared map</Link>}
          <Link to="/map" className="report-tracking__secondary">Back to map</Link>
        </div>
      </section>
    </main>
  )
}

const humanize = (reason: string) => reason.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())
