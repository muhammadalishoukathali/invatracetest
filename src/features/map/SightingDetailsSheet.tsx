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
import type { SightingDetail, SightingStatus } from '@/types'

const OSM_FEATURE_LABEL: Record<string, string> = {
  highway_path: 'trail',
  highway_footway: 'footway',
  highway_track: 'track',
  leisure_park: 'park',
  landuse_forest: 'forest',
  natural_wood: 'wood',
}
import './sighting-details.css'

const STATUS_LABEL: Record<SightingStatus, string> = {
  screened: 'Community report — not expert validated',
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

  // AC 4.3.1 — live nearest-feature lookup against OpenStreetMap Overpass.
  // The lookup runs after the sighting detail arrives; failure or "no result"
  // is silent so publishing and viewing are never blocked (AC 4.3.2).
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
  // Tier name doubles as the sheet's modifier class so the accent bar picks
  // up the matching --risk-accent from sighting-details.css.
  const riskClass = tier
  const riskColor = tier === 'hotspot' ? 'var(--red-text)'
    : tier === 'spreading' ? 'var(--amber-text)'
    : tier === 'isolated' ? 'var(--green-dark)'
    : 'var(--muted)'
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
                <figure style={{ margin: 0 }}>
                  <img className="pin-sheet__photo" src={data.thumbnailUrl}
                    alt={`Photo submitted with this ${data.speciesName} report`} />
                  <figcaption style={{
                    marginTop: 4, fontSize: 10.5, color: 'var(--muted)',
                    padding: '0 var(--pin-sheet-x, 16px)',
                  }}>
                    Photo from this report
                  </figcaption>
                </figure>
              )}
              <header className="pin-sheet__heading">
                <h2 tabIndex={-1} data-dialog-initial>{data.speciesName}</h2>
                <p>{data.latinName}</p>
                <div className="pin-sheet__summary" aria-label={`${tierInfo.label}, ${STATUS_LABEL[data.status]}`}>
                  <span className="pin-sheet__risk" style={{ color: riskColor }}>
                    <span aria-hidden className="pin-sheet__risk-dot" style={{ background: tierInfo.fill }} />
                    {tierInfo.label}
                  </span>
                  <span aria-hidden className="pin-sheet__summary-separator" />
                  <span className="pin-sheet__status" style={{ color: STATUS_COLOR[data.status] }}>
                    <Icon name={statusIcon(data.status)} size={14} />
                    {STATUS_LABEL[data.status]}
                  </span>
                </div>
              </header>

              <section className="pin-sheet__record" aria-labelledby="sighting-record-heading">
                <h3 id="sighting-record-heading">Sighting record</h3>
                <dl>
                  <MetaRow icon="MapPin" label="Coordinates"
                    value={`${data.location.lat.toFixed(coordinateDecimals)}, ${data.location.lng.toFixed(coordinateDecimals)}`}
                    sub={data.precisionReduced ? 'Approximate location' : undefined} mono />
                  <MetaRow icon="Trees" label="Nearby place"
                    value={(() => {
                      if (nearestOsm) {
                        const kind = OSM_FEATURE_LABEL[nearestOsm.featureType] ?? 'feature'
                        return `${nearestOsm.featureName} (${kind}, ~${nearestOsm.distanceM} m)`
                      }
                      if (data.place.source === 'fallback' || !data.place.displayName) {
                        return 'No named trail, park or forest found nearby'
                      }
                      return data.place.displayName
                    })()}
                    sub={nearestOsm ? 'OpenStreetMap · live' : undefined} />
                  <MetaRow icon="Clock" label="Last reported" value={formatTime(data.lastReportedAt)} />
                </dl>
              </section>

              {/* Mirror the scan-result page: same plant reference photo,
                  short description, and the dynamic permission-aware
                  guidance panel so a map viewer gets identical decision
                  support to someone who just captured the plant. */}
              <PlantInfoBlock latinName={data.latinName} speciesName={data.speciesName} />
              <PlantGuidancePanel
                scientificName={data.latinName}
                speciesName={data.speciesName}
                plantId={data.speciesId}
              />
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

/** Reference photo + one-sentence description, pulled from the bundled
 *  guidance dataset. Renders nothing when the species has no reviewed record. */
function PlantInfoBlock({ latinName, speciesName }: { latinName: string; speciesName: string }) {
  const guidance = findPlantGuidance({
    scientificName: latinName,
    modelLabel: speciesName,
    plantId: null,
  })
  if (!guidance) return null
  const firstSentence = guidance.general_information.match(/^.*?[.!?](?=\s|$)/)?.[0]
    ?? guidance.general_information
  return (
    <section
      aria-label="About this plant"
      style={{
        marginTop: 16,
        padding: 12,
        borderRadius: 'var(--r-card)',
        background: 'var(--bg-alt)',
        border: '1px solid var(--border)',
      }}
    >
      {guidance.reference_image && (
        <figure style={{ margin: 0 }}>
          <img
            src={guidance.reference_image}
            alt={`Reference photo of ${latinName}`}
            loading="lazy"
            style={{
              width: '100%', maxHeight: 220, objectFit: 'cover',
              borderRadius: 'var(--r-input)', display: 'block',
            }}
          />
          <figcaption style={{ marginTop: 4, fontSize: 10.5, color: 'var(--muted)' }}>
            Typical example of the species · {guidance.reference_image_credit ?? 'Wikimedia'}
          </figcaption>
        </figure>
      )}
      <p style={{ marginTop: 10, fontSize: 13, color: 'var(--body)', lineHeight: 1.55 }}>
        {firstSentence}
      </p>
    </section>
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
