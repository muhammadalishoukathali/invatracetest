import { createPortal } from 'react-dom'
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

  const riskColor = data?.risk === 'high' ? 'var(--red)' : 'var(--amber)'
  const riskLight = data?.risk === 'high' ? 'var(--red-light)' : '#FEF3E2'
  const riskBorder = data?.risk === 'high' ? 'var(--red-border)' : '#F0D9A8'

  /* Portalled so it escapes the map container's stacking context and always
   *  sits above the Legend chip and MapLibre controls. */
  return createPortal(
    <>
      <div onClick={() => select(null)}
           aria-hidden
           style={{
             position: 'fixed', inset: 0, background: 'rgba(20,32,27,0.35)', zIndex: 9998,
           }} />
      <aside role="dialog" aria-label="Sighting details" aria-modal="true" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: 'var(--surface)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: '0 -8px 24px rgba(20,40,30,0.18)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        maxHeight: '78dvh', overflowY: 'auto',
      }}>
        {/* Coloured spine hugging the top edge; instantly signals risk level. */}
        <div aria-hidden style={{
          height: 4, background: data ? riskColor : 'var(--border)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
        }} />
        <div style={{
          width: 40, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '10px auto 4px',
        }} />

        <div style={{ padding: '4px 20px 20px' }}>
          {isLoading || !data ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Loading sighting…
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12, minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                  {/* Species avatar tile — coloured circle with leaf glyph. */}
                  <div aria-hidden style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: riskLight, border: `1px solid ${riskBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="Leaf" size={22} color={riskColor} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                      {data.speciesName}
                    </h2>
                    <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
                      {data.latinName}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => select(null)} aria-label="Close" style={{
                  width: 34, height: 34, borderRadius: '50%', border: 'none',
                  background: 'var(--hover)', cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name="X" size={16} color="var(--body)" />
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
                <Pill bg={riskLight} border={riskBorder} fg={riskColor}
                      label={`${data.risk === 'high' ? 'High' : 'Watch'} risk`} />
                <Pill bg="var(--bg-alt)" border="var(--border)" fg={STATUS_COLOR[data.status]}
                      label={STATUS_LABEL[data.status]} />
                <Pill bg="var(--bg-alt)" border="var(--border)" fg="var(--body)"
                      label={`${data.reportCount} report${data.reportCount === 1 ? '' : 's'}`} />
              </div>

              <div style={{
                marginTop: 16, padding: '14px 16px', borderRadius: 'var(--r-card)',
                background: 'var(--green-light)', border: '1px solid var(--green-border)',
                display: 'flex', gap: 12, alignItems: 'flex-start',
              }}>
                <Icon name="ShieldCheck" size={18} color="var(--green-dark)" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 600,
                                textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Recommended action
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
                    {data.recommendedAction}
                  </div>
                </div>
              </div>

              <MetaRow icon="MapPin"
                       label="Coordinates"
                       value={`${data.location.lat.toFixed(5)}, ${data.location.lng.toFixed(5)}`}
                       sub={data.precisionReduced ? 'Location approximated — precision policy §11' : undefined}
                       mono />
              <MetaRow icon="Clock" label="Last reported" value={formatTime(data.lastReportedAt)} />
              <MetaRow icon="User" label="Reporter trust" value={data.reporterTrust} />
            </>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}

function MetaRow({ icon, label, value, sub, mono }: {
  icon: string; label: string; value: string; sub?: string; mono?: boolean
}) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)',
    }}>
      <Icon name={icon} size={16} color="var(--icon)" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
        <div className={mono ? 'mono' : undefined}
             style={{ marginTop: 3, fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>
          {value}
        </div>
        {sub && <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--amber)', lineHeight: 1.5 }}>{sub}</div>}
      </div>
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
