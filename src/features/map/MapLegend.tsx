import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import './map-controls.css'

export function MapLegend() {
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(isDesktop)

  /* Mobile starts with a small Legend button so the card does not cover the
     map. Desktop starts with the full legend because there is more room. */
  if (!isDesktop && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Show legend"
        className="map-legend-toggle" style={{
        position: 'absolute', bottom: 'var(--map-legend-bottom)', left: 12, zIndex: 5,
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
        borderRadius: 'var(--r-chip)',
        fontSize: 12, fontWeight: 500, color: 'var(--body)', cursor: 'pointer',
      }}>
        <Icon name="Info" size={14} color="var(--body)" />
        Legend
      </button>
    )
  }

  return (
    <div className="map-legend-card" style={{
      position: 'absolute', bottom: 'var(--map-legend-bottom)', left: 12, zIndex: 5,
      padding: '10px 12px', borderRadius: 'var(--r-card)', fontSize: 12,
      display: 'flex', flexDirection: 'column', gap: 6, minWidth: 152,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>Legend</span>
        {!isDesktop && (
          <button type="button" onClick={() => setOpen(false)} aria-label="Hide legend" style={{
            width: 44, height: 44, borderRadius: '50%', border: 'none',
            background: 'transparent', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="X" size={12} color="var(--muted)" />
          </button>
        )}
      </div>
      <Row colour="#C2412D" label="High risk" />
      <Row colour="#D9880F" label="Watch" />
      <Row colour="#8B978F" label="Removed" muted />
      <div style={{
        marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)',
        fontSize: 11, color: 'var(--muted)', lineHeight: 1.5,
      }}>Only automatically validated records appear here.</div>
    </div>
  )
}

function Row({ colour, label, muted }: { colour: string; label: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span aria-hidden style={{
        width: 12, height: 12, borderRadius: '50%',
        background: colour, border: '1.5px solid #fff',
        boxShadow: '0 0 0 1px var(--border)',
        opacity: muted ? 0.65 : 1,
      }} />
      <span style={{ color: 'var(--body)' }}>{label}</span>
    </div>
  )
}
