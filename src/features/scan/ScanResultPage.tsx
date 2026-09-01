import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/features/scan/scan-store'
import { useReportDraft } from '@/features/report/report-draft-store'
import { PlantGuidancePanel } from '@/features/scan/PlantGuidancePanel'
import { deriveMalaysiaStatusState, isReportEligible } from '@/features/scan/malaysia-status'
import { findPlantGuidance } from '@/data/plant-guidance'
import type { IdentifyResult, SpeciesDetail } from '@/types'
import './scan-result.css'

const HIGH_CONFIDENCE_THRESHOLD = 0.7

export function ScanResultPage() {
  const navigate = useNavigate()
  const { imageUrl, result, speciesDetail, captureSource } = useScan()
  const [reportError, setReportError] = useState<string | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
    document.querySelector<HTMLElement>('.scan-flow__main')?.scrollTo({ top: 0 })
  }, [])

  if (!result) return <Navigate to="/scan" replace />

  const scanAgain = () => {
    useScan.getState().reset()
    navigate('/scan', { replace: true })
  }

  const startReport = () => {
    const scan = useScan.getState()
    const trusted = scan.captureSource === 'camera' || scan.captureSource === 'gallery'
    if (!scan.imageBlob || !scan.imageUrl || !scan.observedAt || !scan.captureId || !trusted) {
      setReportError('This scan is missing its photo details. Take another photo before reporting it.')
      return
    }
    useReportDraft.getState().beginFromScan({
      result,
      imageBlob: scan.imageBlob,
      imageUrl: scan.imageUrl,
      observedAt: scan.observedAt,
      captureId: scan.captureId,
    })
    navigate('/report')
  }

  const statusState = deriveMalaysiaStatusState(result)
  const statusUncertain = statusState === 'status_uncertain'
  const reportEligible = speciesDetail?.reportEligible ?? isReportEligible(statusState)
  const trustedCapture = captureSource === 'camera' || captureSource === 'gallery'
  const canReport = trustedCapture
    && result.confidence >= HIGH_CONFIDENCE_THRESHOLD
    && !statusUncertain
    && reportEligible
    && result.outcome === 'target'
    && result.reportable

  return (
    <article className="scan-result">
      {imageUrl && (
        <figure className="scan-result__photo-wrap">
          <img className="scan-result__photo" src={imageUrl} alt="Plant photographed for identification" />
          <figcaption>Your photo</figcaption>
        </figure>
      )}

      <section className={`scan-result__summary scan-result__summary--${result.outcome}`} aria-labelledby="scan-result-heading">
        <OutcomeLabel outcome={result.outcome} />
        {result.outcome === 'target' && speciesDetail && (
          <TargetResult result={result} detail={speciesDetail} imageUrl={imageUrl} />
        )}
        {result.outcome === 'target' && !speciesDetail && <UnsupportedTargetResult result={result} />}
        {result.outcome === 'other_plant' && <OtherPlantResult result={result} />}
        {result.outcome === 'uncertain' && <UncertainResult result={result} />}

        <div className={`scan-result__actions ${canReport ? 'scan-result__actions--split' : ''}`}>
          {canReport && (
            <button className="scan-result__button scan-result__button--primary" type="button" onClick={startReport}>
              <Icon name="Send" size={18} color="currentColor" />
              Report sighting
            </button>
          )}
          <button
            className={`scan-result__button ${canReport ? 'scan-result__button--secondary' : 'scan-result__button--primary'}`}
            type="button"
            onClick={scanAgain}
          >
            <Icon name={result.outcome === 'uncertain' ? 'Camera' : 'RotateCcw'} size={18} color="currentColor" />
            {result.outcome === 'uncertain' ? 'Take another photo' : 'Scan again'}
          </button>
        </div>
        {reportError && <p className="scan-result__error" role="alert">{reportError}</p>}
      </section>

      {statusUncertain && (
        <aside className="scan-result__notice" role="note">
          <Icon name="Info" size={18} color="var(--amber-text)" />
          <div>
            <strong>Malaysian status needs review</strong>
            <p>Do not remove or report this plant from this result. Take another photo or ask a local expert to confirm it.</p>
          </div>
        </aside>
      )}

      {result.outcome !== 'uncertain' && !statusUncertain && (
        <section className="scan-result__guidance" aria-label="Plant information and field guidance">
          <div className="scan-result__section-heading">
            <span>What to know next</span>
            <p>Identification details and safe field guidance for Malaysia.</p>
          </div>
          <PlantGuidancePanel
            scientificName={result.scientificName}
            speciesName={result.speciesName}
            plantId={result.speciesId}
            actionEligible={speciesDetail?.actionEligible}
          />
        </section>
      )}

      <footer className="scan-result__meta">
        {(speciesDetail?.statusReviewedAt || speciesDetail?.statusSourceId) && (
          <span>
            {speciesDetail.statusReviewedAt && `Malaysia status reviewed ${humanReviewedDate(speciesDetail.statusReviewedAt)}`}
            {speciesDetail.statusReviewedAt && speciesDetail.statusSourceId && ' · '}
            {speciesDetail.statusSourceId}
          </span>
        )}
        <span>Identified by the InvaTrace model. Check the plant in person before acting on it.</span>
      </footer>
    </article>
  )
}

const OUTCOME_CONFIG = {
  target: { label: 'Possible invasive plant', icon: 'AlertTriangle' },
  other_plant: { label: 'Not a tracked invasive', icon: 'Check' },
  uncertain: { label: 'No reliable match', icon: 'HelpCircle' },
} as const

function OutcomeLabel({ outcome }: { outcome: IdentifyResult['outcome'] }) {
  const config = OUTCOME_CONFIG[outcome]
  return <div className="scan-result__outcome"><Icon name={config.icon} size={18} color="currentColor" /><span>{config.label}</span></div>
}

function TargetResult({ result, detail, imageUrl }: { result: IdentifyResult; detail: SpeciesDetail; imageUrl: string | null }) {
  return (
    <>
      <header className="scan-result__identity">
        <h2 id="scan-result-heading">{detail.name}</h2>
        <p className="scan-result__scientific">{detail.latinName}</p>
        {detail.commonNames.length > 0 && <p>Also called {detail.commonNames.join(', ')}</p>}
      </header>
      <ConfidenceBand confidence={result.confidence} />
      {detail.nativeTwin && (
        <details className="scan-result__comparison">
          <summary>Compare with a similar native plant</summary>
          <div className="scan-result__comparison-grid">
            <ComparisonCard label="Your photo" imageUrl={imageUrl} imageAlt="The photographed plant" />
            <ComparisonCard label="Native look-alike" imageUrl={detail.nativeTwin.referenceImageUrl} imageAlt={`Reference photo of ${detail.nativeTwin.name}`} name={detail.nativeTwin.name} credit={detail.nativeTwin.referenceImageCredit} />
          </div>
          <ul>{detail.nativeTwin.distinguishingTraits.map((trait) => <li key={trait}>{trait}</li>)}</ul>
        </details>
      )}
    </>
  )
}

function ComparisonCard({ label, imageUrl, imageAlt, name, credit }: { label: string; imageUrl?: string | null; imageAlt: string; name?: string; credit?: string }) {
  return (
    <figure className="scan-result__comparison-card">
      {imageUrl ? <img src={imageUrl} alt={imageAlt} loading="lazy" /> : <div>No photo available</div>}
      <figcaption><strong>{label}</strong>{name && <span>{name}</span>}{credit && <small>{credit}</small>}</figcaption>
    </figure>
  )
}

function OtherPlantResult({ result }: { result: IdentifyResult }) {
  return (
    <>
      <header className="scan-result__identity">
        <h2 id="scan-result-heading">{result.speciesName ?? 'This plant is not on the report list'}</h2>
        {result.scientificName && result.scientificName !== result.speciesName && <p className="scan-result__scientific">{result.scientificName}</p>}
        <p>Leave it in place. If it still looks suspicious, photograph a different leaf or flower.</p>
      </header>
      <ConfidenceBand confidence={result.confidence} />
    </>
  )
}

function UncertainResult({ result }: { result: IdentifyResult }) {
  return (
    <>
      <header className="scan-result__identity">
        <h2 id="scan-result-heading">We could not identify this plant</h2>
        <p>Try one more photo with the plant filling most of the frame.</p>
      </header>
      <div className="scan-result__tips" aria-label="Tips for the next photo"><span>Use daylight</span><span>Move closer</span><span>Show a leaf or flower</span></div>
      <ConfidenceBand confidence={result.confidence} />
    </>
  )
}

function UnsupportedTargetResult({ result }: { result: IdentifyResult }) {
  const displayName = result.speciesName ?? result.scientificName ?? 'Possible invasive plant'
  const guidance = findPlantGuidance({ scientificName: result.scientificName ?? null, modelLabel: result.speciesName ?? null, plantId: result.speciesId ?? null })
  return (
    <>
      <header className="scan-result__identity">
        <h2 id="scan-result-heading">{displayName}</h2>
        {result.scientificName && result.scientificName !== displayName && <p className="scan-result__scientific">{result.scientificName}</p>}
        <p>{guidance?.general_information ? firstSentence(guidance.general_information) : 'We do not have enough reviewed information to recommend action.'}</p>
      </header>
      <ConfidenceBand confidence={result.confidence} />
    </>
  )
}

function ConfidenceBand({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const level = confidence >= HIGH_CONFIDENCE_THRESHOLD ? 'high' : confidence >= 0.5 ? 'medium' : 'low'
  const label = level === 'high' ? 'Strong match' : level === 'medium' ? 'Possible match' : 'Low confidence'
  return (
    <div className={`scan-result__confidence scan-result__confidence--${level}`}>
      <div><span>{label}</span><strong>{pct}%</strong></div>
      <div className="scan-result__meter" role="meter" aria-label="Identification confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/)
  return match ? match[0] : text
}

function humanReviewedDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})/)
  if (!match) return iso
  const [, year, monthNum] = match
  const monthIndex = Number(monthNum) - 1
  if (monthIndex < 0 || monthIndex > 11) return iso
  return `${new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2020, monthIndex, 1))} ${year}`
}
