/** Wave 2c — Direction-Aware Place Association card.
 *
 *  Extracted from PlaceAssociationsPage so both the full page and the
 *  bottom-sheet share one rendering path. The Wave 2c backend adds a
 *  richer evidence shape (per-record uid + source URL + licence) plus a
 *  rank_components breakdown; both are surfaced here as optional props
 *  so the card degrades gracefully when the backend hasn't shipped yet.
 */
import { Link } from 'react-router-dom'

import { Icon } from '@/components/Icon'
import type { PlantAssociation, EvidenceRecord } from '@/services/place-discovery'

const STATUS_LABEL: Record<'G' | 'A' | 'B', string> = {
  G: 'GRIIS-listed',
  A: 'Agriculture-flagged',
  B: 'Biosecurity-listed',
}

/** True when any record in the new evidence array is of the given type. */
function hasEvidenceType(records: EvidenceRecord[] | undefined, type: string): boolean {
  return Boolean(records?.some((record) => record.type === type))
}

/** Pick the closest upstream record so the chip can render its network
 *  distance if the backend provided one. */
function upstreamRecord(records: EvidenceRecord[] | undefined): EvidenceRecord | undefined {
  return records?.find((record) => record.type === 'upstream_waterway')
}

export function PlantAssociationCard({ item }: { item: PlantAssociation }) {
  // Two evidence shapes are supported: the legacy `evidence:
  // EvidenceComponent[]` (with `kind`) and the Wave 2c `evidenceRecords:
  // EvidenceRecord[]` (with `type`). Merge signals so we can render the
  // right pill regardless of which shape the backend has shipped today.
  const insideByLegacy = item.evidence.some((component) => component.kind === 'inside')
  const upstreamByLegacy = item.evidence.some((component) => component.kind === 'upstream_waterway')
  const insideByRecords = hasEvidenceType(item.evidenceRecords, 'inside')
  const upstreamByRecords = hasEvidenceType(item.evidenceRecords, 'upstream_waterway')
  const isInside = item.insideArea || insideByLegacy || insideByRecords
  const isUpstream = item.directionAwareEvidence || upstreamByLegacy || upstreamByRecords
  const upstream = upstreamRecord(item.evidenceRecords)

  const rank = item.rankComponents
  const closestDistance =
    typeof item.closestDistanceM === 'number' && !isInside
      ? `${Math.round(item.closestDistanceM)} m from boundary`
      : null

  return (
    <li
      data-tier={rank?.tier ?? undefined}
      data-nearby-component={rank?.nearbyComponent ?? undefined}
      data-upstream-component={rank?.upstreamComponent ?? undefined}
      style={{
        padding: 14,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {item.referenceImageUrl ? (
          <img
            src={item.referenceImageUrl}
            alt={item.scientificName}
            width={56}
            height={56}
            style={{
              width: 56, height: 56, objectFit: 'cover', borderRadius: 8,
              border: '1px solid var(--border)', flex: '0 0 auto',
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, display: 'flex', alignItems: 'center',
              justifyContent: 'center', borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-alt, transparent)', flex: '0 0 auto',
            }}
          >
            <Icon name="Leaf" size={22} color="var(--accent)" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, fontStyle: 'italic' }}>
            {item.scientificName}
          </h3>
          {item.commonNames.length > 0 && (
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              {item.commonNames.join(', ')}
            </p>
          )}
          {(item.evidenceCodes.length > 0 || item.malaysianStates.length > 0) && (
            <ul
              aria-label="Malaysian invasive status"
              style={{
                listStyle: 'none', padding: 0, margin: '8px 0 0',
                display: 'flex', flexWrap: 'wrap', gap: 6,
              }}
            >
              {item.evidenceCodes.map((code) => (
                <li
                  key={`code-${code}`}
                  style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-alt, transparent)', fontWeight: 600,
                  }}
                >
                  {STATUS_LABEL[code as 'G' | 'A' | 'B'] ?? code}
                </li>
              ))}
              {item.malaysianStates.map((state) => (
                <li
                  key={`state-${state}`}
                  style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 999,
                    border: '1px dashed var(--border)', color: 'var(--muted)',
                  }}
                >
                  {state}
                </li>
              ))}
            </ul>
          )}
          <ul
            style={{
              listStyle: 'none', padding: 0, margin: '10px 0 0',
              display: 'flex', flexWrap: 'wrap', gap: 6,
            }}
          >
            {isInside ? (
              <li
                style={{
                  fontSize: 11.5, padding: '3px 8px', borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-alt, transparent)',
                }}
              >
                Inside this area
              </li>
            ) : closestDistance ? (
              <li
                style={{
                  fontSize: 11.5, padding: '3px 8px', borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-alt, transparent)',
                }}
              >
                {closestDistance}
              </li>
            ) : null}
            {isUpstream && (
              <li
                data-testid="upstream-chip"
                style={{
                  fontSize: 11.5, padding: '3px 8px', borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-alt, transparent)',
                  fontWeight: 600,
                }}
              >
                Upstream waterway record
                {upstream?.networkDistanceM != null && (
                  <> · {Math.round(upstream.networkDistanceM)} m along network</>
                )}
              </li>
            )}
          </ul>
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>
            Qualifying records: {item.qualifyingRecords}
            {item.mostRecentYear != null && <> · Most recent: {item.mostRecentYear}</>}
          </p>
          <Link
            to={item.catalogueLink}
            style={{
              marginTop: 10, display: 'inline-flex', gap: 6, alignItems: 'center',
              fontSize: 12.5, color: 'var(--accent)',
            }}
          >
            View catalogue entry
            <Icon name="ChevronRight" size={14} color="currentColor" />
          </Link>
          {item.evidenceRecords && item.evidenceRecords.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}>
                Sources ({item.evidenceRecords.length})
              </summary>
              <ul
                style={{
                  listStyle: 'none', padding: 0, margin: '6px 0 0',
                  display: 'grid', gap: 4,
                }}
              >
                {item.evidenceRecords.map((record, index) => (
                  <li key={record.occurrenceRecordUid ?? `${record.type}-${index}`} style={{ fontSize: 11.5 }}>
                    <span style={{ color: 'var(--muted)' }}>{record.type}</span>
                    {record.sourceUrl ? (
                      <>
                        {' — '}
                        <a href={record.sourceUrl} target="_blank" rel="noopener noreferrer">
                          {record.occurrenceRecordUid ?? 'record'}
                        </a>
                      </>
                    ) : record.occurrenceRecordUid ? (
                      <> — {record.occurrenceRecordUid}</>
                    ) : null}
                    {record.licence && (
                      <span style={{ color: 'var(--muted)' }}> · {record.licence}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </li>
  )
}
