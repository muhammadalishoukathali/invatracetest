import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/features/scan/scan-store'
import { useReportDraft } from '@/features/report/report-draft-store'
import { PlantGuidancePanel } from '@/features/scan/PlantGuidancePanel'
import { resolveResultPathway, type ResultPathway } from '@/features/scan/malaysia-status'
import { findPlantGuidance } from '@/data/plant-guidance'
import { findModelSpecies, modelReferenceImageUrl } from '@/data/model-species-catalog'
import type { IdentifyResult, SpeciesDetail } from '@/types'
import { findApprovedSpecies } from '@shared/catalogue'
import './scan-result.css'

/**
 * Shows what a finished scan came back with - target species, other plant,
 * or uncertain - and for identified species the Malaysia status and the
 * PlantGuidancePanel with removal/reporting steps. Raw model confidence
 * is deliberately hidden from users; the outcome band + copy carries the
 * appropriate qualifier instead.
 * This is basically the identification review screen from the requirements:
 * the point where the user actually checks the model's guess before deciding
 * whether to bother starting a report. If there's no result sitting in
 * scan-store yet (a direct link, or a page refresh mid-flow), it just
 * bounces back to capture instead of showing a blank page.
 */
export function ScanResultPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { imageUrl, result, speciesDetail, captureSource, captureId, scanPersistStatus } = useScan()
  const [reportBlocked, setReportBlocked] = useState<string | null>(null)

  if (!result) {
    return <Navigate to="/scan" replace state={location.state} />
  }

  const scanAgain = () => {
    useScan.getState().reset()
    navigate('/scan', { replace: true, state: location.state })
  }

  const backToCapture = () => {
    // Preserve scan state so the user can re-inspect the photo they captured.
    navigate('/scan', { state: location.state })
  }

  const startReport = () => {
    const {
      imageBlob, imageUrl: url, observedAt, captureId, captureSource: source,
    } = useScan.getState()
    const trusted = source === 'camera' || source === 'gallery'
    if (!imageBlob || !url || !observedAt || !captureId || !trusted) {
      setReportBlocked(
        'The photo is no longer available for reporting. Retake it to continue.',
      )
      return
    }
    setReportBlocked(null)
    useReportDraft.getState().beginFromScan({
      result, imageBlob, imageUrl: url, observedAt, captureId, captureSource: source,
    })
    navigate('/report', { state: location.state })
  }

  // The Malaysia ui_state, and everything downstream that depends on it, all
  // gets resolved through resolveResultPathway against the shared catalogue -
  // I stopped trusting the raw model outcome on its own to decide whether
  // something's invasive, since the catalogue is the actual authoritative source.
  const pathway = resolveResultPathway(result)
  const statusUncertain = pathway.pathway === 'status_uncertain'
  // An explicit server veto (reportEligible === false) still overrides whatever
  // the catalogue says. If it's undefined though, the catalogue stays in charge.
  const serverReportEligible = speciesDetail?.reportEligible
  const reportEligible = serverReportEligible === false ? false : pathway.canReport
  // Trusting both camera capture and gallery upload for the report flow matters
  // because otherwise desktop testers, or anyone without camera permission,
  // would hit a dead end where identification succeeds but Report just never
  // shows up.
  const trustedCapture = captureSource === 'camera' || captureSource === 'gallery'
  // Report stays disabled until the scan record is actually persisted
  // server-side; a retryable failure gets its own control further down.
  const scanReady = scanPersistStatus === 'ok'
  // Reporting also stays blocked if the classification was accepted locally but
  // the server-side model-config gate couldn't be reached. The result still
  // displays fine - it's only Report that waits for the gate to confirm.
  const gateConfirmed = result.serverAccepted !== false
  const canReport = trustedCapture && reportEligible && scanReady && gateConfirmed
  // I don't want an information-only or status-uncertain record ever reaching
  // the in-panel removal/containment flow, even if a stale server flag claims
  // actionEligible is true - the pathway check here overrides that.
  const guidanceActionEligible = pathway.canAction
    ? speciesDetail?.actionEligible
    : false
  const approvedSpecies = findApprovedSpecies({
    speciesId: result.speciesId,
    scientificName: result.scientificName,
  })

  return (
    <div className="scan-result">
      <OutcomeBadge pathway={pathway.pathway} />

      {/* Every classification result needs to carry this disclosure that it came
          from a model, not a human. Kept as its own short sentence so screen
          readers announce it before getting into the actual finding. */}
      <p className="scan-result__disclosure" role="note">
        This identification was generated by the InvaTrace image-recognition model.
      </p>

      {result.serverAccepted === false && scanPersistStatus !== 'failed' && (
        <div role="status" style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 'var(--r-input)',
          background: '#FEF3E2', border: '1px solid #F0D9A8',
          fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55,
        }}>
          Server verification is unavailable right now, so the result is shown
          from on-device analysis only. Reporting will re-enable once the
          server can confirm it.
        </div>
      )}

      {imageUrl && (
        <img src={imageUrl} alt="Scanned plant" style={{
          width: '100%', maxHeight: 220, objectFit: 'cover',
          borderRadius: 'var(--r-card)', marginTop: 16, display: 'block',
        }} />
      )}

      {pathway.pathway === 'invasive_reportable' && speciesDetail && (
        <TargetResult result={result} detail={speciesDetail} imageUrl={imageUrl} />
      )}
      {pathway.pathway === 'invasive_reportable' && !speciesDetail && (
        <UnsupportedTargetResult result={result} />
      )}
      {pathway.pathway === 'invasive_unsupported' && (
        <UnsupportedTargetResult result={result} />
      )}
      {pathway.pathway === 'information_only' && (
        <InformationOnlyResult result={result} />
      )}
      {pathway.pathway === 'other_plant' && <OtherPlantResult result={result} />}
      {pathway.pathway === 'uncertain' && <UncertainResult result={result} />}
      {pathway.pathway === 'retake_recommended' && <RetakeResult result={result} />}

      {statusUncertain && (
        <div style={{
          marginTop: 16, padding: '12px 14px', borderRadius: 'var(--r-input)',
          background: '#FEF3E2', border: '1px solid #F0D9A8',
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--amber)' }}>Status uncertain</div>
          <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55 }}>
            Our reviewed sources do not clearly show how Malaysia classifies this plant.
            Leave it where it is, and do not report it from this result.
          </p>
        </div>
      )}

      {result.outcome !== 'uncertain' && !statusUncertain && (
        <PlantGuidancePanel
          scientificName={result.scientificName}
          speciesName={result.speciesName}
          plantId={result.speciesId}
          // Passing false here for information-only records is what makes the
          // panel drop its removal controls, even when there's no server veto
          // telling it to.
          actionEligible={guidanceActionEligible}
          decisionContext={captureId ? { id: `scan:${captureId}`, kind: 'scan' } : undefined}
          showReferenceImage={false}
        />
      )}

      {/* Keep review metadata secondary to the identification result. */}
      {(speciesDetail?.statusReviewedAt || speciesDetail?.statusSourceId) && (
        <p style={{
          marginTop: 10,
          fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55,
          wordBreak: 'break-word',
        }}>
          {speciesDetail.statusReviewedAt && `Malaysia status reviewed ${humanReviewedDate(speciesDetail.statusReviewedAt)}`}
          {speciesDetail.statusReviewedAt && speciesDetail.statusSourceId && ' · '}
          {speciesDetail.statusSourceId}
        </p>
      )}

      {approvedSpecies && (
        <Link
          to={`/catalogue/${approvedSpecies.species_id}`}
          className="scan-result__catalogue-link"
        >
          View catalogue entry for {approvedSpecies.scientific_name}
        </Link>
      )}

      <div className="scan-result__action-dock" role="group" aria-label="Scan result actions">
        {canReport && (
          <div className="scan-result__action-copy">
            <strong>Help confirm this sighting</strong>
            <span>Send the photo and location for review.</span>
          </div>
        )}

        <div className="scan-result__action-buttons">
          <button type="button" onClick={backToCapture} className="scan-result__secondary-action">
            <Icon name="ChevronLeft" size={16} color="var(--body)" />
            Back to capture
          </button>
          <button type="button" onClick={scanAgain} className="scan-result__secondary-action">
            <Icon name="RotateCcw" size={16} color="var(--body)" />
            Scan again
          </button>

          {canReport && (
            <button type="button" onClick={startReport} className="scan-result__report-action">
              <Icon name="Send" size={17} color="#fff" />
              Report sighting
            </button>
          )}
        </div>
        {reportBlocked && (
          <p role="alert" style={{
            marginTop: 10, fontSize: 12.5, color: 'var(--red-text)', lineHeight: 1.5,
          }}>
            {reportBlocked}
          </p>
        )}
      </div>

    </div>
  )
}

// The badge label follows the catalogue-derived pathway, not the raw model
// outcome - a plant the model flagged as "target" but that actually maps to an
// information-only or status-uncertain catalogue record should never end up
// labelled "Invasive in Malaysia" just because of that raw outcome.
const PATHWAY_CONFIG: Record<ResultPathway, {
  label: string; bg: string; border: string; color: string; icon: string
}> = {
  invasive_reportable: { label: 'Invasive in Malaysia', bg: 'var(--red-light)', border: 'var(--red-border)', color: 'var(--red)', icon: 'AlertTriangle' },
  invasive_unsupported: { label: 'Invasive in Malaysia', bg: 'var(--red-light)', border: 'var(--red-border)', color: 'var(--red)', icon: 'AlertTriangle' },
  information_only: { label: 'Information only', bg: '#EEF3F7', border: '#D5DEE7', color: '#2F5F86', icon: 'Info' },
  status_uncertain: { label: 'Status uncertain. Take another photo.', bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)', icon: 'HelpCircle' },
  other_plant: { label: 'Not a target species', bg: 'var(--green-light)', border: 'var(--green-border)', color: 'var(--green)', icon: 'Check' },
  uncertain: { label: 'Uncertain result. Take another photo.', bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)', icon: 'HelpCircle' },
  retake_recommended: { label: 'Photo needs another try', bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)', icon: 'Camera' },
}

function OutcomeBadge({ pathway }: { pathway: ResultPathway }) {
  const c = PATHWAY_CONFIG[pathway]
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
      borderRadius: 'var(--r-chip)', background: c.bg, border: `1px solid ${c.border}`,
    }}>
      <Icon name={c.icon} size={16} color={c.color} />
      <span style={{ fontSize: 13, fontWeight: 600, color: c.color }}>{c.label}</span>
    </div>
  )
}

function TargetResult({
  result, detail, imageUrl,
}: { result: IdentifyResult; detail: SpeciesDetail; imageUrl: string | null }) {
  const modelSpecies = findModelSpecies({
    speciesId: result.speciesId ?? null,
    scientificName: result.scientificName ?? detail.latinName,
  })
  const referenceImage = detail.referenceImageUrl
    ?? (modelSpecies ? modelReferenceImageUrl(modelSpecies) : null)
  // The detailed safety/removal guidance itself only gets rendered once, down
  // in the shared PlantGuidancePanel - this component just handles the header,
  // native-twin comparison, and reference photo.
  return (
    <>
      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{detail.name}</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>{detail.latinName}</p>
        {detail.commonNames.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            Also known as: {detail.commonNames.join(', ')}
          </p>
        )}
      </div>

      {detail.nativeTwin && (
        <Section title="Compare with the native look-alike" icon="Leaf">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <ComparisonCard
              tone="warn"
              badge="Your scan"
              imageUrl={imageUrl}
              imageAlt="Your scanned plant"
              caption="Possible invasive"
            />
            <ComparisonCard
              tone="ok"
              badge="Native"
              imageUrl={detail.nativeTwin.referenceImageUrl}
              imageCredit={detail.nativeTwin.referenceImageCredit}
              imageAlt={`Reference photo of ${detail.nativeTwin.name}`}
              title={detail.nativeTwin.name}
              subtitle={detail.nativeTwin.latinName}
              caption="Native. Do not remove."
            />
          </div>
          <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13, color: 'var(--body)', lineHeight: 1.65 }}>
            {detail.nativeTwin.distinguishingTraits.map((trait) => <li key={trait}>{trait}</li>)}
          </ul>
        </Section>
      )}

      {referenceImage && (
        <Section title="Typical appearance" icon="ImagePlus">
          <ReferenceImage src={referenceImage} alt={`Reference photo of ${detail.name}`}
            credit={detail.referenceImageCredit} />
        </Section>
      )}
    </>
  )
}

function ComparisonCard({
  tone, badge, imageUrl, imageAlt, imageCredit, title, subtitle, caption,
}: {
  tone: 'warn' | 'ok'; badge: string; imageUrl?: string | null; imageAlt: string;
  imageCredit?: string; title?: string; subtitle?: string; caption: string
}) {
  const bg = tone === 'warn' ? 'var(--red-light)' : 'var(--green-light)'
  const captionColor = tone === 'warn' ? 'var(--red-text)' : 'var(--green-dark)'
  return (
    <div style={{ overflow: 'hidden', borderRadius: 'var(--r-input)', background: bg }}>
      {imageUrl ? (
        <img src={imageUrl} alt={imageAlt} loading="lazy" style={{
          width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block',
        }} />
      ) : (
        <div aria-hidden style={{
          width: '100%', aspectRatio: '4 / 3',
          background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)', fontSize: 11,
        }}>No reference photo</div>
      )}
      <div style={{ padding: '10px 11px' }}>
        <span style={{
          display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4,
          textTransform: 'uppercase', color: captionColor,
        }}>{badge}</span>
        {title && <div style={{ marginTop: 4, fontSize: 13, fontWeight: 650 }}>{title}</div>}
        {subtitle && <div style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic' }}>{subtitle}</div>}
        <p style={{ marginTop: 6, color: captionColor, fontSize: 11.5, fontWeight: 600 }}>{caption}</p>
        {imageCredit && (
          <p style={{ marginTop: 4, fontSize: 10, color: 'var(--muted)' }}>{imageCredit}</p>
        )}
      </div>
    </div>
  )
}

function ReferenceImage({ src, alt, credit }: { src: string; alt: string; credit?: string }) {
  return (
    <figure style={{ margin: 0 }}>
      <img src={src} alt={alt} loading="lazy" style={{
        width: '100%', maxHeight: 260, objectFit: 'cover',
        borderRadius: 'var(--r-input)', display: 'block',
      }} />
      {credit && <figcaption style={{ marginTop: 4, fontSize: 10.5, color: 'var(--muted)' }}>{credit}</figcaption>}
    </figure>
  )
}

function OtherPlantResult({ result }: { result: IdentifyResult }) {
  const modelSpecies = findModelSpecies({
    speciesId: result.speciesId ?? null,
    scientificName: result.scientificName ?? null,
  })
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 18, fontWeight: 650 }}>{result.speciesName ?? 'Not a tracked invasive'}</h2>
      {result.scientificName && result.scientificName !== result.speciesName && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, fontStyle: 'italic' }}>{result.scientificName}</p>
      )}
      <p style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 8, lineHeight: 1.6 }}>
        This plant is not on InvaTrace's removal list. Leave it in place.
        If it still looks suspicious, take another photo from a different angle.
      </p>
      {modelSpecies && (
        <ReferenceImage
          src={modelReferenceImageUrl(modelSpecies)}
          alt={`Reference photo of ${modelSpecies.scientific_name}`}
          credit="Species reference image"
        />
      )}
    </div>
  )
}

function InformationOnlyResult({ result }: { result: IdentifyResult }) {
  // Information-only records get deliberately neutral framing here - just
  // identify the plant, don't give the user anything to act on or report.
  // The actual full context lives in the PlantGuidancePanel further down.
  const modelSpecies = findModelSpecies({
    speciesId: result.speciesId ?? null,
    scientificName: result.scientificName ?? null,
  })
  const displayName = result.speciesName ?? result.scientificName ?? 'Identified plant'
  const scientific = result.scientificName && result.scientificName !== displayName
    ? result.scientificName : null
  return (
    <div style={{
      marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)',
      background: 'var(--surface)', border: '1px solid var(--border)',
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 650 }}>{displayName}</h2>
      {scientific && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, fontStyle: 'italic', marginTop: 2 }}>{scientific}</p>
      )}
      <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--body)', lineHeight: 1.6 }}>
        This plant is on InvaTrace's information list, not the removal list.
        Leave it in place and use the guidance below for context.
      </p>
      {modelSpecies && (
        <ReferenceImage
          src={modelReferenceImageUrl(modelSpecies)}
          alt={`Reference photo of ${modelSpecies.scientific_name}`}
          credit="Species reference image"
        />
      )}
    </div>
  )
}

function UncertainResult({ result }: { result: IdentifyResult }) {
  const navigate = useNavigate()
  const location = useLocation()
  const retake = () => {
    useScan.getState().reset()
    navigate('/scan', { replace: true, state: location.state })
  }
  const verification = result.verification
  // Guard against PlantNet identifying the plant as one of the 32 InvaTrace
  // invasives that Student33 was uncertain about: labelling that "Native
  // Species" would understate the risk. If PlantNet's top match sits in the
  // approved catalogue we fall back to Not Sure with a note that the user
  // should retake the photo so Student33 can classify it confidently, rather
  // than pretending it's non-invasive.
  const plantnetMatchesInvasive = verification?.species
    ? findApprovedSpecies({ scientificName: verification.species.scientificName }) !== null
    : false
  const identifiedAsNative = (
    verification?.label === 'native'
    && verification.species
    && !plantnetMatchesInvasive
  )
  const headline = identifiedAsNative
    ? 'Native Species'
    : 'Not Sure - Unable to verify'
  const speciesLine = identifiedAsNative
    ? verification!.species!.scientificName
    : null
  const commonName = identifiedAsNative
    ? (verification!.species!.commonNames ?? [])[0] ?? null
    : null
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>{headline}</h2>
      {identifiedAsNative ? (
        <>
          <p style={{ marginTop: 6, color: 'var(--body)', fontSize: 13.5, lineHeight: 1.6 }}>
            <em>{speciesLine}</em>
            {commonName ? <> · {commonName}</> : null}
          </p>
          <p style={{ marginTop: 6, color: 'var(--muted)', fontSize: 12, lineHeight: 1.5 }}>
            Not in the InvaTrace invasive catalogue. Result cross-checked with a
            second identifier. Treat this as a cross-check, not a formal
            ecological determination.
          </p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 8, lineHeight: 1.6 }}>
            {plantnetMatchesInvasive
              ? `PlantNet suggested ${verification!.species!.scientificName}, which is on the InvaTrace invasive list, but the on-device model was not confident. Please retake the photo (closer, sharper, one leaf or flower) so the model can classify it.`
              : verification?.status === 'disabled'
                ? 'The on-device model was not confident, and the PlantNet verifier is not enabled on this build. Try another photo.'
                : verification?.status === 'error'
                  ? 'The on-device model was not confident, and PlantNet could not be reached for a second opinion.'
                  : 'We could not confidently identify the plant. Try again with:'}
          </p>
          {verification?.status !== 'disabled' && !plantnetMatchesInvasive && (
            <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: 'var(--body)', lineHeight: 1.7 }}>
              <li>Even lighting without harsh shadows</li>
              <li>A closer photo with the plant in focus</li>
              <li>One leaf or flower clearly visible</li>
            </ul>
          )}
        </>
      )}
      <button type="button" onClick={retake} style={{
        marginTop: 14, width: '100%', height: 'var(--h-primary)',
        borderRadius: 'var(--r-button)', border: 'none',
        background: 'var(--green)', color: '#fff', fontWeight: 600, fontSize: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
      }}>
        <Icon name="Camera" size={16} color="#fff" />
        Retake photo
      </button>
    </div>
  )
}

function RetakeResult({ result }: { result: IdentifyResult }) {
  const navigate = useNavigate()
  const location = useLocation()
  const retake = () => {
    useScan.getState().reset()
    navigate('/scan', { replace: true, state: location.state })
  }
  const message = result.retakeAdvice?.message
    ?? 'The plant could not be recognised from this photo. Try again with better lighting and one leaf or flower in focus.'
  return (
    <div style={{
      marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)',
      background: 'var(--surface)', border: '1px solid var(--border)',
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Take another photo</h2>
      <p style={{ marginTop: 8, color: 'var(--body)', fontSize: 13.5, lineHeight: 1.6 }}>
        {message}
      </p>
      <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: 'var(--body)', lineHeight: 1.7 }}>
        <li>Fill the frame with a single leaf or flower</li>
        <li>Hold the phone steady in even daylight</li>
        <li>Avoid busy backgrounds and heavy shadows</li>
      </ul>
      <button type="button" onClick={retake} style={{
        marginTop: 14, width: '100%', height: 'var(--h-primary)',
        borderRadius: 'var(--r-button)', border: 'none',
        background: 'var(--green)', color: '#fff', fontWeight: 600, fontSize: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
      }}>
        <Icon name="Camera" size={16} color="#fff" />
        Retake photo
      </button>
    </div>
  )
}

function UnsupportedTargetResult({ result }: { result: IdentifyResult }) {
  const displayName = result.speciesName ?? result.scientificName ?? 'Possible invasive plant'
  const scientific = result.scientificName && result.scientificName !== displayName ? result.scientificName : null
  // Even when there's no detailed guidance card for this plant, a catalogue
  // reference photo is still worth showing so the user has something to
  // compare against.
  const guidance = findPlantGuidance({
    scientificName: result.scientificName ?? null,
    modelLabel: result.speciesName ?? null,
    plantId: result.speciesId ?? null,
  })
  const modelSpecies = findModelSpecies({
    speciesId: result.speciesId ?? null,
    scientificName: result.scientificName ?? null,
  })
  const referenceImage = guidance?.reference_image
    ?? (modelSpecies ? modelReferenceImageUrl(modelSpecies) : null)
  const referenceCredit = guidance?.reference_image_credit ?? 'Species reference image'
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--amber-light)' }}>
      <h2 style={{ fontSize: 18, fontWeight: 650 }}>{displayName}</h2>
      {scientific && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, fontStyle: 'italic', marginTop: 2 }}>{scientific}</p>
      )}
      {referenceImage && (
        <figure style={{ margin: '10px 0 0' }}>
          <img
            src={referenceImage}
            alt={`Reference photo of ${scientific ?? displayName}`}
            loading="lazy"
            style={{
              width: '100%', maxHeight: 220, objectFit: 'cover',
              borderRadius: 'var(--r-input)', display: 'block',
            }}
          />
          <figcaption style={{ marginTop: 4, fontSize: 10.5, color: 'var(--muted)' }}>
            Reference photo · {referenceCredit}
          </figcaption>
        </figure>
      )}
      {/* Kept this summary short on purpose - the full guidance is further down. */}
      <p style={{ marginTop: 8, color: 'var(--body)', fontSize: 13.5, lineHeight: 1.6 }}>
        {guidance?.general_information
          ? firstSentence(guidance.general_information)
          : 'We do not have reviewed field advice for this plant yet. Leave it in place.'}
      </p>
    </div>
  )
}

/** Cuts a longer description down to just its first sentence, for the compact
 *  result boxes. If it can't find a sentence boundary it just returns the
 *  whole text rather than mangling it. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/)
  return match ? match[0] : text
}

/** Turns an ISO date into something like "March 2025" for display. If the
 *  format looks off, just hands the original string back instead of throwing. */
function humanReviewedDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})/)
  if (!match) return iso
  const [, year, monthNum] = match
  const monthIndex = Number(monthNum) - 1
  if (monthIndex < 0 || monthIndex > 11) return iso
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${months[monthIndex]} ${year}`
}

function Section({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        {icon && <Icon name={icon} size={16} color="var(--body)" />}
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}
