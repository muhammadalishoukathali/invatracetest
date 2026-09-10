/** Iteration 2 Phase 7 - Epic 6 adopted-area detail view (AC 6.3.*).
 *
 *  Renders the indicator bundle for one adopted area plus a
 *  DBSCAN-clustered marker list from GET /adopted-areas/{id}/activity.
 *  MapLibre is not loaded here to keep this page's own chunk small - a
 *  future Phase 8 patch can lazy-load AreaActivityMap; the cluster
 *  table here is already keyboard-reachable and screen-reader legible.
 *  Copy: "Recent reporting concentration" per AC 6.3.4 -
 *  deliberately never "invasion density".
 */
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { fetchAdoptionActivity } from '@/services/adopted-areas'


export function AreaDetailPage() {
  const { adoptionId } = useParams<{ adoptionId: string }>()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['adopted-area-activity', adoptionId],
    queryFn: () => fetchAdoptionActivity(adoptionId!),
    enabled: Boolean(adoptionId),
    staleTime: 30_000,
  })

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
        <h2>Sightings in this window ({data.markers.length})</h2>
        {data.markers.length === 0 ? (
          <p>No active sightings inside this area in the last 30 days.</p>
        ) : (
          <ol className="area-detail__marker-list">
            {data.markers.slice(0, 50).map((m) => (
              <li key={m.sightingId}>
                <span className="area-detail__marker-species">{m.speciesId}</span>
                <span className="area-detail__marker-status">{m.status}</span>
                <span>
                  {new Date(m.observedAt).toLocaleDateString()}
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
