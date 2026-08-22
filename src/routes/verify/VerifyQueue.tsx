/** List of pending candidate reports for coordinators. Clicking one opens
 *  <VerifyDetail /> in the same view (URL param drives it). Empty state
 *  shows when the queue is drained. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import type { VerifyItem } from '@/types'
import { VerifyDetail } from './VerifyDetail'

const EXTENT_LABEL = { single: 'Single', small_patch: 'Small patch', large_area: 'Large area' } as const

export function VerifyQueue() {
  const [selected, setSelected] = useState<string | null>(null)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['verify-queue'],
    queryFn: () => api<{ items: VerifyItem[] }>('/api/v1/verify/queue'),
    staleTime: 10_000,
  })

  const items = data?.items ?? []

  if (selected) {
    return (
      <VerifyDetail
        id={selected}
        onDone={() => { setSelected(null); refetch() }}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <p style={{ fontSize: 13.5, color: 'var(--body)', marginBottom: 16, lineHeight: 1.6 }}>
        Candidate reports awaiting coordinator verification. Only <strong>confirmed</strong> sightings
        appear on the public threat map.
      </p>

      {isLoading && <Empty msg="Loading queue…" />}
      {!isLoading && items.length === 0 && (
        <Empty msg="Queue is empty. Nice work." tone="green" />
      )}

      <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none' }}>
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" onClick={() => setSelected(it.id)} style={rowStyle}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <img src={it.photoUrl} alt="" style={{
                  width: 64, height: 64, borderRadius: 'var(--r-input)',
                  objectFit: 'cover', background: 'var(--bg-alt)', flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {it.speciesName}
                    </span>
                    <TrustPill trust={it.submitterTrust} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    <span className="mono">{it.location.lat.toFixed(4)}, {it.location.lng.toFixed(4)}</span>
                    {' · '}
                    {EXTENT_LABEL[it.extent]}
                    {' · '}
                    {formatAgo(it.submittedAt)}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {it.checks.map((c) => (
                      <CheckDot key={c.id} level={c.level} label={c.label} />
                    ))}
                  </div>
                </div>
                <Icon name="ChevronRight" size={18} color="var(--icon)" />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  width: '100%', textAlign: 'left', padding: '14px 16px',
  border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
  background: 'var(--surface)', cursor: 'pointer',
}

function TrustPill({ trust }: { trust: string }) {
  const isNew = trust === 'New'
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 'var(--r-chip)',
      background: isNew ? '#FEF3E2' : 'var(--green-light)',
      color: isNew ? 'var(--amber)' : 'var(--green-dark)',
      fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {trust} reporter
    </span>
  )
}

function CheckDot({ level, label }: { level: 'pass' | 'warn' | 'fail'; label: string }) {
  const c = level === 'pass' ? 'var(--green)' : level === 'warn' ? 'var(--amber)' : 'var(--red)'
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, color: 'var(--muted)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
      {label}
    </span>
  )
}

function Empty({ msg, tone = 'muted' }: { msg: string; tone?: 'muted' | 'green' }) {
  return (
    <div style={{
      padding: '32px 20px', textAlign: 'center',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)',
      color: tone === 'green' ? 'var(--green-dark)' : 'var(--muted)',
      fontSize: 13.5,
    }}>
      {msg}
    </div>
  )
}

function formatAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}
