import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useReport } from '@/lib/report-store'
import { useScan } from '@/lib/scan-store'

export function Submitted() {
  const navigate = useNavigate()
  const { outcome, reset } = useReport()

  const done = (dest: string) => {
    reset()
    useScan.getState().reset()
    navigate(dest, { replace: true })
  }

  if (!outcome) return null

  const submitted = outcome.kind === 'submitted'

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)',
    }}>
      <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: submitted ? 'var(--green-light)' : '#FEF3E2',
          border: `1px solid ${submitted ? 'var(--green-border)' : '#F0D9A8'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <Icon
            name={submitted ? 'CircleCheck' : 'WifiOff'}
            size={36}
            color={submitted ? 'var(--green)' : 'var(--amber)'}
          />
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          {submitted ? 'Report submitted' : 'Saved for later'}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body)', marginTop: 10, lineHeight: 1.6 }}>
          {submitted
            ? 'Coordinators will review your report and update its status. Thank you for contributing.'
            : "You're offline or the server is unavailable. We'll retry automatically when connectivity returns."}
        </p>

        {submitted && outcome.kind === 'submitted' && (
          <div style={{
            marginTop: 20, padding: '10px 14px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-input)', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Tracking ID</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
              {outcome.report.id.slice(0, 8)}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
          <button type="button" onClick={() => done('/map')} style={{
            height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
            border: 'none', background: 'var(--green)', color: '#fff',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Icon name="MapPinned" size={16} color="#fff" />
            Back to map
          </button>
          <button type="button" onClick={() => done('/scan')} style={{
            height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
            border: '1px solid var(--border)', background: 'var(--surface)',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Icon name="ScanLine" size={16} color="var(--body)" />
            Scan another
          </button>
        </div>
      </div>
    </div>
  )
}
