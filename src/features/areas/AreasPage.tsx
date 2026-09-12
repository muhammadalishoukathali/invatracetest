/** Iteration 2 Phase 7 - Epic 6 adopted-areas dashboard (AC 6.2.*).
 *
 *  Priority order on-screen:
 *    1. Each adopted area's headline metric ("sightings this month") and
 *       its plain-English trend statement.
 *    2. A subtle sort chip + adoption-slot chip.
 *    3. A discover section under the list for adopting a new place.
 *  Empty state (AC 6.2.6) never fabricates a KPI. Sort is server-side
 *  (AC 6.2.5). Copy: "Community monitoring activity" per AC 6.2.4.
 *  Remove is a proper modal dialog (Escape / backdrop dismiss) so an
 *  accidental tap on a card footer never destroys the adoption.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

import {
  adoptArea,
  listAdoptedAreas,
  removeAdoption,
  type AdoptedAreaSort,
  type AdoptedAreaSummary,
  type ChangeDirection,
} from '@/services/adopted-areas'
import { usePlaces, type PlaceListItem } from '@/services/place-discovery'
import { Icon } from '@/components/Icon'
import './areas-page.css'


function trendStatement(direction: ChangeDirection, pct: number | null, tolerance: number) {
  if (direction === 'insufficient_history') return 'Not enough history yet to spot a trend.'
  if (direction === 'unchanged') return `Steady - within ${tolerance}% of the previous month.`
  const abs = pct !== null ? `${Math.abs(pct).toFixed(0)}%` : ''
  if (direction === 'increase') {
    return pct === null
      ? 'Reports rose from none in the previous month.'
      : `Reports rose ${abs} vs the previous month.`
  }
  return `Reports fell ${abs} vs the previous month.`
}


function ChangePill({ direction, pct, tolerance }: {
  direction: ChangeDirection
  pct: number | null
  tolerance: number
}) {
  if (direction === 'insufficient_history') {
    return (
      <span className="areas-page__change areas-page__change--muted">
        <Icon name="Clock" size={13} color="currentColor" />
        New — no trend yet
      </span>
    )
  }
  if (direction === 'unchanged') {
    return (
      <span className="areas-page__change areas-page__change--flat">
        <Icon name="Minus" size={13} color="currentColor" />
        Steady (±{tolerance}%)
      </span>
    )
  }
  const isUp = direction === 'increase'
  return (
    <span className={`areas-page__change ${isUp ? 'areas-page__change--up' : 'areas-page__change--down'}`}>
      <Icon name={isUp ? 'ArrowUpRight' : 'ArrowDownRight'} size={13} color="currentColor" />
      {pct !== null ? `${Math.abs(pct).toFixed(0)}%` : ''} this month
    </span>
  )
}


function AreaCard({ item, onAskRemove }: {
  item: AdoptedAreaSummary
  onAskRemove: (item: AdoptedAreaSummary) => void
}) {
  const i = item.indicators
  const trend = trendStatement(i.changeDirection, i.changePct, i.tolerancePct)
  return (
    <li className="areas-card">
      <Link to={`/areas/${item.adoptionId}`} className="areas-card__link" aria-label={`Open activity for ${item.placeName}`}>
        <div className="areas-card__title-row">
          <div className="areas-card__title-body">
            <span className="areas-card__type">
              <Icon name="MapPin" size={13} color="var(--green-dark)" />
              {item.placeType}
            </span>
            <h3 className="areas-card__title">{item.placeName}</h3>
          </div>
          <Icon name="ChevronRight" size={20} color="var(--muted)" />
        </div>

        <div className="areas-card__feature">
          <div className="areas-card__feature-metric">
            <span className="areas-card__feature-value">{i.reportsNew30d}</span>
            <span className="areas-card__feature-label">New reports this month</span>
          </div>
          <ChangePill
            direction={i.changeDirection}
            pct={i.changePct}
            tolerance={i.tolerancePct}
          />
        </div>
        <p className="areas-card__trend">{trend}</p>

        <dl className="areas-card__stats">
          <div>
            <dt>Ongoing sightings</dt>
            <dd>{i.activeSightingCount}</dd>
          </div>
          <div>
            <dt>Plants seen</dt>
            <dd>{i.distinctSpeciesCount}</dd>
          </div>
          <div>
            <dt>Cleared</dt>
            <dd>{i.removalReported30d}</dd>
          </div>
          <div>
            <dt>Last report</dt>
            <dd>{i.daysSinceMostRecent === null
              ? '—'
              : i.daysSinceMostRecent === 0
                ? 'Today'
                : `${i.daysSinceMostRecent}d ago`}</dd>
          </div>
        </dl>
      </Link>

      <footer className="areas-card__foot">
        <span className="areas-card__adopted-at">
          Adopted {new Date(item.adoptedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <button
          type="button"
          className="areas-card__remove"
          aria-label={`Stop monitoring ${item.placeName}`}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onAskRemove(item) }}
        >
          <Icon name="Trash2" size={14} color="currentColor" />
          <span>Remove</span>
        </button>
      </footer>
    </li>
  )
}


function RemoveModal({ item, removing, onConfirm, onClose }: {
  item: AdoptedAreaSummary
  removing: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  return createPortal(
    <div className="areas-modal-scrim" role="dialog" aria-modal="true" aria-labelledby="remove-title" onClick={onClose}>
      <div className="areas-modal" onClick={(e) => e.stopPropagation()}>
        <div className="areas-modal__icon" aria-hidden><Icon name="Trash2" size={22} color="var(--red-text, #a12c1c)" /></div>
        <h2 id="remove-title" className="areas-modal__title">Stop monitoring this area?</h2>
        <p className="areas-modal__body">
          <strong>{item.placeName}</strong> will be removed from your adopted areas.
          You can adopt it again later — its community reports stay on the map.
        </p>
        <div className="areas-modal__actions">
          <button
            type="button"
            className="areas-modal__cancel"
            onClick={onClose}
            disabled={removing}
          >
            Keep monitoring
          </button>
          <button
            type="button"
            ref={confirmRef}
            className="areas-modal__confirm"
            onClick={onConfirm}
            disabled={removing}
          >
            {removing ? 'Removing…' : 'Yes, remove'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}


function SortChips({ value, onChange }: {
  value: AdoptedAreaSort
  onChange: (v: AdoptedAreaSort) => void
}) {
  const options: { id: AdoptedAreaSort; label: string }[] = [
    { id: 'adopted_at', label: 'Recent' },
    { id: 'active_sighting_count', label: 'Sightings' },
    { id: 'reports_new_30d', label: 'Reports' },
    { id: 'place_name', label: 'A–Z' },
  ]
  return (
    <div className="areas-page__sort-chips" role="tablist" aria-label="Sort areas by">
      {options.map((opt) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`areas-page__sort-chip${active ? ' areas-page__sort-chip--on' : ''}`}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}


function DiscoverSection({ atCap, adoptedPlaceIds, onAdopted }: {
  atCap: boolean
  adoptedPlaceIds: Set<string>
  onAdopted: () => void
}) {
  const [query, setQuery] = useState('')
  const [adopting, setAdopting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const trimmed = query.trim()
  const placesQuery = usePlaces({ q: trimmed || undefined, limit: 8 })

  const adopt = async (place: PlaceListItem) => {
    setError(null)
    setAdopting(place.placeId)
    try {
      await adoptArea(place.placeId)
      onAdopted()
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not adopt this place.')
    } finally {
      setAdopting(null)
    }
  }

  return (
    <section className="areas-page__discover" aria-labelledby="discover-heading">
      <div className="areas-page__discover-head">
        <h2 id="discover-heading">Adopt another place</h2>
        <p>Search a park, forest or trail. Adopting starts a monthly activity summary for it.</p>
      </div>
      <div className="areas-page__discover-search">
        <Icon name="Search" size={16} color="var(--muted)" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by place name"
          aria-label="Search places to adopt"
          autoComplete="off"
        />
      </div>
      {atCap && (
        <p className="areas-page__discover-cap" role="status">
          You've reached the adoption limit. Remove an area above before adopting another.
        </p>
      )}
      {error && <p className="areas-page__discover-error" role="alert">{error}</p>}
      {placesQuery.isFetching && trimmed && (
        <p className="areas-page__discover-status" role="status" aria-live="polite">Searching…</p>
      )}
      {trimmed && placesQuery.data && placesQuery.data.items.length === 0 && (
        <p className="areas-page__discover-status">No places match “{trimmed}”.</p>
      )}
      {placesQuery.data && placesQuery.data.items.length > 0 && (
        <ul className="areas-page__discover-list" aria-label="Places you can adopt">
          {placesQuery.data.items.map((place) => {
            const alreadyAdopted = adoptedPlaceIds.has(place.placeId)
            const busy = adopting === place.placeId
            return (
              <li key={place.placeId} className="areas-page__discover-item">
                <div className="areas-page__discover-item-body">
                  <span className="areas-page__discover-item-name">{place.displayName}</span>
                  <span className="areas-page__discover-item-type">{place.placeType}</span>
                </div>
                <button
                  type="button"
                  className="areas-page__discover-adopt"
                  onClick={() => void adopt(place)}
                  disabled={busy || alreadyAdopted || atCap}
                >
                  {alreadyAdopted ? 'Adopted' : busy ? 'Adopting…' : (
                    <>
                      <Icon name="Plus" size={14} color="currentColor" />
                      Adopt
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}


export function AreasPage() {
  const [sort, setSort] = useState<AdoptedAreaSort>('adopted_at')
  const [pendingRemoval, setPendingRemoval] = useState<AdoptedAreaSummary | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['adopted-areas', sort],
    queryFn: () => listAdoptedAreas(sort),
    staleTime: 30_000,
  })

  const removeMutation = useMutation({
    mutationFn: (adoptionId: string) => removeAdoption(adoptionId),
    onSettled: async () => {
      setPendingRemoval(null)
      await queryClient.invalidateQueries({ queryKey: ['adopted-areas'] })
    },
  })

  const invalidateAdopted = () =>
    queryClient.invalidateQueries({ queryKey: ['adopted-areas'] })

  const adopted = data?.items ?? []
  const adoptedPlaceIds = new Set(adopted.map((a) => a.placeId))
  const total = data?.total ?? 0
  const maxPerIdentity = data?.maxPerIdentity ?? 20
  const atCap = data ? total >= maxPerIdentity : false

  return (
    <main className="areas-page">
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

      {data && adopted.length === 0 && !isLoading && (
        <section className="areas-page__empty">
          <div className="areas-page__empty-icon" aria-hidden>
            <Icon name="Bookmark" size={28} color="var(--green-dark)" />
          </div>
          <h2>Adopt your first place</h2>
          <p>
            Pick a park, forest or trail below to start a monthly activity
            summary for it. You'll see how many sightings, plants and
            clearances the community reported there.
          </p>
        </section>
      )}

      {adopted.length > 0 && (
        <>
          <header className="areas-page__intro">
            <h2 className="areas-page__intro-title">Community monitoring activity</h2>
            <p className="areas-page__intro-subtitle">
              A monthly summary of community reports across the places you've adopted.
            </p>
          </header>
          <div className="areas-page__controls">
            <SortChips value={sort} onChange={setSort} />
            <span className="areas-page__slots" title={`${total} of ${maxPerIdentity} adoption slots used`}>
              {total}/{maxPerIdentity}
            </span>
          </div>
          <ul className="areas-page__list" aria-label="My adopted areas">
            {adopted.map((item) => (
              <AreaCard
                key={item.adoptionId}
                item={item}
                onAskRemove={setPendingRemoval}
              />
            ))}
          </ul>
        </>
      )}

      <DiscoverSection
        atCap={atCap}
        adoptedPlaceIds={adoptedPlaceIds}
        onAdopted={invalidateAdopted}
      />

      {pendingRemoval && (
        <RemoveModal
          item={pendingRemoval}
          removing={removeMutation.isPending}
          onConfirm={() => removeMutation.mutate(pendingRemoval.adoptionId)}
          onClose={() => { if (!removeMutation.isPending) setPendingRemoval(null) }}
        />
      )}
    </main>
  )
}
