/** Wave 2c — bottom sheet / modal that fronts a single place after the
 *  user clicks its polygon on the map. Fires both the place metadata
 *  and the plant-association queries in parallel; degrades gracefully
 *  when the Wave 2c extension fields (interpretation, versions) are
 *  missing so the UI can ship before/after the backend rewrite lands.
 */
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import {
  usePlace,
  usePlantAssociations,
  type PlantAssociation,
  type PlantAssociationsResponse,
} from '@/services/place-discovery'
import { PlantAssociationCard } from './PlantAssociationCard'

export const DEFAULT_INTERPRETATION =
  'Historical observations do not guarantee current presence.'
export const EMPTY_STATE_COPY = 'No qualifying historical records found.'
export const ERROR_STATE_COPY =
  'Could not load recorded plants. Try again in a moment.'

/** Pure footer render — separate so unit tests can assert the
 *  omit-when-both-missing contract without instantiating a MapLibre
 *  map or a QueryClient. */
export function DataVersionFooter({
  processedDataVersion,
  osmSourceVersion,
}: {
  processedDataVersion?: string
  osmSourceVersion?: string
}) {
  if (!processedDataVersion && !osmSourceVersion) return null
  return (
    <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--muted)' }}>
      Occurrence data: {processedDataVersion ?? '—'}, OSM: {osmSourceVersion ?? '—'}
    </p>
  )
}

/** Pure body render for tests. */
export function PlaceSheetBody({
  associations,
  interpretation,
  processedDataVersion,
  osmSourceVersion,
  placeId,
}: {
  associations: PlantAssociation[]
  interpretation?: string
  processedDataVersion?: string
  osmSourceVersion?: string
  placeId: string
}) {
  return (
    <>
      {associations.length === 0 ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>{EMPTY_STATE_COPY}</p>
          <p style={{ marginTop: 10, fontSize: 13 }}>
            <Link
              to="/plants"
              style={{
                display: 'inline-flex', gap: 6, alignItems: 'center',
                color: 'var(--accent)',
              }}
            >
              Browse the full plant catalogue
              <Icon name="ChevronRight" size={14} color="currentColor" />
            </Link>
          </p>
        </div>
      ) : (
        <ul
          aria-label="Recorded invasive plants at this place"
          style={{
            listStyle: 'none', padding: 0, marginTop: 12,
            display: 'grid', gap: 12,
          }}
        >
          {associations.map((item) => (
            <PlantAssociationCard key={item.speciesId} item={item} />
          ))}
        </ul>
      )}
      <p role="note" style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--body)' }}>
        {interpretation ?? DEFAULT_INTERPRETATION}
      </p>
      <p style={{ margin: '10px 0 0', fontSize: 13 }}>
        <Link
          to={`/places/${encodeURIComponent(placeId)}/plants`}
          style={{
            display: 'inline-flex', gap: 6, alignItems: 'center',
            color: 'var(--accent)',
          }}
        >
          View full page
          <Icon name="ChevronRight" size={14} color="currentColor" />
        </Link>
      </p>
      <DataVersionFooter
        processedDataVersion={processedDataVersion}
        osmSourceVersion={osmSourceVersion}
      />
    </>
  )
}

type Props = {
  placeId: string | null
  onClose: () => void
}

export function PlaceDiscoverySheet({ placeId, onClose }: Props) {
  const place = usePlace(placeId)
  const assoc = usePlantAssociations(placeId)
  const headingId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const active = placeId !== null
  useDialogA11y(dialogRef, onClose, { active })

  // Keep hook order stable — early-return happens after all hook calls.
  useEffect(() => {
    // no-op; here for parity if we later want to focus first control
  }, [placeId])

  if (!placeId) return null

  const loading = place.isPending || assoc.isPending
  const errored = place.isError || assoc.isError
  const response = assoc.data as PlantAssociationsResponse | undefined

  return createPortal(
    <>
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40,
        }}
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        style={{
          position: 'fixed', zIndex: 50,
          bottom: 0, left: 0, right: 0, maxHeight: '80vh',
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: 16, overflowY: 'auto',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close place details"
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}
        >
          <Icon name="X" size={18} color="var(--body)" />
        </button>
        <header>
          <h2 id={headingId} style={{ margin: 0, fontSize: 16 }}>
            {place.data?.displayName ?? 'Place details'}
          </h2>
          {place.data && (
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              {place.data.placeType}
              {place.data.geometryVersion && (
                <> · OpenStreetMap · {place.data.geometryVersion}</>
              )}
            </p>
          )}
        </header>
        <button
          type="button"
          disabled
          aria-label="Plants historically recorded nearby"
          style={{
            marginTop: 10, padding: '6px 10px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-chip)',
            background: 'var(--surface-alt, transparent)',
            fontSize: 12, fontWeight: 600, cursor: 'default',
          }}
        >
          {loading ? 'Loading…' : 'Plants historically recorded nearby'}
        </button>
        {errored ? (
          <p role="alert" style={{ margin: '12px 0 0', fontSize: 13 }}>
            {ERROR_STATE_COPY}
          </p>
        ) : loading ? (
          <p style={{ margin: '12px 0 0', fontSize: 13 }} aria-busy>
            Loading recorded plants…
          </p>
        ) : (
          <PlaceSheetBody
            associations={response?.associations ?? []}
            interpretation={response?.interpretation}
            processedDataVersion={response?.processedDataVersion}
            osmSourceVersion={response?.osmSourceVersion}
            placeId={placeId}
          />
        )}
      </aside>
    </>,
    document.body,
  )
}
