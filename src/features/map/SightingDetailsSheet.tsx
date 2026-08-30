import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import { useMapView } from '@/features/map/map-view-store'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import type { SightingDetail, SightingStatus } from '@/types'
import './sighting-details.css'

const STATUS_LABEL: Record<SightingStatus, string> = {
  screened: 'Rule screened',
  removed: 'Removed',
}

const STATUS_COLOR: Record<SightingStatus, string> = {
  screened: 'var(--green)',
  removed: 'var(--icon)',
}

export function SightingDetailsSheet() {
  const { selectedId, select } = useMapView()
  const dialogRef = useRef<HTMLElement>(null)
  const close = () => select(null)
  useDialogA11y(dialogRef, close, {
    active: !!selectedId,
    returnFocus: () => selectedId
      ? document.querySelector<HTMLElement>(`.map-pin[data-sighting-id="${CSS.escape(selectedId)}"]`)
      : null,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sighting', selectedId],
    queryFn: () => api<SightingDetail>(`/api/v1/sightings/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  if (!selectedId) return null

  const isHigh = data?.risk === 'high'
  const isRemoved = data?.status === 'removed'
  const riskClass = isRemoved ? 'removed' : isHigh ? 'high' : 'watch'
  const riskColor = isHigh ? 'var(--red-text)' : 'var(--amber-text)'
  const coordinateDecimals = data?.precisionReduced ? 4 : 5
  const directionsHref = data
    ? `https://www.google.com/maps/dir/?api=1&destination=${data.location.lat},${data.location.lng}`
    : '#'

  /* Render the details under document.body so they always appear above the map
   * canvas, legend, and MapLibre controls. */
  return createPortal(
    <>
      <div onClick={close} aria-hidden className="app-sheet-backdrop sighting-details-backdrop" />
      <aside ref={dialogRef} tabIndex={-1} className={`pin-sheet pin-sheet--${riskClass}`}
        role="dialog" aria-label="Sighting details" aria-modal="true">
        <div className="pin-sheet__handle" aria-hidden />

        <button type="button" onClick={close} aria-label="Close sighting details"
          className="pin-sheet__close">
          <Icon name="X" size={17} color="var(--body)" />
        </button>

        <div className="pin-sheet__content">
          {isError ? (
            <div role="alert" tabIndex={-1} data-dialog-initial className="pin-sheet__state pin-sheet__state--error">
              <strong>Could not load this sighting.</strong>
              <p>The map record is still available. Check the connection and try again.</p>
              <button type="button" onClick={() => void refetch()} className="pin-sheet__retry">
                Try again
              </button>
            </div>
          ) : isLoading || !data ? (
            <div role="status" tabIndex={-1} data-dialog-initial className="pin-sheet__state">
              Loading sighting…
            </div>
          ) : (
            <>
              {data.thumbnailUrl && (
                <img className="pin-sheet__photo" src={data.thumbnailUrl}
                  alt={`Rule-screened ${data.speciesName} sighting`} />
              )}
              <header className="pin-sheet__heading">
                <h2 tabIndex={-1} data-dialog-initial>{data.speciesName}</h2>
                <p>{data.latinName}</p>
                <div className="pin-sheet__summary" aria-label={`${isHigh ? 'High' : 'Watch'} risk, ${STATUS_LABEL[data.status]}`}>
                  <span className="pin-sheet__risk" style={{ color: riskColor }}>
                    <span aria-hidden className="pin-sheet__risk-dot" />
                    {isHigh ? 'High risk' : 'Watch risk'}
                  </span>
                  <span aria-hidden className="pin-sheet__summary-separator" />
                  <span className="pin-sheet__status" style={{ color: STATUS_COLOR[data.status] }}>
                    <Icon name={statusIcon(data.status)} size={14} />
                    {STATUS_LABEL[data.status]}
                  </span>
                </div>
              </header>

              {!isRemoved && (
                <p className="pin-sheet__screening-note">
                  <Icon name="Info" size={14} color="var(--green-dark)" />
                  <span>Automated rules checked image quality, duplicates, location, and submission patterns.</span>
                </p>
              )}

              <section className="pin-sheet__recommendation" aria-labelledby="recommended-action-heading">
                <Icon name="ShieldCheck" size={19} color="var(--green-dark)" />
                <div>
                  <h3 id="recommended-action-heading">Recommended action</h3>
                  <p>{data.recommendedAction}</p>
                </div>
              </section>

              <section className="pin-sheet__record" aria-labelledby="sighting-record-heading">
                <h3 id="sighting-record-heading">Sighting record</h3>
                <dl>
                  <MetaRow icon="MapPin" label="Coordinates"
                    value={`${data.location.lat.toFixed(coordinateDecimals)}, ${data.location.lng.toFixed(coordinateDecimals)}`}
                    sub={data.precisionReduced ? 'Approximate location' : undefined} mono />
                  <MetaRow icon="Trees" label="Associated place" value={data.place.displayName}
                    sub={data.place.trailName ? `Nearest trail: ${data.place.trailName}` : undefined} />
                  <MetaRow icon="Clock" label="Last reported" value={formatTime(data.lastReportedAt)} />
                  <MetaRow icon="User" label="Reporter trust" value={data.reporterTrust} />
                  <MetaRow icon="ClipboardList" label="Reports" value={`${data.reportCount}`} />
                </dl>
              </section>

              {data.actionGuide && (
                <section className="pin-sheet__record" aria-labelledby="seasonal-guide-heading">
                  <h3 id="seasonal-guide-heading">This season</h3>
                  <p>{data.actionGuide.title}</p>
                  <ul>
                    {data.actionGuide.steps.map((step) => <li key={step.order}>{step.action}</li>)}
                  </ul>
                </section>
              )}

              {data.precisionReduced && (
                <p className="pin-sheet__privacy-note">
                  <Icon name="Info" size={14} color="var(--muted)" />
                  <span>Reports from new profiles may be shifted by about 100 m for privacy.</span>
                </p>
              )}
            </>
          )}
        </div>

        {data && (
          <footer className="pin-sheet__footer">
            <a href={directionsHref} target="_blank" rel="noopener noreferrer"
              aria-label="Open directions in Google Maps (opens in a new tab)"
              className="pin-sheet__directions">
              <Icon name="Navigation" size={16} color="#fff" />
              Open directions
            </a>
          </footer>
        )}
      </aside>
    </>,
    document.body,
  )
}

function MetaRow({ icon, label, value, sub, mono }: {
  icon: string; label: string; value: string; sub?: string; mono?: boolean
}) {
  return (
    <div className="pin-sheet__record-row">
      <dt><Icon name={icon} size={15} color="var(--muted)" />{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
      {sub && <span>{sub}</span>}
    </div>
  )
}

function statusIcon(status: SightingStatus): string {
  if (status === 'screened') return 'CircleCheck'
  return 'Check'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const mins = Math.round((now - d.getTime()) / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}
