import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { useReportDraft } from '@/features/report/report-draft-store'
import { submitReport } from '@/features/report/report-queue'
import { ReportNextButton } from './components/ReportNextButton'

const EXTENT_LABEL = {
  single: 'Single plant',
  small_patch: 'Small patch',
  large_area: 'Large area',
} as const

export function ReportPreviewStep() {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    draft, imageBlob, imageUrl, submitting,
    setSubmitting, setOutcome, toSubmission,
  } = useReportDraft()
  if (!draft) return null

  const submit = async () => {
    const submission = toSubmission()
    if (!submission || !imageBlob) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await submitReport(submission, imageBlob)
      if (result.status === 'submitted' && result.report) {
        setOutcome({ kind: 'submitted', report: result.report })
      } else {
        setOutcome({
          kind: 'queued',
          queuedId: result.queuedId ?? 'unknown',
          error: result.error ?? 'Unknown error',
        })
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The report could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!draft.location
    && draft.locationAccuracyM !== null
    && draft.locationAccuracyM <= 100
    && !!imageBlob
    && draft.consentAccurate
    && draft.consentNoPII

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {imageUrl && (
        <img src={imageUrl} alt="Report photo" style={{
          width: '100%', maxHeight: 220, objectFit: 'cover',
          borderRadius: 'var(--r-card)', display: 'block',
        }} />
      )}

      <Card>
        <Row icon="Leaf"
             label="Species"
             value={draft.speciesId ?? 'Unknown — automated validation will request a rescan if needed'} />
        <Divider />
        <Row icon="AlertTriangle"
             label="Outcome"
             value={`${draft.outcome.replace('_', ' ')} · ${Math.round(draft.confidence * 100)}% confidence`} />
        <Divider />
        <Row icon="MapPin"
             label="Location"
             value={draft.location
               ? `${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`
               : '—'}
             sub={draft.locationAccuracyM != null ? `±${draft.locationAccuracyM} m GPS` : 'Accuracy unavailable'}
             mono />
        <Divider />
        <Row icon="Grid3x3"
             label="Extent"
             value={EXTENT_LABEL[draft.extent]} />
        {draft.notes && (
          <>
            <Divider />
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0' }}>
              <Icon name="Info" size={18} color="var(--icon)" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Notes
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--ink)', marginTop: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {draft.notes}
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      <div style={{
        padding: '10px 14px', borderRadius: 'var(--r-input)',
        background: 'var(--bg-alt)', border: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Model version</span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
          {draft.modelVersion}
        </span>
      </div>

      <ReportNextButton
        disabled={!canSubmit}
        loading={submitting}
        onClick={submit}
        label={submitting ? 'Submitting…' : 'Submit report'}
        variant="submit"
      />
      {submitError && <p role="alert" style={{ color: 'var(--red-text)', fontSize: 13 }}>{submitError}</p>}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)', padding: '4px 16px',
    }}>
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)' }} />
}

function Row({ icon, label, value, sub, mono }: {
  icon: string; label: string; value: string; sub?: string; mono?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0' }}>
      <Icon name={icon} size={18} color="var(--icon)" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
        <div className={mono ? 'mono' : undefined}
             style={{ fontSize: 14, color: 'var(--ink)', marginTop: 3, fontWeight: 500, textTransform: mono ? 'none' : 'capitalize' }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}
