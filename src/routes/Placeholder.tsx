export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)', padding: 22, maxWidth: 620,
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h2>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        Shell is in place. This screen is built in {phase}.
      </p>
    </div>
  )
}
