import { Navigate, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/features/scan/scan-store'
import { useReportDraft } from '@/features/report/report-draft-store'
import { PlantGuidancePanel } from '@/features/scan/PlantGuidancePanel'
import { deriveMalaysiaStatusState, isReportEligible } from '@/features/scan/malaysia-status'
import { findPlantGuidance } from '@/data/plant-guidance'
import type { IdentifyResult, SpeciesDetail } from '@/types'

export function ScanResultPage() {
  const navigate = useNavigate()
  const { imageUrl, result, speciesDetail, captureSource } = useScan()

  if (!result) {
    return <Navigate to="/scan" replace />
  }

  const scanAgain = () => {
    useScan.getState().reset()
    navigate('/scan', { replace: true })
  }

  const startReport = () => {
    const {
      imageBlob, imageUrl: url, observedAt, captureId, captureSource: source,
    } = useScan.getState()
    if (!imageBlob || !url || !observedAt || !captureId) return
    const trusted = source === 'camera' || (import.meta.env.DEV && source === 'gallery')
    if (!trusted) return
    useReportDraft.getState().beginFromScan({
      result, imageBlob, imageUrl: url, observedAt, captureId,
    })
    navigate('/report')
  }

  const statusState = deriveMalaysiaStatusState(result)
  const statusUncertain = statusState === 'status_uncertain'
  const clientReportEligible = isReportEligible(statusState)
  // AC 1.2.3: when the server has an explicit report/action gate, honour it
  // over the client-side derivation. Absent flag falls back to the derived
  // state so unknown species stay report-blocked.
  const serverReportEligible = speciesDetail?.reportEligible
  const reportEligible = serverReportEligible === undefined
    ? clientReportEligible
    : serverReportEligible
  // Production requires a camera-origin capture (AC 4.1.2). In DEV the dev-only
  // gallery button also unlocks the report flow so QA testers can exercise it
  // without a real camera.
  const trustedCapture = captureSource === 'camera'
    || (import.meta.env.DEV && captureSource === 'gallery')
  const canReport = trustedCapture
    && !statusUncertain
    && reportEligible
    && (result.outcome === 'uncertain' || (result.outcome === 'target' && result.reportable))

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', paddingBottom: 32 }}>
      <OutcomeBadge outcome={result.outcome} />

      {imageUrl && (
        <img src={imageUrl} alt="Scanned plant" style={{
          width: '100%', maxHeight: 220, objectFit: 'cover',
          borderRadius: 'var(--r-card)', marginTop: 16, display: 'block',
        }} />
      )}

      {result.outcome === 'target' && result.reportable && speciesDetail && (
        <TargetResult result={result} detail={speciesDetail} imageUrl={imageUrl} />
      )}
      {result.outcome === 'target' && (!result.reportable || !speciesDetail) && (
        <UnsupportedTargetResult result={result} />
      )}
      {result.outcome === 'other_plant' && <OtherPlantResult result={result} />}
      {result.outcome === 'uncertain' && <UncertainResult result={result} />}

      {statusUncertain && (
        <div style={{
          marginTop: 16, padding: '12px 14px', borderRadius: 'var(--r-input)',
          background: '#FEF3E2', border: '1px solid #F0D9A8',
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--amber)' }}>Status uncertain</div>
          <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55 }}>
            InvaTrace cannot confirm the Malaysian status of this identification from the current reference data.
            Do not act on this plant and do not submit a sighting report from this result.
          </p>
        </div>
      )}

      {result.outcome !== 'uncertain' && !statusUncertain && (
        <PlantGuidancePanel
          scientificName={result.scientificName}
          speciesName={result.speciesName}
          plantId={result.speciesId}
          // AC 1.2.3: when the server marks this species non-eligible for
          // action, the guidance panel must never expose the active-removal
          // path regardless of the user's permission selection.
          actionEligible={speciesDetail?.actionEligible}
        />
      )}

      {/* AC 1.2.2 — per-species reviewed date + source, when the server supplies them.
          Wrap on narrow screens so the label + values don't overflow. */}
      {(speciesDetail?.statusReviewedAt || speciesDetail?.statusSourceId) && (
        <div style={{
          marginTop: 12, padding: '8px 12px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-input)',
          fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55,
          display: 'flex', flexWrap: 'wrap', gap: '2px 10px',
          wordBreak: 'break-word', overflowWrap: 'anywhere',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--body)' }}>Status record</span>
          {speciesDetail.statusSourceId && <span>Source: {speciesDetail.statusSourceId}</span>}
          {speciesDetail.statusReviewedAt && <span>Reviewed: {speciesDetail.statusReviewedAt}</span>}
        </div>
      )}

      <ModelInfo version={result.modelVersion} />

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button type="button" onClick={scanAgain} style={{
          flex: 1, height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
          border: '1px solid var(--border)', background: 'var(--surface)',
          fontWeight: 600, fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Icon name="RotateCcw" size={16} color="var(--body)" />
          Scan again
        </button>

        {canReport && (
          <button type="button" onClick={startReport} style={{
            flex: 1, height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
            border: 'none', background: 'var(--green)', color: '#fff',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Icon name="Send" size={16} color="#fff" />
            Report sighting
          </button>
        )}
      </div>

      {captureSource === 'gallery' && result.outcome !== 'other_plant' && !import.meta.env.DEV && (
        <p style={{ marginTop: 10, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5, textAlign: 'center' }}>
          Identification is complete. Capture a fresh camera photo to create a trusted field report.
        </p>
      )}
    </div>
  )
}

const OUTCOME_CONFIG = {
  target: { label: 'Invasive species detected', bg: 'var(--red-light)', border: 'var(--red-border)', color: 'var(--red)', icon: 'AlertTriangle' },
  other_plant: { label: 'Not a target species', bg: 'var(--green-light)', border: 'var(--green-border)', color: 'var(--green)', icon: 'Check' },
  uncertain: { label: 'Uncertain — another photo is needed', bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)', icon: 'HelpCircle' },
} as const

function OutcomeBadge({ outcome }: { outcome: IdentifyResult['outcome'] }) {
  const c = OUTCOME_CONFIG[outcome]
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
  // Compact header + confidence + side-by-side visual compare with the native
  // look-alike. Removal steps + do-not-dos + safety copy live in the shared
  // PlantGuidancePanel below so we don't duplicate them here.
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
        <RiskChip risk={detail.risk} />
      </div>

      <ConfidenceBand confidence={result.confidence} />

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
              caption="Native — do not remove"
            />
          </div>
          {detail.referenceImageUrl && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                Reference photo of {detail.name} for comparison
              </p>
              <ReferenceImage src={detail.referenceImageUrl} alt={`Reference photo of ${detail.name}`}
                credit={detail.referenceImageCredit} />
            </div>
          )}
          <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13, color: 'var(--body)', lineHeight: 1.65 }}>
            {detail.nativeTwin.distinguishingTraits.map((trait) => <li key={trait}>{trait}</li>)}
          </ul>
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
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 18, fontWeight: 650 }}>{result.speciesName ?? 'Not a tracked invasive'}</h2>
      {result.scientificName && result.scientificName !== result.speciesName && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, fontStyle: 'italic' }}>{result.scientificName}</p>
      )}
      <p style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 8, lineHeight: 1.6 }}>
        This identification is not listed as a target invasive for field removal. Do not remove it based on this result.
        If the plant still looks suspicious, capture another angle.
      </p>
      <ConfidenceBand confidence={result.confidence} />
    </div>
  )
}

function UncertainResult({ result }: { result: IdentifyResult }) {
  const navigate = useNavigate()
  const retake = () => {
    useScan.getState().reset()
    navigate('/scan', { replace: true })
  }
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Could not determine species</h2>
      <p style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 8, lineHeight: 1.6 }}>
        The model is not confident enough to identify this plant.
        The automated trust pipeline cannot validate this photo. Try again with:
      </p>
      <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: 'var(--body)', lineHeight: 1.7 }}>
        <li>Better lighting conditions</li>
        <li>A closer, sharper photograph</li>
        <li>A clear view of the leaf or flower</li>
      </ul>
      <ConfidenceBand confidence={result.confidence} />
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
  // Even without full detail we can still show a reference photo when the
  // guidance dataset carries one — helps the user eyeball the match.
  const guidance = findPlantGuidance({
    scientificName: result.scientificName ?? null,
    modelLabel: result.speciesName ?? null,
    plantId: result.speciesId ?? null,
  })
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--amber-light)' }}>
      <h2 style={{ fontSize: 18, fontWeight: 650 }}>{displayName}</h2>
      {scientific && (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, fontStyle: 'italic', marginTop: 2 }}>{scientific}</p>
      )}
      {guidance?.reference_image && (
        <figure style={{ margin: '10px 0 0' }}>
          <img
            src={guidance.reference_image}
            alt={`Reference photo of ${scientific ?? displayName}`}
            loading="lazy"
            style={{
              width: '100%', maxHeight: 220, objectFit: 'cover',
              borderRadius: 'var(--r-input)', display: 'block',
            }}
          />
          <figcaption style={{ marginTop: 4, fontSize: 10.5, color: 'var(--muted)' }}>
            Reference photo · {guidance.reference_image_credit ?? 'Wikimedia'}
          </figcaption>
        </figure>
      )}
      <p style={{ marginTop: 8, color: 'var(--body)', fontSize: 13.5, lineHeight: 1.6 }}>
        The model matched this plant, but detailed field guidance for it is not
        yet available in InvaTrace. Do not act on the plant from this result —
        record it visually and check back after the next data release.
      </p>
      <ConfidenceBand confidence={result.confidence} />
    </div>
  )
}

function ConfidenceBand({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const color = confidence >= 0.7 ? 'var(--green)' : confidence >= 0.5 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Confidence</span>
        <span style={{ fontWeight: 600, color }}>{pct}%</span>
      </div>
      <div style={{
        height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 3, background: color,
        }} />
      </div>
    </div>
  )
}

function RiskChip({ risk }: { risk: string }) {
  const isHigh = risk === 'high'
  return (
    <span style={{
      display: 'inline-block', marginTop: 8, padding: '3px 10px',
      borderRadius: 'var(--r-chip)', fontSize: 11, fontWeight: 600,
      background: isHigh ? 'var(--red-light)' : '#FEF3E2',
      color: isHigh ? 'var(--red)' : 'var(--amber)',
      border: `1px solid ${isHigh ? 'var(--red-border)' : '#F0D9A8'}`,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {risk} risk
    </span>
  )
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

function ModelInfo({ version }: { version: string }) {
  return (
    <div style={{
      marginTop: 20, padding: '10px 14px', borderRadius: 'var(--r-input)',
      background: 'var(--bg-alt)', border: '1px solid var(--border)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Model version</span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--body)' }}>
          {version}
        </span>
      </div>
      <p style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        Automated identification. Check the plant in person before acting on it.
      </p>
    </div>
  )
}
