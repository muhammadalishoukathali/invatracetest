/** Iteration 2 Phase 5 - Epic 5.2 plant detail deep-link page.
 *
 *  Renders one species from the server catalogue, enriched with the
 *  curated per-species guidance bundled under
 *  shared/catalogue/plant-guidance.json when the backend fields are empty.
 *  Reference images come from iNaturalist Open Data (one of the sources
 *  approved in the InvaTrace Data Management Plan) with a graceful
 *  fallback to the catalogue's own reference URL and finally to the
 *  bundled guidance image.
 *
 *  Two AC 5.2.4 strings are still load-bearing and rendered verbatim
 *  when the relevant flag is false: the frontend never invents severity,
 *  and never invents a beginner-safe active response. Both are surfaced
 *  as their own ``PlantDetailStatusSections`` component so they can be
 *  unit-tested by rendering the sub-component in isolation.
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Icon } from '@/components/Icon'
import { useCatalogueDetail, type CatalogueDetail, type EvidenceCode } from '@/services/catalogue'
import { readOfflineImageUrl } from '@/services/offline-pack'
import { useINaturalistPhoto, type INatPhoto } from '@/services/inaturalist'
import { findPlantGuidance, type PlantGuidance } from '@/data/plant-guidance'

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
        <BackToCatalogue />
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

function BackToCatalogue() {
  return (
    <div style={{ marginBottom: 12 }}>
      <Link
        to="/plants"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          textDecoration: 'none',
          color: 'var(--body)',
          fontSize: 13,
          fontWeight: 600,
          padding: '6px 10px 6px 6px',
          borderRadius: 'var(--r-chip)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <Icon name="ChevronLeft" size={16} color="var(--body)" />
        <span>Plant catalogue</span>
      </Link>
    </div>
  )
}

function PlantDetailView({ detail }: { detail: CatalogueDetail }) {
  const guidance = findPlantGuidance({
    plantId: detail.speciesId,
    scientificName: detail.scientificName,
  })
  const attribution = detail.imageAttribution as
    | { creator?: string; licence?: string; source?: string }
    | null
    | undefined

  // AC 5.3.2 - prefer the cached image bytes from the installed offline
  // pack over the network URL; falls back to the reference URL when no
  // pack is installed or the pack has no image for this species.
  const [offlineImageUrl, setOfflineImageUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!detail.speciesId) return
    let url: string | null = null
    let cancelled = false
    void readOfflineImageUrl(detail.speciesId).then((cached) => {
      if (cancelled) {
        if (cached) URL.revokeObjectURL(cached)
        return
      }
      url = cached
      setOfflineImageUrl(cached)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [detail.speciesId])

  // iNaturalist reference photo, per Data Management Plan §"iNaturalist
  // Open Data". Runs concurrently with catalogue detail load; the picker
  // below chooses whichever source is available.
  const inat = useINaturalistPhoto(detail.scientificName)

  // plant-guidance.json carries optional identifying_features / typical_habitat
  // / documented_impacts alongside the typed guidance schema; the shipped
  // TypeScript surface (PlantGuidance) hasn't been widened to include them
  // yet, so read them off the raw shape here as a fallback for species where
  // the backend detail is otherwise empty.
  const extras = guidance as unknown as {
    identifying_features?: string | null
    typical_habitat?: string | null
    documented_impacts?: string | null
  } | null
  const identifying =
    detail.identifyingCharacteristics ?? extras?.identifying_features ?? guidance?.identification_note ?? null
  const habitat = detail.typicalHabitat ?? extras?.typical_habitat ?? null
  const impacts = detail.documentedImpacts ?? extras?.documented_impacts ?? null
  const generalInfo = guidance?.general_information ?? null

  return (
    <main style={{ padding: 20, maxWidth: 760, margin: '0 auto' }}>
      <BackToCatalogue />

      <header>
        <h1 style={{ margin: 0, fontStyle: 'italic', fontSize: 24 }}>{detail.scientificName}</h1>
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

      <SpeciesImage
        offlineImageUrl={offlineImageUrl}
        inat={inat.data ?? null}
        inatLoading={inat.isPending}
        catalogueUrl={detail.referenceImageUrl ?? null}
        catalogueAttribution={attribution ?? null}
        guidance={guidance}
        scientificName={detail.scientificName}
      />

      {generalInfo && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>About this plant</h2>
          <p style={{ margin: 0, lineHeight: 1.55 }}>{generalInfo}</p>
        </section>
      )}

      {identifying && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Identifying characteristics</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
            {identifying}
          </p>
        </section>
      )}

      {habitat && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Typical habitat</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{habitat}</p>
        </section>
      )}

      {impacts && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Documented impacts</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{impacts}</p>
        </section>
      )}

      {guidance?.do_not_do && guidance.do_not_do.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Do not do</h2>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
            {guidance.do_not_do.map((item, index) => (
              <li key={index}>{item.text}</li>
            ))}
          </ul>
        </section>
      )}

      {guidance?.spread_prevention && guidance.spread_prevention.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Spread prevention</h2>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
            {guidance.spread_prevention.map((item, index) => (
              <li key={index}>{item.text}</li>
            ))}
          </ul>
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

function SpeciesImage({
  offlineImageUrl, inat, inatLoading, catalogueUrl, catalogueAttribution, guidance, scientificName,
}: {
  offlineImageUrl: string | null
  inat: INatPhoto | null
  inatLoading: boolean
  catalogueUrl: string | null
  catalogueAttribution: { creator?: string; licence?: string; source?: string } | null
  guidance: PlantGuidance | null
  scientificName: string
}) {
  // Priority: user's own offline pack (approved catalogue snapshot) >
  // iNaturalist Open Data (DMP-approved, sourced via api.inaturalist.org) >
  // catalogue-hosted reference URL > bundled guidance image.
  if (offlineImageUrl) {
    return (
      <figure style={{ marginTop: 20 }}>
        <img src={offlineImageUrl} alt={`Reference photo of ${scientificName}`} style={{
          width: '100%', borderRadius: 'var(--r-card)', border: '1px solid var(--border)',
        }} />
        <figcaption style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
          Offline reference pack
        </figcaption>
      </figure>
    )
  }
  if (inat) {
    return (
      <figure style={{ marginTop: 20 }}>
        <img
          src={inat.mediumUrl}
          alt={`Reference photo of ${scientificName}`}
          loading="lazy"
          style={{ width: '100%', borderRadius: 'var(--r-card)', border: '1px solid var(--border)' }}
        />
        <figcaption style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {inat.attribution}
          {inat.sourceUrl && (
            <>
              {' · '}
              <a href={inat.sourceUrl} target="_blank" rel="noreferrer noopener">
                iNaturalist
              </a>
            </>
          )}
        </figcaption>
      </figure>
    )
  }
  if (inatLoading) {
    return (
      <div style={{
        marginTop: 20, height: 220, borderRadius: 'var(--r-card)',
        border: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)', fontSize: 13,
      }} aria-busy>
        Loading reference photo…
      </div>
    )
  }
  const url = catalogueUrl ?? guidance?.reference_image ?? null
  if (!url) return null
  const credit = catalogueAttribution?.creator
    ? `${catalogueAttribution.creator}${catalogueAttribution.licence ? ` · ${catalogueAttribution.licence}` : ''}`
    : guidance?.reference_image_credit ?? null
  return (
    <figure style={{ marginTop: 20 }}>
      <img
        src={url}
        alt={`Reference photo of ${scientificName}`}
        loading="lazy"
        style={{ width: '100%', borderRadius: 'var(--r-card)', border: '1px solid var(--border)' }}
      />
      {credit && (
        <figcaption style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
          {credit}
        </figcaption>
      )}
    </figure>
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
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} />
        Sources and credits
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {detail.sources && detail.sources.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {detail.sources.map((source, index) => {
                const isUrl = /^https?:\/\//i.test(source.urlOrId)
                return (
                  <li
                    key={`${source.urlOrId}-${index}`}
                    style={{ fontSize: 13, lineHeight: 1.4 }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {isUrl ? (
                        <a
                          href={source.urlOrId}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {source.title}
                        </a>
                      ) : (
                        <>
                          {source.title}
                          {source.urlOrId && source.urlOrId !== source.title && (
                            <>
                              {' '}
                              <code style={{ fontWeight: 400, fontSize: 12 }}>
                                {source.urlOrId}
                              </code>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {(source.imageCreator || source.licence) && (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {source.imageCreator && <>Image: {source.imageCreator}</>}
                        {source.imageCreator && source.licence && ' · '}
                        {source.licence}
                      </div>
                    )}
                    {source.reviewDate && (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Information reviewed{' '}
                        {new Date(source.reviewDate).toISOString().slice(0, 10)}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : detail.evidenceSources.length === 0 ? (
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
          {detail.evidenceCodes.length > 0 && (
            <ul
              aria-label="Evidence codes"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '10px 0 0',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {detail.evidenceCodes.map((code) => (
                <li
                  key={code}
                  style={{
                    fontSize: 11.5,
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                  }}
                >
                  {EVIDENCE_LABEL[code]}
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
      <BackToCatalogue />
      <h1 style={{ marginTop: 0 }}>Species not found</h1>
      <p>Pick a species from the catalogue to see its profile.</p>
    </section>
  )
}

export default PlantDetailPage
