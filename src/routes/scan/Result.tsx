import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/lib/scan-store'
import { useReport } from '@/lib/report-store'
import type { IdentifyResult, SpeciesDetail } from '@/types'

export function Result() {
  const navigate = useNavigate()
  const { imageUrl, result, speciesDetail } = useScan()

  if (!result) {
    navigate('/scan', { replace: true })
    return null
  }

  const scanAgain = () => {
    useScan.getState().reset()
    navigate('/scan', { replace: true })
  }

  const startReport = () => {
    const { imageBlob, imageUrl: url } = useScan.getState()
    if (!imageBlob || !url) return
    useReport.getState().beginFromScan({ result, imageBlob, imageUrl: url })
    navigate('/report')
  }

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', paddingBottom: 32 }}>
      <OutcomeBadge outcome={result.outcome} />

      {imageUrl && (
        <img src={imageUrl} alt="Scanned plant" style={{
          width: '100%', maxHeight: 220, objectFit: 'cover',
          borderRadius: 'var(--r-card)', marginTop: 16, display: 'block',
        }} />
      )}

      {result.outcome === 'target' && speciesDetail && (
        <TargetResult result={result} detail={speciesDetail} />
      )}
      {result.outcome === 'other_plant' && <OtherPlantResult result={result} />}
      {result.outcome === 'uncertain' && <UncertainResult result={result} />}

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

        {(result.outcome === 'target' || result.outcome === 'uncertain') && (
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
    </div>
  )
}

/* ── Outcome badge ──────────────────────────────────────── */

const OUTCOME_CONFIG = {
  target: { label: 'Invasive species detected', bg: 'var(--red-light)', border: 'var(--red-border)', color: 'var(--red)', icon: 'AlertTriangle' },
  other_plant: { label: 'Not a target species', bg: 'var(--green-light)', border: 'var(--green-border)', color: 'var(--green)', icon: 'Check' },
  uncertain: { label: 'Uncertain — review recommended', bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)', icon: 'HelpCircle' },
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

/* ── Target result ──────────────────────────────────────── */

function TargetResult({ result, detail }: { result: IdentifyResult; detail: SpeciesDetail }) {
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

      <Section title="Key traits">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {detail.traits.map((t) => (
            <div key={t.label} style={{ fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600 }}>{t.label}:</span>{' '}
              <span style={{ color: 'var(--body)' }}>{t.value}</span>
            </div>
          ))}
        </div>
      </Section>

      {detail.nativeTwin && (
        <Section title="Native look-alike" icon="Leaf">
          <div style={{
            padding: '12px 14px', borderRadius: 'var(--r-input)',
            background: 'var(--green-light)', border: '1px solid var(--green-border)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{detail.nativeTwin.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
              {detail.nativeTwin.latinName}
            </div>
            <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 13, color: 'var(--body)', lineHeight: 1.6 }}>
              {detail.nativeTwin.distinguishingTraits.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      <Section title="Safe removal steps" icon="ShieldCheck">
        <ol style={{ paddingLeft: 20, fontSize: 13, color: 'var(--body)', lineHeight: 1.7 }}>
          {detail.removalSteps.map((s) => (
            <li key={s.order}>{s.action}</li>
          ))}
        </ol>
      </Section>

      {detail.doNotDo.length > 0 && (
        <Section title="Do NOT do" icon="XOctagon">
          <div style={{
            padding: '10px 14px', borderRadius: 'var(--r-input)',
            background: 'var(--red-light)', border: '1px solid var(--red-border)',
          }}>
            <ul style={{ paddingLeft: 16, fontSize: 13, color: 'var(--red)', lineHeight: 1.7 }}>
              {detail.doNotDo.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}
    </>
  )
}

/* ── Other plant ────────────────────────────────────────── */

function OtherPlantResult({ result }: { result: IdentifyResult }) {
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Not a tracked invasive</h2>
      <p style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 8, lineHeight: 1.6 }}>
        This plant does not match any of the invasive species currently tracked by InvaTrace.
        If you believe this is incorrect, try photographing from a different angle or submit for expert review.
      </p>
      <ConfidenceBand confidence={result.confidence} />
    </div>
  )
}

/* ── Uncertain ──────────────────────────────────────────── */

function UncertainResult({ result }: { result: IdentifyResult }) {
  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>Could not determine species</h2>
      <p style={{ fontSize: 13.5, color: 'var(--body)', marginTop: 8, lineHeight: 1.6 }}>
        The model is not confident enough to identify this plant.
        You can still submit it for expert review, or try again with:
      </p>
      <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: 'var(--body)', lineHeight: 1.7 }}>
        <li>Better lighting conditions</li>
        <li>A closer, sharper photograph</li>
        <li>A clear view of the leaf or flower</li>
      </ul>
      <ConfidenceBand confidence={result.confidence} />
    </div>
  )
}

/* ── Shared components ──────────────────────────────────── */

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
          transition: 'width 0.3s ease',
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
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Model version</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--body)' }}>
        {version}
      </span>
    </div>
  )
}
