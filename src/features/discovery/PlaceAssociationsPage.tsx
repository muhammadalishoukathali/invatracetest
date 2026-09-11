/** Iteration 2 Phase 5 - Epic 5.1 place-based plant discovery page.
 *
 *  Reached from the map ("View plants recorded nearby") or by direct
 *  navigation to /places/:placeId/plants. Renders the ranked plant list
 *  the server returns without ever re-deriving weights or thresholds
 *  client-side (AC 7.3.1). Places whose geometry is ``unsupported``
 *  short-circuit to a coverage-not-available card instead of an empty
 *  list, which would look identical to "no invasive plants recorded".
 *
 *  Every card links back to the catalogue via ``catalogueLink`` so the
 *  user can dig into a species without leaving the discovery flow.
 */
import { Link, useParams } from 'react-router-dom'

import { Icon } from '@/components/Icon'
import {
  usePlace,
  usePlantAssociations,
  type EvidenceComponent,
  type PlantAssociation,
} from '@/services/place-discovery'

const EVIDENCE_LABEL: Record<EvidenceComponent['kind'], string> = {
  inside: 'Inside this place',
  nearby: 'Recorded nearby',
  upstream_waterway: 'Upstream along a waterway',
}

// AC 5.1.6 - Malaysian invasive-status badge copy for the three
// evidence-code buckets. Kept short so the card stays scannable.
const STATUS_LABEL: Record<'G' | 'A' | 'B', string> = {
  G: 'GRIIS-listed',
  A: 'Agriculture-flagged',
  B: 'Biosecurity-listed',
}

export function PlaceAssociationsPage() {
  const { placeId } = useParams<{ placeId: string }>()
  const place = usePlace(placeId)
  const assoc = usePlantAssociations(placeId)

  if (!placeId) {
    return <NotFound />
  }
  if (place.isPending || assoc.isPending) {
    return (
      <section aria-busy style={{ padding: 20 }}>
        <p>Loading recorded plants for this place...</p>
      </section>
    )
  }
  if (place.isError || !place.data) {
    return <NotFound />
  }
  if (place.data.geometryStatus === 'unsupported') {
    return (
      <section style={{ padding: 20 }}>
        <h1 style={{ marginTop: 0 }}>{place.data.displayName}</h1>
        <p>
          Coverage for occurrence-based plant discovery is not available at
          this place yet. We surface this state explicitly so an empty
          screen never gets misread as "no invasive plants found here".
        </p>
      </section>
    )
  }
  if (assoc.isError || !assoc.data) {
    return (
      <section style={{ padding: 20 }}>
        <h1 style={{ marginTop: 0 }}>{place.data.displayName}</h1>
        <p>Could not load the recorded plants for this place. Try again in a moment.</p>
      </section>
    )
  }

  const { associations, catalogueVersion, occurrenceDataUpdatedAt, disclaimer } = assoc.data
  return (
    <section style={{ padding: 20, maxWidth: 720 }} aria-live="polite">
      <header>
        <h1 style={{ marginTop: 0 }}>Plants recorded at {place.data.displayName}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Catalogue {catalogueVersion}
          {occurrenceDataUpdatedAt && (
            <>
              {' · '}Occurrence data refreshed{' '}
              {new Date(occurrenceDataUpdatedAt).toLocaleDateString()}
            </>
          )}
        </p>
      </header>
      <p
        role="note"
        style={{
          marginTop: 12,
          padding: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)',
          fontSize: 12.5,
          color: 'var(--body)',
        }}
      >
        {disclaimer}
      </p>
      {associations.length === 0 ? (
        <div style={{ marginTop: 24 }}>
          <p style={{ margin: 0 }}>No qualifying historical records found.</p>
          <p style={{ marginTop: 10, fontSize: 13 }}>
            <Link
              to="/plants"
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
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
          style={{ listStyle: 'none', padding: 0, marginTop: 20, display: 'grid', gap: 12 }}
        >
          {associations.map((item) => (
            <PlantAssociationCard key={item.speciesId} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PlantAssociationCard({ item }: { item: PlantAssociation }) {
  return (
    <li
      style={{
        padding: 14,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* AC 5.1.6 - reference image, or a Leaf-icon placeholder square
            when the species has no image yet. The placeholder keeps the
            grid alignment stable so a mixed image/no-image list still
            reads as one column of cards. */}
        {item.referenceImageUrl ? (
          <img
            src={item.referenceImageUrl}
            alt={item.scientificName}
            width={56}
            height={56}
            style={{
              width: 56,
              height: 56,
              objectFit: 'cover',
              borderRadius: 8,
              border: '1px solid var(--border)',
              flex: '0 0 auto',
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-alt, transparent)',
              flex: '0 0 auto',
            }}
          >
            <Icon name="Leaf" size={22} color="var(--accent)" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{item.scientificName}</h2>
          {item.commonNames.length > 0 && (
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              {item.commonNames.join(', ')}
            </p>
          )}
          {/* AC 5.1.6 - Malaysian invasive status. Show the evidence-code
              badges even when the states list is empty so the user knows
              the plant is on the catalogue at all. */}
          {(item.evidenceCodes.length > 0 || item.malaysianStates.length > 0) && (
            <ul
              aria-label="Malaysian invasive status"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '8px 0 0',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {item.evidenceCodes.map((code) => (
                <li
                  key={`code-${code}`}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-alt, transparent)',
                    fontWeight: 600,
                  }}
                >
                  {STATUS_LABEL[code as 'G' | 'A' | 'B'] ?? code}
                </li>
              ))}
              {item.malaysianStates.map((state) => (
                <li
                  key={`state-${state}`}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px dashed var(--border)',
                    color: 'var(--muted)',
                  }}
                >
                  {state}
                </li>
              ))}
            </ul>
          )}
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '10px 0 0',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {item.evidence.map((component) => (
              <li
                key={component.kind}
                style={{
                  fontSize: 11.5,
                  padding: '3px 8px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-alt, transparent)',
                }}
              >
                {EVIDENCE_LABEL[component.kind]}
                {/* AC 5.1.6 - inside-area evidence renders the explicit
                    "Inside this area" copy, never a "· 0 m" distance. */}
                {component.kind === 'inside' ? (
                  <> · Inside this area</>
                ) : (
                  component.distanceM !== null && (
                    <> · {Math.round(component.distanceM)} m</>
                  )
                )}
                {component.qualifyingRecords > 1 && (
                  <> · {component.qualifyingRecords} records</>
                )}
                {component.mostRecentYear !== null && (
                  <> · last {component.mostRecentYear}</>
                )}
              </li>
            ))}
          </ul>
          {item.directionAwareEvidence && (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>
              Upstream evidence uses OSM flow direction; segments without a
              known direction are not counted.
            </p>
          )}
          <Link
            to={item.catalogueLink}
            style={{
              marginTop: 10,
              display: 'inline-flex',
              gap: 6,
              alignItems: 'center',
              fontSize: 12.5,
              color: 'var(--accent)',
            }}
          >
            View catalogue entry
            <Icon name="ChevronRight" size={14} color="currentColor" />
          </Link>
        </div>
      </div>
    </li>
  )
}

function NotFound() {
  return (
    <section style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Place not found</h1>
      <p>Pick a place from the map to see plants recorded there.</p>
    </section>
  )
}
