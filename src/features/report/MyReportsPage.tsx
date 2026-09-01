import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import { useOnline } from '@/hooks/useOnline'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import { profileStateFromPath } from '@/features/private-access/profile-navigation'
import type { Report, ReportListResponse, ReportStatus } from '@/types'
import './my-reports.css'

const STATUS_COPY: Record<ReportStatus, { label: string; tone: 'progress' | 'ok' | 'warn' | 'error' | 'muted' }> = {
  processing:              { label: 'Screening',       tone: 'progress' },
  screened:                { label: 'Published',       tone: 'ok' },
  merged:                  { label: 'Merged sighting', tone: 'ok' },
  needs_rescan:            { label: 'Needs rescan',    tone: 'warn' },
  rejected:                { label: 'Rejected',        tone: 'error' },
  validation_unavailable:  { label: 'Screening paused', tone: 'muted' },
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime()
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

function speciesName(speciesId: string | null): string {
  if (!speciesId) return 'Uncertain species'
  return speciesId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function MyReportsPage() {
  const online = useOnline()
  const query = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => api<ReportListResponse>('/api/v1/reports/mine'),
    enabled: online,
    staleTime: 15_000,
  })
  const count = query.data?.items.length ?? 0
  const hasRecords = query.isSuccess && count > 0
  const hasNoRecords = query.isSuccess && count === 0
  const publishedCount = query.data?.items.filter((report) =>
    report.status === 'screened' || report.status === 'merged').length ?? 0
  const attentionCount = query.data?.items.filter((report) =>
    report.status === 'needs_rescan' || report.status === 'rejected').length ?? 0

  return (
    <section className="my-reports" aria-label="My records">
      <nav className="my-reports__toolbar" aria-label="Record actions">
        <Link className="my-reports__back" to="/profile" state={profileStateFromPath('/reports')}>
          <Icon name="ChevronLeft" size={17} />
          <span>Profile</span>
        </Link>
        <Link className="my-reports__cta" to="/scan" state={scanStateFromPath('/reports')}>
          <Icon name="ScanLine" size={16} />
          <span>New scan</span>
        </Link>
      </nav>


      <div className="my-reports__overview">
        <div className="my-reports__overview-copy">
          <span className="my-reports__eyebrow">Field record</span>
          <h2>{hasNoRecords ? 'Your first record starts with a scan.' : 'Your sightings, kept in one place.'}</h2>
          <p>
            {hasRecords
              ? 'Follow screening progress and open any submission for its latest result.'
              : hasNoRecords
                ? 'Photograph a plant, add its location and submit it for screening.'
                : 'Review screening progress and return to any submission from this private profile.'}
          </p>
        </div>
        {hasRecords && (
          <dl className="my-reports__stats" aria-label="Record summary">
            <div>
              <dt>All</dt>
              <dd>{count}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{publishedCount}</dd>
            </div>
            <div>
              <dt>Action needed</dt>
              <dd>{attentionCount}</dd>
            </div>
          </dl>
        )}
      </div>

      {!online && (
        <p className="my-reports__notice" role="status">
          You are offline. Reconnect to load the latest list.
        </p>
      )}

      {online && query.isLoading && (
        <ul className="my-reports__list" aria-busy="true">
          {[0, 1, 2].map((n) => (
            <li key={n} className="my-reports__item my-reports__item--skeleton" aria-hidden>
              <span className="invatrace-skeleton my-reports__skeleton-line" />
              <span className="invatrace-skeleton my-reports__skeleton-line my-reports__skeleton-line--short" />
            </li>
          ))}
        </ul>
      )}

      {online && query.isError && (
        <div className="my-reports__error" role="alert">
          <Icon name="WifiOff" size={20} />
          <div>
            <strong>Could not load your reports.</strong>
            <p>Check the connection and try again.</p>
          </div>
          <button type="button" onClick={() => void query.refetch()}>Try again</button>
        </div>
      )}

      {online && query.data && query.data.items.length === 0 && (
        <div className="my-reports__empty">
          <span className="my-reports__empty-icon" aria-hidden>
            <Icon name="ClipboardList" size={24} />
          </span>
          <div>
            <h2>No field records yet</h2>
            <p>Your submitted scans will appear here with their screening status and reference number.</p>
            <Link className="my-reports__empty-cta" to="/scan" state={scanStateFromPath('/reports')}>
              <Icon name="ScanLine" size={17} />
              <span>Scan your first plant</span>
            </Link>
          </div>
        </div>
      )}

      {online && query.data && query.data.items.length > 0 && (
        <div className="my-reports__results">
          <div className="my-reports__results-heading">
            <h2>Submitted records</h2>
            <span>{count} total</span>
          </div>
          <ul className="my-reports__list">
            {query.data.items.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ReportRow({ report }: { report: Report }) {
  const status = STATUS_COPY[report.status]
  return (
    <li className="my-reports__item">
      <Link to={`/reports/${report.id}`} className="my-reports__link">
        <div className="my-reports__row">
          <span className={`my-reports__status my-reports__status--${status.tone}`}>
            <span className="my-reports__status-dot" aria-hidden />
            {status.label}
          </span>
          <time className="my-reports__date" dateTime={report.createdAt}>{relativeDate(report.createdAt)}</time>
        </div>
        <div className="my-reports__row my-reports__row--body">
          <span className="my-reports__species">
            {speciesName(report.submission.speciesId)}
          </span>
          <span className="my-reports__ref">Ref {shortId(report.id)}</span>
        </div>
        <span className="my-reports__chevron" aria-hidden>
          <Icon name="ChevronRight" size={16} color="var(--icon)" />
        </span>
      </Link>
    </li>
  )
}
