/** Iteration 2 Phase 5 - Epic 5.2 plant detail deep-link page.
 *
 *  Renders one species from the server catalogue. Two AC 5.2.4 strings
 *  are load-bearing and rendered verbatim when the relevant flag is
 *  false: the frontend never invents severity, and never invents a
 *  beginner-safe active response. Both are surfaced as their own
 *  ``PlantDetailStatusSections`` component so they can be unit-tested
 *  without a DOM by rendering the sub-component in isolation.
 */
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { Icon } from '@/components/Icon'
import { useCatalogueDetail, type CatalogueDetail, type EvidenceCode } from '@/services/catalogue'

const EVIDENCE_LABEL: Record<EvidenceCode, string> = {
  G: 'GRIIS listed',
  A: 'Agriculture flagged',
  B: 'Biosecurity flagged',
}

export const FORMAL_SEVERITY_UNAVAILABLE_COPY =
  'Formal severity assessment not available'
export const BEGINNER_SAFE_UNAVAILABLE_COPY =
  'No beginner-safe active action is provided'

export function PlantDetailStatusSections({
  formalSeverityAssessmentAvailable,
  beginnerSafeActionAvailable,
}: {
  formalSeverityAssessmentAvailable: boolean
  beginnerSafeActionAvailable: boolean
}) {
  return (
    <>
      <section aria-labelledby="plant-detail-severity" style={{ marginTop: 24 }}>
        <h2 id="plant-detail-severity" style={{ fontSize: 16, margin: '0 0 8px' }}>
          Severity
        </h2>
        {formalSeverityAssessmentAvailable ? (
          <p style={{ margin: 0 }}>
            A formal severity assessment has been reviewed for this species.
            See the sources and credits below for the referenced records.
          </p>
        ) : (
          <p style={{ margin: 0 }}>{FORMAL_SEVERITY_UNAVAILABLE_COPY}</p>
        )}
      </section>
      <section aria-labelledby="plant-detail-safe-action" style={{ marginTop: 20 }}>
        <h2 id="plant-detail-safe-action" style={{ fontSize: 16, margin: '0 0 8px' }}>
          Safe response
        </h2>
        {beginnerSafeActionAvailable ? (
          <p style={{ margin: 0 }}>
            A beginner-safe active response is available for this species -
            follow the guidance surfaced from the safe-action registry.
          </p>
        ) : (
          <p style={{ margin: 0 }}>{BEGINNER_SAFE_UNAVAILABLE_COPY}</p>
        )}
      </section>
    </>
  )
}

export function PlantDetailPage() {
  const { speciesId } = useParams<{ speciesId: string }>()
  const query = useCatalogueDetail(speciesId)

  if (!speciesId) {
    return <NotFound />
  }
  if (query.isPending) {
    return (
      <section aria-busy style={{ padding: 20 }}>
        <p>Loading species profile…</p>
      </section>
    )
  }
  if (query.isError || !query.data) {
    return <NotFound />
  }

  const detail = query.data
  return <PlantDetailView detail={detail} />
}

function PlantDetailView({ detail }: { detail: CatalogueDetail }) {
  const attribution = detail.imageAttribution as
    | { creator?: string; licence?: string; source?: string }
    | null
    | undefined
  const canShowImage =
    Boolean(detail.referenceImageUrl) &&
    Boolean(attribution?.creator) &&
    Boolean(attribution?.licence)

  return (
    <main style={{ padding: 20, maxWidth: 760, margin: '0 auto' }}>
      <header>
        <h1 style={{ margin: 0, fontStyle: 'italic' }}>{detail.scientificName}</h1>
        {detail.commonNames.length > 0 && (
          <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
            {detail.commonNames.join(', ')}
          </p>
        )}
      </header>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: 12,
        }}
        aria-label="Malaysia invasive status"
      >
        {detail.evidenceCodes.map((code) => (
          <span
            key={code}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            {EVIDENCE_LABEL[code]}
          </span>
        ))}
      </div>

      {detail.malaysianStates.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>Malaysian states</h2>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {detail.malaysianStates.map((state) => (
              <li
                key={state}
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                }}
              >
                {state}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canShowImage && (
        <figure style={{ marginTop: 20 }}>
          <img
            src={detail.referenceImageUrl ?? undefined}
            alt=""
            style={{
              width: '100%',
              borderRadius: 'var(--r-card)',
              border: '1px solid var(--border)',
            }}
          />
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
              Image attribution
            </summary>
            <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--muted)' }}>
              {attribution?.creator}
              {' · '}
              {attribution?.licence}
              {attribution?.source && (
                <>
                  {' · '}
                  <a
                    href={attribution.source}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Source
                  </a>
                </>
              )}
            </p>
          </details>
        </figure>
      )}

      {detail.identifyingCharacteristics && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Identifying characteristics</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {detail.identifyingCharacteristics}
          </p>
        </section>
      )}

      {detail.typicalHabitat && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Typical habitat</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.typicalHabitat}</p>
        </section>
      )}

      {detail.documentedImpacts && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Documented impacts</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.documentedImpacts}</p>
        </section>
      )}

      <PlantDetailStatusSections
        formalSeverityAssessmentAvailable={detail.formalSeverityAssessmentAvailable}
        beginnerSafeActionAvailable={detail.beginnerSafeActionAvailable}
      />

      <SourcesAndCredits detail={detail} />
    </main>
  )
}

function SourcesAndCredits({ detail }: { detail: CatalogueDetail }) {
  const [open, setOpen] = useState(false)
  return (
    <section style={{ marginTop: 24 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <Icon name={open ? 'ChevronRight' : 'ChevronRight'} size={14} />
        Sources and credits
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {detail.evidenceSources.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              No external references recorded for this species yet.
            </p>
          ) : (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {detail.evidenceSources.map((sourceId) => (
                <li key={sourceId} style={{ fontSize: 13 }}>
                  <code>{sourceId}</code> — External reference
                </li>
              ))}
            </ul>
          )}
          {detail.lastReviewedAt && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              Last reviewed{' '}
              {new Date(detail.lastReviewedAt).toISOString().slice(0, 10)}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function NotFound() {
  return (
    <section style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Species not found</h1>
      <p>Pick a species from the catalogue to see its profile.</p>
    </section>
  )
}

export default PlantDetailPage
