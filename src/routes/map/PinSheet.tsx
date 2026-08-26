import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { useMap } from '@/lib/map-store'
import { useDialogA11y } from '@/lib/useDialogA11y'
import type { SightingDetail, SightingStatus } from '@/types'

const STATUS_LABEL: Record<SightingStatus, string> = {
  candidate: 'Awaiting verification',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  removed: 'Removed',
}

const STATUS_COLOR: Record<SightingStatus, string> = {
  candidate: 'var(--amber-text)',
  confirmed: 'var(--green)',
  rejected: 'var(--muted)',
  removed: 'var(--icon)',
}

export function PinSheet() {
  const { selectedId, select } = useMap()
  const dialogRef = useRef<HTMLElement>(null)
  const close = () => select(null)
  useDialogA11y(dialogRef, close, {
    active: !!selectedId,
    returnFocus: () => selectedId
      ? document.querySelector<HTMLElement>(`.map-pin[data-sighting-id="${CSS.escape(selectedId)}"]`)
      : null,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sighting', selectedId],
    queryFn: () => api<SightingDetail>(`/api/v1/sightings/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  if (!selectedId) return null

  const isHigh = data?.risk === 'high'
  const isRemoved = data?.status === 'removed'
  const riskAccent = isRemoved
    ? 'var(--icon)'
    : isHigh ? 'var(--red)' : 'var(--amber)'
  const riskColor = isHigh ? 'var(--red-text)' : 'var(--amber-text)'
  const riskLight = isHigh ? 'var(--red-light)' : 'var(--amber-light)'
  const riskBorder = isHigh ? 'var(--red-border)' : 'var(--amber-border)'
  const coordinateDecimals = data?.precisionReduced ? 4 : 5
  const directionsHref = data
    ? `https://www.google.com/maps/dir/?api=1&destination=${data.location.lat},${data.location.lng}`
    : '#'

  /* Portalled so it escapes the map container's stacking context and always
   *  sits above the Legend chip and MapLibre controls. */
  return createPortal(
    <>
      <div onClick={close}
           aria-hidden
           style={{
             position: 'fixed', inset: 0, background: 'rgba(20,32,27,0.35)', zIndex: 9998,
           }} />
      <aside ref={dialogRef} tabIndex={-1} className="pin-sheet"
        role="dialog" aria-label="Sighting details" aria-modal="true" style={{
        zIndex: 9999, background: data ? riskAccent : 'var(--border)',
        boxShadow: 'var(--shadow-sheet)', paddingTop: 6,
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* The sheet background forms one continuous rounded risk-colour shell;
            CSS overlays its white inner surface below the six-pixel accent. */}
        <div className="pin-sheet__handle" aria-hidden style={{
          width: 40, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '12px auto 6px', flexShrink: 0,
        }} />

        <button type="button" onClick={close} aria-label="Close" data-dialog-initial style={{
          position: 'absolute', top: 14, right: 20, zIndex: 1,
          width: 44, height: 44, borderRadius: '50%', border: 'none',
          background: 'var(--hover)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="X" size={17} color="var(--body)" />
        </button>

        <div className="pin-sheet__content" style={{ overflowY: 'auto', flex: 1 }}>
          {isError ? (
            <div role="alert" style={{ padding: '32px 0', textAlign: 'center' }}>
              <p style={{ color: 'var(--red-text)', fontSize: 13.5 }}>
                Could not load this sighting.
              </p>
              <button type="button" onClick={() => void refetch()} style={{
                marginTop: 12, minHeight: 44, padding: '0 18px',
                borderRadius: 'var(--r-button)', border: '1px solid var(--control-border)',
                background: 'var(--surface)', fontWeight: 600, cursor: 'pointer',
              }}>
                Try again
              </button>
            </div>
          ) : isLoading || !data ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Loading sighting…
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingRight: 52 }}>
                <div style={{ display: 'flex', gap: 12, minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                  <div aria-hidden style={{
                    width: 46, height: 46, borderRadius: 12, flexShrink: 0,
                    background: riskLight, border: `1px solid ${riskBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="Leaf" size={22} color={riskColor} />
                  </div>
                  <div style={{ minWidth: 0, paddingTop: 2 }}>
                    <h2 style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                      {data.speciesName}
                    </h2>
                    <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic', marginTop: 3 }}>
                      {data.latinName}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
                <Pill bg={riskLight} border={riskBorder} fg={riskColor}
                      label={`${isHigh ? 'High' : 'Watch'} risk`} />
                <Pill bg="var(--bg-alt)" border="var(--border)" fg={STATUS_COLOR[data.status]}
                      label={STATUS_LABEL[data.status]} />
              </div>

              <div style={{
                marginTop: 16, padding: '14px 16px', borderRadius: 'var(--r-card)',
                background: 'var(--green-light)', border: '1px solid var(--green-border)',
                display: 'flex', gap: 12, alignItems: 'flex-start',
              }}>
                <Icon name="ShieldCheck" size={18} color="var(--green-dark)" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 700,
                                textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Recommended action
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
                    {data.recommendedAction}
                  </div>
                </div>
              </div>

              {/* Compact metadata grid — two per row on wide phones, one column on narrow. */}
              <div className="pin-sheet__meta" style={{
                marginTop: 16, display: 'grid',
                gap: 10,
              }}>
                <MetaTile icon="MapPin" label="Coordinates"
                          value={`${data.location.lat.toFixed(coordinateDecimals)}, ${data.location.lng.toFixed(coordinateDecimals)}`}
                          sub={data.precisionReduced ? '≈ approximated' : undefined} mono />
                <MetaTile icon="Clock" label="Last reported"
                          value={formatTime(data.lastReportedAt)} />
                <MetaTile icon="User" label="Reporter trust"
                          value={data.reporterTrust} />
                <MetaTile icon="ClipboardList" label="Reports"
                          value={`${data.reportCount}`} />
              </div>

              {data.precisionReduced && (
                <p style={{
                  marginTop: 12, fontSize: 11.5, color: 'var(--muted)',
                  lineHeight: 1.5, display: 'flex', gap: 6, alignItems: 'flex-start',
                }}>
                  <Icon name="Info" size={13} color="var(--muted)" />
                  <span>Location approximated per precision policy (Arch §11) — candidate and new-trust pins are jittered ~100 m.</span>
                </p>
              )}
            </>
          )}
        </div>

        {data && (
          <div className="pin-sheet__footer" style={{
            display: 'flex', gap: 10,
            borderTop: '1px solid var(--border)', background: 'var(--surface)',
            flexShrink: 0,
          }}>
            <a href={directionsHref} target="_blank" rel="noopener noreferrer" style={{
              flex: 1, height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--body)', fontWeight: 600, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              textDecoration: 'none',
            }}>
              <Icon name="Navigation" size={16} color="var(--body)" />
              Directions
            </a>
            <button type="button" onClick={close} style={{
              flex: 1, height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
              border: 'none', background: 'var(--green)', color: '#fff',
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Icon name="Check" size={16} color="#fff" />
              Got it
            </button>
          </div>
        )}
      </aside>
    </>,
    document.body,
  )
}

function MetaTile({ icon, label, value, sub, mono }: {
  icon: string; label: string; value: string; sub?: string; mono?: boolean
}) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: 'var(--bg-alt)', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Icon name={icon} size={13} color="var(--muted)" />
        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
      </div>
      <div className={mono ? 'mono' : undefined}
           style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--amber-text)' }}>{sub}</div>}
    </div>
  )
}

function Pill({ bg, border, fg, label }: { bg: string; border: string; fg: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '4px 10px',
      borderRadius: 'var(--r-chip)', background: bg, border: `1px solid ${border}`,
      fontSize: 11.5, fontWeight: 700, color: fg,
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
