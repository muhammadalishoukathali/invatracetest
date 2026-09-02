import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import { useOnline } from '@/hooks/useOnline'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import { listScanHistory, type ScanHistoryRecord } from '@/features/scan/scan-history-store'
import { profileStateFromPath } from '@/features/private-access/profile-navigation'
import { mapStateForLocation } from '@/features/map/map-location-link'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
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

/**
 * "My records" screen — merges submitted reports fetched from the API with
 * scans that only exist in local scan history (not submitted yet, or queued
 * offline). Lets the user jump back into any record's map location or
 * tracking page. Reached from the profile screen, not part of the wizard.
 */
export function MyReportsPage() {
  const online = useOnline()
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  const scanHistory = listScanHistory()
  const query = useInfiniteQuery({
    queryKey: ['my-reports', profileId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<ReportListResponse>(
      `/api/v1/reports/mine?limit=100${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: online,
    staleTime: 15_000,
  })
  const reports = query.data?.pages.flatMap((page) => page.items) ?? []
  const submittedCaptureIds = new Set(reports.map((report) => report.submission.captureId))
  const localRecords = scanHistory.filter((scan) => !submittedCaptureIds.has(scan.captureId))
  const unsubmittedRecords = localRecords.filter((scan) => !scan.submission)
  const submittedCount = reports.length + localRecords.filter((scan) => scan.submission).length
  const count = reports.length + localRecords.length
  const hasMoreReports = Boolean(query.hasNextPage)
  const hasRecords = count > 0
  const hasNoRecords = query.isSuccess && count === 0

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
          <h2>{hasNoRecords ? 'Your first record starts with a scan.' : 'Your scans and reports, kept in one place.'}</h2>
          <p>
            {hasRecords
              ? 'Scans stay on this device. Submitted reports also show their screening progress.'
              : hasNoRecords
                ? 'Photograph a plant, add its location and submit it for screening.'
                : 'Review screening progress and return to any submission from this private profile.'}
          </p>
        </div>
        {hasRecords && (
          <dl className="my-reports__stats" aria-label="Record summary">
            <div>
              <dt>{hasMoreReports ? 'Shown' : 'All'}</dt>
              <dd>{count}</dd>
            </div>
            <div>
              <dt>{hasMoreReports ? 'Submitted shown' : 'Submitted'}</dt>
              <dd>{submittedCount}</dd>
            </div>
            <div>
              <dt>Not submitted</dt>
              <dd>{unsubmittedRecords.length}</dd>
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

      {online && query.data && reports.length === 0 && localRecords.length === 0 && (
        <div className="my-reports__empty">
          <span className="my-reports__empty-icon" aria-hidden>
            <Icon name="ClipboardList" size={24} />
          </span>
          <div>
            <h2>No field records yet</h2>
            <p>Completed scans are saved on this device. Reports also include their screening status and reference number.</p>
            <Link className="my-reports__empty-cta" to="/scan" state={scanStateFromPath('/reports')}>
              <Icon name="ScanLine" size={17} />
              <span>Scan your first plant</span>
            </Link>
          </div>
        </div>
      )}

      {localRecords.length > 0 && (
        <div className="my-reports__results">
          <div className="my-reports__results-heading">
            <div>
              <h2>Saved on this device</h2>
              <p>Local scans include reports waiting to sync and submitted records not currently loaded.</p>
            </div>
            <span>{localRecords.length} total</span>
          </div>
          <ul className="my-reports__list">
            {localRecords.map((scan) => (
              <ScanHistoryRow key={scan.captureId} scan={scan} />
            ))}
          </ul>
        </div>
      )}

      {online && query.data && reports.length > 0 && (
        <div className="my-reports__results">
          <div className="my-reports__results-heading">
            <h2>Submitted records</h2>
            <span>{hasMoreReports ? `${count} shown` : `${count} total`}</span>
          </div>
          <ul className="my-reports__list">
            {reports.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </ul>
          {query.hasNextPage && (
            <button
              type="button"
              className="my-reports__load-more"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load older records'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function ScanHistoryRow({ scan }: { scan: ScanHistoryRecord }) {
  const name = scan.speciesName ?? scan.scientificName ?? speciesName(scan.speciesId)
  const status = scan.submission?.status === 'queued'
    ? 'Waiting to upload'
    : scan.submission?.status === 'submitted'
      ? 'Submitted'
      : 'Not submitted'
  return (
    <li className="my-reports__item my-reports__item--scan">
      <div className="my-reports__scan-record">
        <div className="my-reports__row">
          <span className="my-reports__status my-reports__status--muted">
            <span className="my-reports__status-dot" aria-hidden />
            {status}
          </span>
          <time className="my-reports__date" dateTime={scan.observedAt}>{relativeDate(scan.observedAt)}</time>
        </div>
        <div className="my-reports__row my-reports__row--body">
          <span className="my-reports__species">{name}</span>
          <span className="my-reports__confidence">{Math.round(scan.confidence * 100)}% match</span>
        </div>
      </div>
      {scan.location && (
        <Link
          className="my-reports__map-link"
          to="/map"
          state={mapStateForLocation(scan.location, `${name} scan`, {
            kind: 'scan',
            statusLabel: status,
            observedAt: scan.observedAt,
            locationAccuracyM: scan.locationAccuracyM ?? null,
          })}
          aria-label={`View ${name} scan location on map`}
        >
          <Icon name="MapPin" size={15} />
          <span>View on map</span>
        </Link>
      )}
    </li>
  )
}

function ReportRow({ report }: { report: Report }) {
  const status = STATUS_COPY[report.status]
  const name = speciesName(report.submission.speciesId)
  const mapHref = report.sightingId ? `/map?sighting=${encodeURIComponent(report.sightingId)}` : '/map'
  const mapState = report.sightingId
    ? undefined
    : mapStateForLocation(report.submission.location, `${name} report`, {
        kind: 'report',
        statusLabel: status.label,
        observedAt: report.submission.observedAt,
        locationAccuracyM: report.submission.locationAccuracyM,
        recordId: report.id,
      })
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
            {name}
          </span>
          <span className="my-reports__ref">Ref {shortId(report.id)}</span>
        </div>
        <span className="my-reports__chevron" aria-hidden>
          <Icon name="ChevronRight" size={16} color="var(--icon)" />
        </span>
      </Link>
      <Link
        className="my-reports__map-link"
        to={mapHref}
        state={mapState}
        aria-label={`View ${name} report on map`}
      >
        <Icon name="MapPin" size={15} />
        <span>{report.sightingId ? 'View report on map' : 'View report location'}</span>
      </Link>
    </li>
  )
}
