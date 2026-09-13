/** Iteration 2 Phase 7 - Epic 6 adopted-area detail view (AC 6.3.*).
 *
 *  One screen, one area. Layout keeps the user focused on THIS place:
 *    - Full-bleed map with the polygon outline and sighting markers on top
 *      (AC 6.3.1 - polygon boundary versioned, drawn once per activity load)
 *    - Filter row: plant / status / period (AC 6.3.3 - client-selectable
 *      filters plumbed straight through to the backend query params).
 *    - Headline KPI + plain-English trend statement
 *    - Species breakdown (AC 6.3.2 - marker.plantCommonName / plantName)
 *    - Recent reports feed for the current window (AC 6.3.2)
 *    - "Recent reporting concentration" cluster summary (AC 6.3.4 -
 *      deliberately never "invasion density")
 *
 *  MapLibre is loaded dynamically so the initial page chunk stays small.
 *  When the map fails (offline first visit, CSP block) the report list
 *  below still renders every sighting keyboard- and SR-legibly.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { fetchAdoptionActivity } from '@/services/adopted-areas'
import { Icon } from '@/components/Icon'
import './area-detail.css'


type Direction = 'increase' | 'decrease' | 'unchanged' | 'insufficient_history'

// AC 6.3.3 - period options match how a user would ask about their
// area: "this week", "this month", "this quarter". Backend accepts any
// int 1-365 so we can extend without a schema change.
const PERIOD_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

// AC 6.3.3 - status filter surfaces the two states a community-facing
// user cares about: still visible (screened) vs already removed
// (removal_reported). Anything else (processing/rejected) is hidden
// from the map anyway, so exposing it here would be misleading.
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'screened', label: 'Active sightings' },
  { value: 'removal_reported', label: 'Cleared' },
]

// Small translation table so a raw enum like "removal_reported" reads as
// something a volunteer actually understands in the report feed.
const STATUS_LABEL: Record<string, string> = {
  screened: 'Sighting',
  removal_reported: 'Cleared',
  processing: 'Screening',
  rejected: 'Rejected',
  needs_rescan: 'Needs rescan',
  merged: 'Merged',
  validation_unavailable: 'Screening paused',
}

function trendCopy(dir: Direction, pct: number | null, tol: number) {
  if (dir === 'insufficient_history') return 'Not enough previous-month data to describe a trend.'
  if (dir === 'unchanged') return `Reports are steady - within ${tol}% of the previous month.`
  const abs = pct !== null ? `${Math.abs(pct).toFixed(0)}%` : ''
  if (dir === 'increase') {
    return pct === null
      ? 'Reports rose from none in the previous month.'
      : `Reports are up ${abs} vs the previous month.`
  }
  return `Reports are down ${abs} vs the previous month.`
}


export function AreaDetailPage() {
  const { adoptionId } = useParams<{ adoptionId: string }>()
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)

  // AC 6.3.3 - filter state lives here and rides the query key so a
  // change refetches without a page reload.
  const [plant, setPlant] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [periodDays, setPeriodDays] = useState<number>(30)

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['adopted-area-activity', adoptionId, plant, status, periodDays],
    queryFn: () =>
      fetchAdoptionActivity(adoptionId!, {
        speciesId: plant || null,
        status: status || null,
        periodDays,
      }),
    enabled: Boolean(adoptionId),
    staleTime: 30_000,
  })

  // Second lightweight query, unfiltered by plant, purely to keep the
  // plant dropdown from collapsing to a single option once the user
  // picks one. Follows period so the option list reflects the same
  // window the user is currently looking at.
  const { data: plantOptionsData } = useQuery({
    queryKey: ['adopted-area-activity-options', adoptionId, periodDays],
    queryFn: () =>
      fetchAdoptionActivity(adoptionId!, {
        speciesId: null,
        status: null,
        periodDays,
      }),
    enabled: Boolean(adoptionId),
    staleTime: 60_000,
  })

  const markers = data?.markers ?? []

  // Group markers by species so the user gets a per-plant summary rather
  // than one long ungrouped list (AC 6.3.2 spirit).
  const speciesBreakdown = useMemo(() => {
    const bySpecies = new Map<string, {
      speciesId: string
      plantName: string
      plantCommonName: string | null
      count: number
      lastDate: string | null
    }>()
    for (const m of markers) {
      const key = m.speciesId
      const existing = bySpecies.get(key)
      const date = m.observationDate ?? m.observedAt ?? null
      if (existing) {
        existing.count += 1
        if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date
      } else {
        bySpecies.set(key, {
          speciesId: key,
          plantName: m.plantName ?? key,
          plantCommonName: m.plantCommonName ?? null,
          count: 1,
          lastDate: date,
        })
      }
    }
    return Array.from(bySpecies.values()).sort((a, b) => b.count - a.count)
  }, [markers])

  // Plant filter options come from the unfiltered snapshot so picking
  // a plant does not shrink the dropdown to the picked plant.
  const plantOptions = useMemo(() => {
    const seen = new Map<string, { speciesId: string; plantName: string }>()
    for (const m of plantOptionsData?.markers ?? []) {
      if (!seen.has(m.speciesId)) {
        seen.set(m.speciesId, { speciesId: m.speciesId, plantName: m.plantName ?? m.speciesId })
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.plantName.localeCompare(b.plantName))
  }, [plantOptionsData?.markers])

  useEffect(() => {
    if (!mapContainer.current || !data?.geometryGeojson) return
    let cancelled = false
    let mapInstance: unknown = null
    ;(async () => {
      try {
        const maplibre = await import('maplibre-gl')
        await import('maplibre-gl/dist/maplibre-gl.css')
        if (cancelled || !mapContainer.current) return
        const geom = JSON.parse(data.geometryGeojson!)
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
            paint: { 'fill-color': '#2f7d4f', 'fill-opacity': 0.14 },
          })
          map.addLayer({
            id: 'area-outline-line',
            type: 'line',
            source: 'area-outline',
            paint: { 'line-color': '#2f7d4f', 'line-width': 2.5 },
          })
          if (markers.length > 0) {
            map.addSource('area-markers', {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: markers.map((m) => ({
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [m.longitude, m.latitude] },
                  properties: {},
                })),
              },
            })
            map.addLayer({
              id: 'area-marker-points',
              type: 'circle',
              source: 'area-markers',
              paint: {
                'circle-radius': 6,
                'circle-color': '#c94a2c',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.9,
              },
            })
          }
          try {
            const coords: [number, number][] = []
            const walk = (v: unknown): void => {
              if (
                Array.isArray(v) && v.length === 2 &&
                typeof v[0] === 'number' && typeof v[1] === 'number'
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
                { padding: 32, animate: false, maxZoom: 16 },
              )
            }
          } catch {
            /* ignore - map still shows outline */
          }
        })
      } catch (err) {
        if (!cancelled) {
          setMapError('Map could not load. The report list below is still complete.')
        }
        // eslint-disable-next-line no-console
        console.warn('AreaDetailPage: failed to init MapLibre', err)
      }
    })()
    return () => {
      cancelled = true
      if (mapInstance && typeof (mapInstance as { remove?: () => void }).remove === 'function') {
        try { (mapInstance as { remove: () => void }).remove() } catch { /* ignore */ }
      }
    }
    // geometry_version is the AC 6.3.1 cache-bust signal; keying the
    // effect on it re-runs when the OSM boundary is re-imported.
  }, [data?.geometryGeojson, data?.geometryVersion, markers])

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
  const windowFrom = new Date(data.windowStartUtc).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const windowTo = new Date(data.windowEndUtc).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const trend = trendCopy(i.changeDirection as Direction, i.changePct, i.tolerancePct)
  const filtersActive = Boolean(plant || status)

  return (
    <main className="area-detail">
      <Link to="/areas" className="area-detail__back">
        <Icon name="ChevronLeft" size={16} color="currentColor" />
        Back to adopted areas
      </Link>

      <header className="area-detail__title">
        <span className="area-detail__type">
          <Icon name="MapPin" size={13} color="var(--green-dark)" />
          {data.placeType}
        </span>
        <h1>{data.placeName}</h1>
        <p className="area-detail__window">
          Community reports · {windowFrom} – {windowTo}
        </p>
      </header>

      <section className="area-detail__map" aria-label="Area outline and community reports">
        <div ref={mapContainer} className="area-detail__map-canvas" />
        {mapError && (
          <p className="area-detail__map-error" role="status">{mapError}</p>
        )}
        <div className="area-detail__map-legend" aria-hidden>
          <span className="area-detail__map-legend-swatch area-detail__map-legend-swatch--area" />
          <span>Area boundary</span>
          <span className="area-detail__map-legend-swatch area-detail__map-legend-swatch--marker" />
          <span>Community report</span>
        </div>
      </section>

      {/* AC 6.3.3 - client-selectable filters as chip rows: works on mobile
          without a native select tap, plumbed straight to the same
          backend query params, and every applied filter reflects in the
          KPIs, map layer and report feed below. */}
      <section className="area-detail__filters" aria-label="Filter community reports">
        <div className="area-detail__filter-row" role="radiogroup" aria-label="Time window">
          <span className="area-detail__filter-row-label">Window</span>
          <div className="area-detail__filter-chips">
            {PERIOD_OPTIONS.map((opt) => {
              const on = periodDays === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`area-detail__chip${on ? ' area-detail__chip--on' : ''}`}
                  onClick={() => setPeriodDays(opt.value)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="area-detail__filter-row" role="radiogroup" aria-label="Filter by status">
          <span className="area-detail__filter-row-label">Status</span>
          <div className="area-detail__filter-chips">
            <button
              type="button"
              role="radio"
              aria-checked={!status}
              className={`area-detail__chip${!status ? ' area-detail__chip--on' : ''}`}
              onClick={() => setStatus('')}
            >
              Any
            </button>
            {STATUS_OPTIONS.map((opt) => {
              const on = status === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`area-detail__chip${on ? ' area-detail__chip--on' : ''}`}
                  onClick={() => setStatus(opt.value)}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {plantOptions.length > 0 && (
          <div className="area-detail__filter-row" role="radiogroup" aria-label="Filter by plant">
            <span className="area-detail__filter-row-label">Plant</span>
            <div className="area-detail__filter-chips area-detail__filter-chips--scroll">
              <button
                type="button"
                role="radio"
                aria-checked={!plant}
                className={`area-detail__chip${!plant ? ' area-detail__chip--on' : ''}`}
                onClick={() => setPlant('')}
              >
                All
              </button>
              {plantOptions.map((opt) => {
                const on = plant === opt.speciesId
                return (
                  <button
                    key={opt.speciesId}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`area-detail__chip${on ? ' area-detail__chip--on' : ''}`}
                    onClick={() => setPlant(opt.speciesId)}
                    title={opt.plantName}
                  >
                    {opt.plantName}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="area-detail__filter-summary" aria-live="polite">
          {filtersActive ? (
            <>
              <span className="area-detail__filter-count">
                {[plant, status].filter(Boolean).length} filter
                {[plant, status].filter(Boolean).length === 1 ? '' : 's'} active
              </span>
              <button
                type="button"
                className="area-detail__filter-clear"
                onClick={() => { setPlant(''); setStatus('') }}
              >
                Clear
              </button>
            </>
          ) : (
            <span className="area-detail__filter-count area-detail__filter-count--muted">
              Showing all community reports in this window
            </span>
          )}
          {isFetching && (
            <span className="area-detail__filter-status" role="status">Updating…</span>
          )}
        </div>
      </section>

      <section className="area-detail__headline" aria-labelledby="detail-headline">
        <div className="area-detail__headline-metric">
          <span className="area-detail__headline-value">{i.reportsNew30d}</span>
          <span id="detail-headline" className="area-detail__headline-label">
            {periodDays === 30 ? 'New reports this month' : `Reports in last ${periodDays}d`}
          </span>
        </div>
        <p className="area-detail__headline-trend">{trend}</p>
      </section>

      <section className="area-detail__kpi-grid" aria-label="Activity indicators">
        <article className="area-detail__kpi">
          <span className="area-detail__kpi-icon" aria-hidden><Icon name="MapPin" size={14} color="currentColor" /></span>
          <span className="area-detail__kpi-value">{i.activeSightingCount}</span>
          <span className="area-detail__kpi-label">Ongoing sightings</span>
        </article>
        <article className="area-detail__kpi">
          <span className="area-detail__kpi-icon" aria-hidden><Icon name="Leaf" size={14} color="currentColor" /></span>
          <span className="area-detail__kpi-value">{i.distinctSpeciesCount}</span>
          <span className="area-detail__kpi-label">Different plants</span>
        </article>
        <article className="area-detail__kpi">
          <span className="area-detail__kpi-icon" aria-hidden><Icon name="Check" size={14} color="currentColor" /></span>
          <span className="area-detail__kpi-value">{i.removalReported30d}</span>
          <span className="area-detail__kpi-label">Cleared by community</span>
        </article>
        <article className="area-detail__kpi">
          <span className="area-detail__kpi-icon" aria-hidden><Icon name="Clock" size={14} color="currentColor" /></span>
          <span className="area-detail__kpi-value">
            {i.daysSinceMostRecent === null ? '—' : i.daysSinceMostRecent === 0 ? 'Today' : `${i.daysSinceMostRecent}d`}
          </span>
          <span className="area-detail__kpi-label">Last report</span>
        </article>
      </section>

      {speciesBreakdown.length > 0 && (
        <section className="area-detail__section" aria-labelledby="species-heading">
          <h2 id="species-heading">Plants reported here</h2>
          <ul className="area-detail__species-list">
            {speciesBreakdown.map((s) => (
              <li key={s.speciesId} className="area-detail__species-row">
                <Link to={`/plants/${s.speciesId}`} className="area-detail__species-link">
                  <span className="area-detail__species-icon" aria-hidden>
                    <Icon name="Leaf" size={16} color="var(--green-dark)" />
                  </span>
                  <span className="area-detail__species-name">
                    <strong>{s.plantName}</strong>
                    {s.plantCommonName && <span> · {s.plantCommonName}</span>}
                  </span>
                </Link>
                <span className="area-detail__species-count">
                  {s.count} {s.count === 1 ? 'report' : 'reports'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="area-detail__section" aria-labelledby="reports-heading">
        <h2 id="reports-heading">
          Recent reports
          <span className="area-detail__section-count">{markers.length}</span>
        </h2>
        {markers.length === 0 ? (
          <p className="area-detail__empty">
            {filtersActive
              ? 'No community reports match the current filters.'
              : 'No community reports in this window.'}
          </p>
        ) : (
          <ol className="area-detail__reports">
            {markers.slice(0, 50).map((m) => (
              <li key={m.sightingId} className="area-detail__report">
                <div className="area-detail__report-head">
                  <span className="area-detail__report-name">
                    {m.plantName ?? m.speciesId}
                    {m.plantCommonName && (
                      <span className="area-detail__report-common"> · {m.plantCommonName}</span>
                    )}
                  </span>
                  <span className={`area-detail__report-status area-detail__report-status--${(m.currentStatus ?? m.status).toLowerCase()}`}>
                    {STATUS_LABEL[(m.currentStatus ?? m.status).toLowerCase()] ?? (m.currentStatus ?? m.status).replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="area-detail__report-meta">
                  <Icon name="CalendarDays" size={12} color="var(--muted)" />
                  Observed{' '}
                  {new Date(m.observationDate ?? m.observedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  {m.clusterId !== null && (
                    <>
                      {' · '}
                      <Icon name="Grid3x3" size={12} color="var(--muted)" />
                      Cluster {m.clusterId + 1}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.clusters.length > 0 && (
        <section className="area-detail__section" aria-labelledby="clusters-heading">
          <h2 id="clusters-heading">Recent reporting concentration</h2>
          <p className="area-detail__section-hint">
            Areas where multiple reports have come in close together this month.
          </p>
          <ul className="area-detail__clusters">
            {data.clusters.map((c) => (
              <li key={c.clusterId}>
                <span className="area-detail__cluster-badge">Cluster {c.clusterId + 1}</span>
                <span className="area-detail__cluster-meta">
                  {c.pointCount} {c.pointCount === 1 ? 'sighting' : 'sightings'} ·
                  {' '}{c.speciesIds.length} {c.speciesIds.length === 1 ? 'plant' : 'plants'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

export default AreaDetailPage
