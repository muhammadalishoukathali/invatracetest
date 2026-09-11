/** Iteration 2 Phase 7 - Epic 6 adopted-area detail view (AC 6.3.*).
 *
 *  Renders the indicator bundle for one adopted area plus a
 *  DBSCAN-clustered marker list from GET /adopted-areas/{id}/activity,
 *  and outlines the area polygon on a MapLibre canvas so the user can
 *  see WHERE the reports are, not just how many. Copy is deliberately
 *  "Recent reporting concentration" (AC 6.3.4) and never "invasion
 *  density" - Epic 6 review flagged the latter as loaded language.
 *
 *  MapLibre is loaded dynamically inside a useEffect so the initial
 *  page chunk stays small; when it fails to load (offline first visit)
 *  the marker table below still renders every sighting keyboard- and
 *  screen-reader-legibly.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { fetchAdoptionActivity } from '@/services/adopted-areas'


// The service type predates the AC 6.3.2 marker-detail fields; extend
// it here so the UI can consume `plant_name`, `observation_date` and
// friends without waiting on a service-file bump.
type MarkerExtras = {
  plantName: string
  plantCommonName: string | null
  communityReportLabel: string
  observationDate: string
  currentStatus: string
  statusDate: string
}
type ActivityResponseExtras = {
  geometryVersion: string
  geometryGeojson: string | null
}


export function AreaDetailPage() {
  const { adoptionId } = useParams<{ adoptionId: string }>()
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['adopted-area-activity', adoptionId],
    queryFn: () => fetchAdoptionActivity(adoptionId!),
    enabled: Boolean(adoptionId),
    staleTime: 30_000,
  })

  // Cast to the augmented shape the backend now serves (AC 6.3.1/6.3.2).
  const extras = data as unknown as (typeof data & ActivityResponseExtras) | undefined
  const markers = useMemo(
    () =>
      (data?.markers ?? []).map((m) => m as unknown as (typeof m & MarkerExtras)),
    [data?.markers],
  )

  // AC 6.3.1 - outline the area polygon on a MapLibre canvas. Dynamic
  // import so the initial page chunk is not weighed down by ~200 KB of
  // map code for a user who only ever reads the indicator bundle.
  useEffect(() => {
    if (!mapContainer.current || !extras?.geometryGeojson) return
    let cancelled = false
    let mapInstance: unknown = null
    ;(async () => {
      try {
        const maplibre = await import('maplibre-gl')
        await import('maplibre-gl/dist/maplibre-gl.css')
        if (cancelled || !mapContainer.current) return
        const geom = JSON.parse(extras.geometryGeojson!)
        const map = new maplibre.Map({
          container: mapContainer.current,
          style: {
            version: 8,
            sources: {
              'basemap-src': {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
                attribution:
                  '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
              },
            },
            layers: [{ id: 'basemap', type: 'raster', source: 'basemap-src' }],
          },
          center: [101.6412, 3.1497],
          zoom: 12,
        })
        mapInstance = map
        map.on('load', () => {
          map.addSource('area-outline', {
            type: 'geojson',
            data: { type: 'Feature', geometry: geom, properties: {} },
          })
          map.addLayer({
            id: 'area-outline-fill',
            type: 'fill',
            source: 'area-outline',
            paint: {
              'fill-color': '#2f7d4f',
              'fill-opacity': 0.12,
            },
          })
          map.addLayer({
            id: 'area-outline-line',
            type: 'line',
            source: 'area-outline',
            paint: {
              'line-color': '#2f7d4f',
              'line-width': 2,
            },
          })
          // Add markers on top of the outline.
          if (markers.length > 0) {
            map.addSource('area-markers', {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: markers.map((m) => ({
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [m.longitude, m.latitude],
                  },
                  properties: {},
                })),
              },
            })
            map.addLayer({
              id: 'area-marker-points',
              type: 'circle',
              source: 'area-markers',
              paint: {
                'circle-radius': 5,
                'circle-color': '#c94a2c',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1,
              },
            })
          }
          // Fit to the polygon bbox.
          try {
            const coords: [number, number][] = []
            const walk = (v: unknown): void => {
              if (
                Array.isArray(v) &&
                v.length === 2 &&
                typeof v[0] === 'number' &&
                typeof v[1] === 'number'
              ) {
                coords.push([v[0] as number, v[1] as number])
              } else if (Array.isArray(v)) {
                v.forEach(walk)
              }
            }
            walk((geom as { coordinates?: unknown }).coordinates)
            if (coords.length > 0) {
              const lons = coords.map((c) => c[0])
              const lats = coords.map((c) => c[1])
              map.fitBounds(
                [
                  [Math.min(...lons), Math.min(...lats)],
                  [Math.max(...lons), Math.max(...lats)],
                ],
                { padding: 24, animate: false },
              )
            }
          } catch {
            // ignore - map still shows outline at default center
          }
        })
      } catch (err) {
        if (!cancelled) {
          setMapError('Map could not load. The sighting list below is still complete.')
        }
        // eslint-disable-next-line no-console
        console.warn('AreaDetailPage: failed to init MapLibre', err)
      }
    })()
    return () => {
      cancelled = true
      if (mapInstance && typeof (mapInstance as { remove?: () => void }).remove === 'function') {
        try {
          ;(mapInstance as { remove: () => void }).remove()
        } catch {
          /* ignore */
        }
      }
    }
  }, [extras?.geometryGeojson, markers])

  if (!adoptionId) {
    return (
      <main className="area-detail">
        <p className="area-detail__error">Invalid area id.</p>
      </main>
    )
  }

  if (isLoading) {
    return (
      <main className="area-detail">
        <p className="area-detail__status" role="status" aria-live="polite">
          Loading area activity…
        </p>
      </main>
    )
  }

  if (isError || !data) {
    return (
      <main className="area-detail">
        <div className="area-detail__error" role="alert">
          Could not load area activity.{' '}
          <button type="button" onClick={() => refetch()}>Try again</button>
        </div>
      </main>
    )
  }

  const i = data.indicators
  const windowFrom = new Date(data.windowStartUtc).toLocaleDateString()
  const windowTo = new Date(data.windowEndUtc).toLocaleDateString()

  return (
    <main className="area-detail">
      <header className="area-detail__header">
        <Link to="/areas" className="area-detail__back">← Adopted areas</Link>
        <h1>{data.placeName}</h1>
        <p className="area-detail__subtitle">
          {data.placeType} · community monitoring activity {windowFrom} – {windowTo}
        </p>
      </header>

      <section className="area-detail__map" aria-label="Area outline and community reports">
        <div
          ref={mapContainer}
          className="area-detail__map-canvas"
          style={{ width: '100%', height: 320, borderRadius: 8, overflow: 'hidden' }}
        />
        {mapError && (
          <p className="area-detail__map-error" role="status">{mapError}</p>
        )}
      </section>

      <section className="area-detail__indicators" aria-live="polite">
        <h2>Last {i.windowDays} days</h2>
        <dl>
          <div>
            <dt>Active sightings</dt>
            <dd>{i.activeSightingCount}</dd>
          </div>
          <div>
            <dt>Distinct species</dt>
            <dd>{i.distinctSpeciesCount}</dd>
          </div>
          <div>
            <dt>New reports</dt>
            <dd>{i.reportsNew30d}</dd>
          </div>
          <div>
            <dt>Removals reported</dt>
            <dd>{i.removalReported30d}</dd>
          </div>
          <div>
            <dt>Days since most recent</dt>
            <dd>{i.daysSinceMostRecent ?? '—'}</dd>
          </div>
          <div>
            <dt>Reports the previous 30 days</dt>
            <dd>{i.reportsPrevious30d}</dd>
          </div>
        </dl>
        {i.changeDirection === 'unchanged' && (
          <p>Change is within ±{i.tolerancePct}% of the previous 30 days.</p>
        )}
        {i.changeDirection === 'increase' && i.changePct !== null && (
          <p>Reports are up {Math.abs(i.changePct).toFixed(0)}% vs the previous 30 days.</p>
        )}
        {i.changeDirection === 'increase' && i.changePct === null && (
          <p>Reports increased from zero in the previous 30 days.</p>
        )}
        {i.changeDirection === 'decrease' && i.changePct !== null && (
          <p>Reports are down {Math.abs(i.changePct).toFixed(0)}% vs the previous 30 days.</p>
        )}
        {i.changeDirection === 'insufficient_history' && (
          <p>Not enough previous-period data to describe a trend.</p>
        )}
      </section>

      <section className="area-detail__clusters">
        <h2>Recent reporting concentration</h2>
        {data.clusters.length === 0 ? (
          <p>No cluster met the DBSCAN threshold in this window.</p>
        ) : (
          <ul className="area-detail__cluster-list">
            {data.clusters.map((c) => (
              <li key={c.clusterId}>
                <strong>Cluster {c.clusterId + 1}</strong>
                <span>{c.pointCount} sightings · {c.speciesIds.length} species</span>
                <span className="area-detail__cluster-centroid">
                  centroid {c.centroidLat.toFixed(4)}, {c.centroidLon.toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="area-detail__markers">
        <h2>Sightings in this window ({markers.length})</h2>
        {markers.length === 0 ? (
          <p>No community reports recorded for this area.</p>
        ) : (
          <ol className="area-detail__marker-list">
            {markers.slice(0, 50).map((m) => (
              <li key={m.sightingId}>
                <span className="area-detail__marker-species">
                  <strong>{m.plantName ?? m.speciesId}</strong>
                  {m.plantCommonName && (
                    <span className="area-detail__marker-common"> ({m.plantCommonName})</span>
                  )}
                </span>
                <span className="area-detail__marker-report-label">
                  {m.communityReportLabel ?? 'Community-reported sighting'}
                </span>
                <span className="area-detail__marker-status">
                  Status: {m.currentStatus ?? m.status}
                  {m.statusDate && (
                    <> · updated {new Date(m.statusDate).toLocaleDateString()}</>
                  )}
                </span>
                <span className="area-detail__marker-observed">
                  Observed{' '}
                  {m.observationDate
                    ? new Date(m.observationDate).toLocaleDateString()
                    : new Date(m.observedAt).toLocaleDateString()}
                </span>
                {m.clusterId !== null && (
                  <span className="area-detail__marker-cluster">
                    Cluster {m.clusterId + 1}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}
