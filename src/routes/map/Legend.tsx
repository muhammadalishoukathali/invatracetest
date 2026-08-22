export function Legend() {
  return (
    <div style={{
      position: 'absolute', bottom: 32, left: 12, zIndex: 5,
      padding: '10px 12px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-sm)', fontSize: 12,
      display: 'flex', flexDirection: 'column', gap: 6, minWidth: 148,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)',
                    textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Legend
      </div>
      <Row colour="#C2412D" label="High risk" />
      <Row colour="#D9880F" label="Watch" />
      <Row colour="#8B978F" label="Removed" muted />
      <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
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
        background: colour, border: '1.5px solid #fff', boxShadow: '0 0 0 1px var(--border)',
        opacity: muted ? 0.65 : 1,
      }} />
      <span style={{ color: 'var(--body)' }}>{label}</span>
    </div>
  )
}
