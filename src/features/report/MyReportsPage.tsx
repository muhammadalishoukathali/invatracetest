import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import { useOnline } from '@/hooks/useOnline'
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

export function MyReportsPage() {
  const online = useOnline()
  const query = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => api<ReportListResponse>('/api/v1/reports/mine'),
    enabled: online,
    staleTime: 15_000,
  })
  const count = query.data?.items.length ?? 0

  return (
    <section className="my-reports" aria-label="My reports">
      <p className="my-reports__lede">
        {query.isSuccess
          ? count === 0
            ? 'Nothing submitted yet.'
            : `${count} report${count === 1 ? '' : 's'} from this profile, newest first.`
          : 'Everything you have submitted from this profile.'}
      </p>

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
          <Icon name="ClipboardList" size={26} color="var(--icon)" />
          <p>You have not submitted a report yet.</p>
          <Link className="my-reports__cta" to="/scan">
            <Icon name="ScanLine" size={16} />
            <span>Start a scan</span>
          </Link>
        </div>
      )}

      {online && query.data && query.data.items.length > 0 && (
        <ul className="my-reports__list">
          {query.data.items.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
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
          <span className={`my-reports__status my-reports__status--${status.tone}`}>{status.label}</span>
          <span className="my-reports__date">{relativeDate(report.createdAt)}</span>
        </div>
        <div className="my-reports__row my-reports__row--body">
          <span className="my-reports__species">
            {report.submission.speciesId ?? 'Uncertain species'}
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
