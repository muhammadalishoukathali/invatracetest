/** Phase 11B - Historical Records details sheet.
 *
 *  Opens when a viewer taps a diamond on the opt-in Historical Records
 *  layer. Deliberately terse - the point is to make it obvious this is a
 *  research observation with a citable source, NOT a live community
 *  sighting.
 */
import { useEffect } from 'react'

import type { HistoricalOccurrence } from '@/services/historical-occurrences'
import { Icon } from '@/components/Icon'

type Props = {
  occurrence: HistoricalOccurrence | null
  onClose: () => void
}

export function HistoricalRecordDetailsSheet({ occurrence, onClose }: Props) {
  useEffect(() => {
    if (!occurrence) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [occurrence, onClose])

  if (!occurrence) return null

  const scientific = occurrence.scientificName || occurrence.speciesId
  const common = occurrence.commonName
  const year = occurrence.eventYear ?? occurrence.eventDate?.slice(0, 4)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Historical record for ${scientific}`}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 20,
        transform: 'translateX(-50%)',
        zIndex: 30,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        width: 'min(92vw, 420px)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6a4baa', fontWeight: 700 }}>
            Historical record
          </div>
          <div style={{ fontSize: 15, fontWeight: 650, marginTop: 2, fontStyle: 'italic' }}>
            {scientific}
          </div>
          {common && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{common}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close historical record details"
          style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 4 }}
        >
          <Icon name="X" size={16} color="var(--muted)" />
        </button>
      </div>
      <dl style={{ margin: '10px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12.5 }}>
        {year && (
          <>
            <dt style={{ color: 'var(--muted)' }}>Observed</dt>
            <dd style={{ margin: 0 }}>{year}</dd>
          </>
        )}
        {occurrence.stateProvince && (
          <>
            <dt style={{ color: 'var(--muted)' }}>State</dt>
            <dd style={{ margin: 0 }}>{occurrence.stateProvince}</dd>
          </>
        )}
        {occurrence.basisOfRecord && (
          <>
            <dt style={{ color: 'var(--muted)' }}>Basis</dt>
            <dd style={{ margin: 0 }}>{occurrence.basisOfRecord}</dd>
          </>
        )}
        {occurrence.datasetName && (
          <>
            <dt style={{ color: 'var(--muted)' }}>Dataset</dt>
            <dd style={{ margin: 0 }}>{occurrence.datasetName}</dd>
          </>
        )}
        {occurrence.licence && (
          <>
            <dt style={{ color: 'var(--muted)' }}>Licence</dt>
            <dd style={{ margin: 0 }}>{occurrence.licence}</dd>
          </>
        )}
      </dl>
      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4 }}>
        Historical observations do not guarantee current presence.
      </p>
      {occurrence.sourceUrl && (
        <a
          href={occurrence.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            marginTop: 10,
            fontSize: 12,
            fontWeight: 600,
            color: '#6a4baa',
          }}
        >
          View source record ↗
        </a>
      )}
    </div>
  )
}
