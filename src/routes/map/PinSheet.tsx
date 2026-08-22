import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { useMap } from '@/lib/map-store'
import type { SightingDetail, SightingStatus } from '@/types'

const STATUS_LABEL: Record<SightingStatus, string> = {
  candidate: 'Awaiting verification',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  removed: 'Removed',
}

const STATUS_COLOR: Record<SightingStatus, string> = {
  candidate: 'var(--amber)',
  confirmed: 'var(--green)',
  rejected: 'var(--muted)',
  removed: 'var(--icon)',
}

export function PinSheet() {
  const { selectedId, select } = useMap()

  const { data, isLoading } = useQuery({
    queryKey: ['sighting', selectedId],
    queryFn: () => api<SightingDetail>(`/api/v1/sightings/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  if (!selectedId) return null

  return (
    <>
      <div onClick={() => select(null)}
           aria-hidden
           style={{
             position: 'absolute', inset: 0, background: 'rgba(20,32,27,0.28)', zIndex: 6,
           }} />
      <aside role="dialog" aria-label="Sighting details" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 7,
        background: 'var(--surface)', borderTopLeftRadius: 18, borderTopRightRadius: 18,
        boxShadow: '0 -4px 16px rgba(20,40,30,0.14)',
        padding: '14px 18px 22px', maxHeight: '70%', overflowY: 'auto',
      }}>
        <div style={{
          width: 40, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '0 auto 12px',
        }} />

        {isLoading || !data ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Loading…
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                  {data.speciesName}
                </h2>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
                  {data.latinName}
                </div>
              </div>
              <button type="button" onClick={() => select(null)} aria-label="Close" style={{
                width: 32, height: 32, borderRadius: '50%', border: 'none',
                background: 'var(--hover)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="X" size={16} color="var(--body)" />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <Pill bg="var(--red-light)" border="var(--red-border)" fg="var(--red)"
                    label={`${data.risk === 'high' ? 'High' : 'Watch'} risk`} />
              <Pill bg="var(--bg-alt)" border="var(--border)" fg={STATUS_COLOR[data.status]}
                    label={STATUS_LABEL[data.status]} />
              <Pill bg="var(--bg-alt)" border="var(--border)" fg="var(--body)"
                    label={`${data.reportCount} report${data.reportCount === 1 ? '' : 's'}`} />
            </div>

            <div style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 'var(--r-input)',
              background: 'var(--green-light)', border: '1px solid var(--green-border)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 600,
                            textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Recommended action
              </div>
              <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5 }}>
                {data.recommendedAction}
              </div>
            </div>

            <Row label="Coordinates"
                 value={`${data.location.lat.toFixed(5)}, ${data.location.lng.toFixed(5)}`}
                 sub={data.precisionReduced ? 'Location approximated — precision policy §11' : undefined}
                 mono />
            <Row label="Last reported" value={formatTime(data.lastReportedAt)} />
            <Row label="Reporter trust" value={data.reporterTrust} />
          </>
        )}
      </aside>
    </>
  )
}

function Row({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div className={mono ? 'mono' : undefined}
           style={{ marginTop: 3, fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--amber)', lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

function Pill({ bg, border, fg, label }: { bg: string; border: string; fg: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
      borderRadius: 'var(--r-chip)', background: bg, border: `1px solid ${border}`,
      fontSize: 11.5, fontWeight: 600, color: fg,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {label}
    </span>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const mins = Math.round((now - d.getTime()) / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}
