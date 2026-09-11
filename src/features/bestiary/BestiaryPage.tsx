/** Iteration 2 Phase 5 - Epic 5.2 plant catalogue browsing page.
 *
 *  Backed entirely by the server catalogue endpoints. We never hardcode
 *  the catalogue version, reviewed date, or the "invasive" list in copy
 *  (AC 5.2.1, 5.2.6). Search input is debounced client-side (150ms) but
 *  every match is decided server-side - the browser only lowercases +
 *  trims before sending. The results section is aria-live="polite" so a
 *  screen reader announces the updated match count when the user types.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '@/components/Icon'
import {
  useCatalogue,
  useCatalogueSearch,
  type CatalogueSpecies,
} from '@/services/catalogue'
import { useLimits } from '@/services/config-limits'

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(handle)
  }, [value, delayMs])
  return debounced
}

export function BestiaryPage() {
  const [rawQuery, setRawQuery] = useState('')
  const debounced = useDebouncedValue(rawQuery, 150)
  const trimmed = debounced.trim().toLowerCase()
  const searchActive = trimmed.length > 0

  const list = useCatalogue()
  const search = useCatalogueSearch(searchActive ? trimmed : '')
  const limits = useLimits()

  const active = searchActive ? search : list
  const items: CatalogueSpecies[] = active.data?.items ?? []

  // Prefer the catalogue endpoint's own version + reviewed date; fall back
  // to useLimits() only if the header data isn't loaded yet (still one
  // source of truth - both come from the server).
  const headerVersion =
    active.data?.catalogueVersion ?? list.data?.catalogueVersion ?? limits.data?.catalogueVersion ?? null
  const headerReviewed = active.data?.reviewedAt ?? list.data?.reviewedAt ?? null
  const headerTotal = active.data?.totalSpeciesCount ?? list.data?.totalSpeciesCount ?? null

  const statusLine = useMemo(() => {
    const bits: string[] = []
    if (headerVersion) bits.push(`Catalogue ${headerVersion}`)
    if (headerReviewed) bits.push(`Reviewed ${new Date(headerReviewed).toISOString().slice(0, 10)}`)
    if (headerTotal !== null) bits.push(`${headerTotal} species`)
    return bits.join(' · ')
  }, [headerVersion, headerReviewed, headerTotal])

  return (
    <main style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
      <header>
        <h1 style={{ marginTop: 0 }}>Plant catalogue</h1>
        {statusLine && (
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            {statusLine}
          </p>
        )}
      </header>

      <div style={{ marginTop: 16 }}>
        <label
          htmlFor="bestiary-search"
          style={{ display: 'block', fontSize: 13, marginBottom: 6 }}
        >
          Search the catalogue
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="bestiary-search"
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search scientific or common name"
            autoComplete="off"
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 'var(--r-card)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--body)',
              fontSize: 14,
            }}
          />
          {rawQuery && (
            <button type="button" onClick={() => setRawQuery('')}>
              Clear
            </button>
          )}
        </div>
      </div>

      <section
        aria-live="polite"
        aria-busy={active.isPending || active.isFetching}
        style={{ marginTop: 20 }}
      >
        {active.isPending && (
          <p role="status">Loading the catalogue…</p>
        )}
        {active.isError && (
          <p role="alert">
            Could not load the catalogue. Try again in a moment.
          </p>
        )}
        {!active.isPending && !active.isError && items.length === 0 && (
          <div>
            <p>No supported plants found</p>
            {rawQuery && (
              <button type="button" onClick={() => setRawQuery('')}>
                Clear search
              </button>
            )}
          </div>
        )}
        {items.length > 0 && (
          <ul
            aria-label="Catalogue species"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {items.map((species) => (
              <SpeciesCard key={species.speciesId} species={species} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function SpeciesCard({ species }: { species: CatalogueSpecies }) {
  return (
    <li
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Link
        to={`/plants/${species.speciesId}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div
          style={{
            aspectRatio: '4 / 3',
            background: 'var(--surface-alt, var(--surface))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {species.referenceImageUrl ? (
            <img
              src={species.referenceImageUrl}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Icon name="Leaf" size={32} color="var(--accent)" />
          )}
        </div>
        <div style={{ padding: 12 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              fontStyle: 'italic',
            }}
          >
            {species.scientificName}
          </h2>
          {species.commonNames.length > 0 && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              {species.commonNames.join(', ')}
            </p>
          )}
        </div>
      </Link>
    </li>
  )
}

export default BestiaryPage
