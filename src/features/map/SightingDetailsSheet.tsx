import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import { useMapView } from '@/features/map/map-view-store'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { fetchNearestOsmFeature } from '@/services/osm-nearest'
import { PIN_TIERS, pinTier } from '@/features/map/ThreatMapPage'
import { PlantGuidancePanel } from '@/features/scan/PlantGuidancePanel'
import { findPlantGuidance } from '@/data/plant-guidance'
import { findModelSpecies, modelReferenceImageUrl } from '@/data/model-species-catalog'
import type { SightingDetail } from '@/types'
import './sighting-details.css'

const OSM_FEATURE_LABEL: Record<string, string> = {
  highway_path: 'trail',
  highway_footway: 'footway',
  highway_track: 'track',
  leisure_park: 'park',
  landuse_forest: 'forest',
  natural_wood: 'wood',
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

  // The nearby feature enriches the record but never blocks viewing it.
  const { data: nearestOsm } = useQuery({
    queryKey: ['osm-nearest', data?.location.lat, data?.location.lng],
    queryFn: () => fetchNearestOsmFeature(data!.location.lat, data!.location.lng),
    enabled: !!data,
    staleTime: 10 * 60_000,
    retry: false,
  })

  if (!selectedId) return null

  const tier = data ? pinTier(data) : 'isolated'
  const tierInfo = PIN_TIERS[tier]
  const coordinateDecimals = data?.precisionReduced ? 4 : 5
  return createPortal(
    <>
      <div onClick={close} aria-hidden className="app-sheet-backdrop sighting-details-backdrop" />
      <aside ref={dialogRef} tabIndex={-1} className={`pin-sheet pin-sheet--${tier}`}
        role="dialog" aria-label="Sighting details" aria-modal="true">
        <div className="pin-sheet__handle" aria-hidden />

        <button type="button" onClick={close} aria-label="Close sighting details"
          className="pin-sheet__close">
          <Icon name="X" size={18} color="var(--body)" />
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
              <span className="pin-sheet__skeleton-photo invatrace-skeleton" aria-hidden />
              <span className="pin-sheet__skeleton-line pin-sheet__skeleton-line--title invatrace-skeleton" aria-hidden />
              <span className="pin-sheet__skeleton-line pin-sheet__skeleton-line--short invatrace-skeleton" aria-hidden />
              <span className="pin-sheet__skeleton-line invatrace-skeleton" aria-hidden />
              <span className="sr-only">Loading sighting…</span>
            </div>
          ) : (
            <>
              <PlantReferenceMedia latinName={data.latinName} speciesName={data.speciesName} />

              <header className="pin-sheet__heading">
                <h2 tabIndex={-1} data-dialog-initial>{data.speciesName}</h2>
                <p className="pin-sheet__latin">{data.latinName}</p>
                <div className="pin-sheet__summary" aria-label={sightingSummaryLabel(data)}>
                  <span className={`pin-sheet__risk pin-sheet__risk--${tier}`}>
                    <span aria-hidden className="pin-sheet__risk-dot" style={{ background: tierInfo.fill }} />
                    {densityLabel(tierInfo.label)}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="pin-sheet__report-count">
                    {formatReportCount(data.reportCount)} at this location
                  </span>
                </div>
                <p className="pin-sheet__status-note">
                  {data.status === 'removed'
                    ? 'Marked removed · retained for follow-up'
                    : 'Community-screened · not expert verified'}
                </p>
              </header>

              <section className="pin-sheet__record" aria-labelledby="sighting-record-heading">
                <h3 id="sighting-record-heading">Report information</h3>
                <dl>
                  <MetaRow label="Reported" value={formatTime(data.lastReportedAt)} />
                  <MetaRow label="Near"
                    value={nearbyPlaceLabel(data, nearestOsm)}
                    sub={nearestOsm ? 'Live place data from OpenStreetMap' : undefined} />
                  <MetaRow label="Coordinates"
                    value={`${data.location.lat.toFixed(coordinateDecimals)}, ${data.location.lng.toFixed(coordinateDecimals)}`}
                    sub={data.precisionReduced ? 'Approximate location for privacy' : undefined} mono />
                </dl>
              </section>

              <details className="pin-sheet__guidance">
                <summary>
                  <span>
                    <strong>Identification and safety</strong>
                    <small>Plant details and action guidance</small>
                  </span>
                  <span className="pin-sheet__guidance-action" aria-hidden />
                </summary>
                <PlantGuidancePanel
                  scientificName={data.latinName}
                  speciesName={data.speciesName}
                  plantId={data.speciesId}
                  showReferenceImage={false}
                  decisionContext={{ id: `sighting:${data.id}`, kind: 'sighting' }}
                />
              </details>
            </>
          )}
        </div>

        {data && (
          <footer className="pin-sheet__footer">
            <button type="button" disabled aria-label="Open directions (not available yet)"
              className="pin-sheet__directions">
              <Icon name="Navigation" size={16} color="currentColor" />
              Directions unavailable
            </button>
          </footer>
        )}
      </aside>
    </>,
    document.body,
  )
}

/** Uses the reviewed species image, never a reporter's uploaded photo. */
function PlantReferenceMedia({ latinName, speciesName }: { latinName: string; speciesName: string }) {
  const guidance = findPlantGuidance({
    scientificName: latinName,
    modelLabel: speciesName,
    plantId: null,
  })
  const modelSpecies = findModelSpecies({ scientificName: latinName })
  const referenceImage = guidance?.reference_image
    ?? (modelSpecies ? modelReferenceImageUrl(modelSpecies) : null)
  if (!referenceImage) return null
  return (
    <figure className="pin-sheet__reference">
      <img className="pin-sheet__photo" src={referenceImage}
        alt={`Typical appearance of ${latinName}`} />
      <figcaption>
        <span>Species reference</span>
        <span>{guidance?.reference_image_credit ?? 'Species reference image'}</span>
      </figcaption>
    </figure>
  )
}

function MetaRow({ label, value, sub, mono }: {
  label: string; value: string; sub?: string; mono?: boolean
}) {
  return (
    <div className="pin-sheet__record-row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
      {sub && <span>{sub}</span>}
    </div>
  )
}

function nearbyPlaceLabel(
  data: SightingDetail,
  nearestOsm: Awaited<ReturnType<typeof fetchNearestOsmFeature>> | undefined,
): string {
  if (nearestOsm) {
    const kind = OSM_FEATURE_LABEL[nearestOsm.featureType] ?? 'feature'
    return `${nearestOsm.featureName} · ${kind}, about ${nearestOsm.distanceM} m away`
  }
  if (data.place.source === 'fallback' || !data.place.displayName) {
    return 'No named trail, park or forest found nearby'
  }
  return data.place.displayName
}

function densityLabel(label: string): string {
  return label.replace(/\s*\(.*\)$/, '')
}

function formatReportCount(count: number): string {
  return `${count} ${count === 1 ? 'report' : 'reports'}`
}

function sightingSummaryLabel(data: SightingDetail): string {
  const status = data.status === 'removed' ? 'removed' : 'community-screened, not expert verified'
  return `${densityLabel(PIN_TIERS[pinTier(data)].label)}, ${formatReportCount(data.reportCount)}, ${status}`
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
