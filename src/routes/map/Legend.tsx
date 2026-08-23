import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/lib/useIsDesktop'

export function Legend() {
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(isDesktop)  // desktop opens by default

  /* Mobile: floating toggle chip that expands into the panel. Desktop keeps
     the always-open card since screen real estate is not scarce there. */
  if (!isDesktop && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Show legend" style={{
        position: 'absolute', bottom: 40, left: 12, zIndex: 5,
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-chip)', boxShadow: 'var(--shadow-sm)',
        fontSize: 12, fontWeight: 500, color: 'var(--body)', cursor: 'pointer',
      }}>
        <Icon name="Info" size={14} color="var(--body)" />
        Legend
      </button>
    )
  }

  return (
    <div style={{
      position: 'absolute', bottom: 40, left: 12, zIndex: 5,
      padding: '10px 12px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-sm)', fontSize: 12,
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
            width: 20, height: 20, borderRadius: '50%', border: 'none',
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
      }}>
        Dashed ring = candidate<br />(location approximate)
      </div>
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
