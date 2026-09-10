/** Iteration 2 Phase 7 - Epic 6 adopted-areas dashboard (AC 6.2.*).
 *
 *  Lists everything the current identity has adopted, with the 30-day
 *  indicator bundle rendered per row. Empty state per AC 6.2.6 is a
 *  plain explanation - never a fabricated KPI (no "0 in a badge"
 *  masquerading as data). Sort is server-side (see AreasSort in the
 *  service) so the empty state and the sort read from one source.
 *  Copy: "Community monitoring activity" per AC 6.2.4 - deliberately
 *  never says "health score", never says "invasion density".
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

import {
  listAdoptedAreas,
  removeAdoption,
  type AdoptedAreaSort,
  type AdoptedAreaSummary,
  type ChangeDirection,
} from '@/services/adopted-areas'


function ChangePill({ direction, pct, tolerance }: {
  direction: ChangeDirection
  pct: number | null
  tolerance: number
}) {
  if (direction === 'insufficient_history') {
    return (
      <span className="areas-page__change areas-page__change--muted">
        Not enough history yet
      </span>
    )
  }
  if (direction === 'unchanged') {
    return (
      <span className="areas-page__change areas-page__change--flat">
        Steady (within ±{tolerance}% of the previous 30 days)
      </span>
    )
  }
  const arrow = direction === 'increase' ? '▲' : '▼'
  const cls = direction === 'increase'
    ? 'areas-page__change--up'
    : 'areas-page__change--down'
  return (
    <span className={`areas-page__change ${cls}`}>
      {arrow} {pct !== null ? `${Math.abs(pct).toFixed(0)}%` : ''} vs the previous 30 days
    </span>
  )
}


function AreaRow({ item, onRemove, removing }: {
  item: AdoptedAreaSummary
  onRemove: (id: string) => void
  removing: boolean
}) {
  const i = item.indicators
  return (
    <li className="areas-page__row">
      <div className="areas-page__row-head">
        <Link to={`/areas/${item.adoptionId}`} className="areas-page__row-name">
          {item.placeName}
        </Link>
        <button
          type="button"
          className="areas-page__row-remove"
          disabled={removing}
          onClick={() => onRemove(item.adoptionId)}
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </div>
      <p className="areas-page__row-meta">
        {item.placeType} · adopted {new Date(item.adoptedAt).toLocaleDateString()}
      </p>
      <dl className="areas-page__row-indicators">
        <div>
          <dt>Active sightings</dt>
          <dd>{i.activeSightingCount}</dd>
        </div>
        <div>
          <dt>Distinct species</dt>
          <dd>{i.distinctSpeciesCount}</dd>
        </div>
        <div>
          <dt>Reports (last {i.windowDays}d)</dt>
          <dd>{i.reportsNew30d}</dd>
        </div>
        <div>
          <dt>Removals reported</dt>
          <dd>{i.removalReported30d}</dd>
        </div>
        <div>
          <dt>Most recent</dt>
          <dd>{i.daysSinceMostRecent === null
            ? 'None yet'
            : `${i.daysSinceMostRecent}d ago`}</dd>
        </div>
      </dl>
      <ChangePill
        direction={i.changeDirection}
        pct={i.changePct}
        tolerance={i.tolerancePct}
      />
    </li>
  )
}


export function AreasPage() {
  const [sort, setSort] = useState<AdoptedAreaSort>('adopted_at')
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['adopted-areas', sort],
    queryFn: () => listAdoptedAreas(sort),
    staleTime: 30_000,
  })

  const removeMutation = useMutation({
    mutationFn: (adoptionId: string) => removeAdoption(adoptionId),
    onMutate: (adoptionId: string) => setPendingRemoval(adoptionId),
    onSettled: async () => {
      setPendingRemoval(null)
      await queryClient.invalidateQueries({ queryKey: ['adopted-areas'] })
    },
  })

  return (
    <main className="areas-page">
      <header className="areas-page__header">
        <h1>Adopted areas</h1>
        <p className="areas-page__subtitle">
          Community monitoring activity for the places you have adopted.
        </p>
      </header>

      <div className="areas-page__controls">
        <label htmlFor="areas-sort" className="areas-page__sort-label">
          Sort by
        </label>
        <select
          id="areas-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as AdoptedAreaSort)}
        >
          <option value="adopted_at">Recently adopted</option>
          <option value="place_name">Place name (A–Z)</option>
          <option value="active_sighting_count">Active sightings</option>
          <option value="reports_new_30d">Reports (last 30d)</option>
        </select>
      </div>

      {isLoading && (
        <p className="areas-page__status" role="status" aria-live="polite">
          Loading adopted areas…
        </p>
      )}
      {isError && (
        <div className="areas-page__error" role="alert">
          Could not load adopted areas.{' '}
          <button type="button" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {data && data.items.length === 0 && !isLoading && (
        <section className="areas-page__empty">
          <h2>Nothing adopted yet</h2>
          <p>
            After you submit a report, you can adopt the surrounding area to see
            what the community has been finding there in the last 30 days.
          </p>
        </section>
      )}

      {data && data.items.length > 0 && (
        <>
          <p className="areas-page__count">
            {data.total} of {data.maxPerIdentity} slots used
          </p>
          <ul className="areas-page__list">
            {data.items.map((item) => (
              <AreaRow
                key={item.adoptionId}
                item={item}
                onRemove={(id) => removeMutation.mutate(id)}
                removing={pendingRemoval === item.adoptionId}
              />
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
