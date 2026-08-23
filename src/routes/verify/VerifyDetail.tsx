/** Evidence view + Confirm / Reject / Merge actions for one queued report. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import type { MergeCandidate, VerifyCheck, VerifyItem } from '@/types'

const EXTENT_LABEL = { single: 'Single', small_patch: 'Small patch', large_area: 'Large area' } as const

interface Props { id: string; onDone: () => void; onBack: () => void }

export function VerifyDetail({ id, onDone, onBack }: Props) {
  const qc = useQueryClient()
  const [mergeOpen, setMergeOpen] = useState(false)

  const { data: item, isLoading } = useQuery({
    queryKey: ['verify', id],
    queryFn: () => api<VerifyItem>(`/api/v1/verify/${id}`),
    staleTime: 10_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['verify-queue'] })

  const confirm = useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/v1/verify/${id}/confirm`, { method: 'POST' }),
    onSuccess: () => { invalidate(); onDone() },
  })
  const reject = useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/v1/verify/${id}/reject`, { method: 'POST' }),
    onSuccess: () => { invalidate(); onDone() },
  })
  const merge = useMutation({
    mutationFn: (targetId: string) => api<{ ok: true; mergedInto: string }>(
      `/api/v1/verify/${id}/merge`,
      { method: 'POST', body: JSON.stringify({ targetId }) },
    ),
    onSuccess: () => { invalidate(); onDone() },
  })

  if (isLoading || !item) return <div style={{ padding: 20, color: 'var(--muted)' }}>Loading…</div>

  const busy = confirm.isPending || reject.isPending || merge.isPending

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button type="button" onClick={onBack} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
        padding: '6px 4px', background: 'transparent', border: 'none',
        color: 'var(--body)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
      }}>
        <Icon name="ChevronLeft" size={16} color="var(--body)" />
        Back to queue
      </button>

      <img src={item.photoUrl} alt={item.speciesName} style={{
        width: '100%', maxHeight: 320, objectFit: 'cover',
        borderRadius: 'var(--r-card)', background: 'var(--bg-alt)',
      }} />

      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          {item.speciesName}
        </h2>
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
          {item.latinName}
        </div>
        {item.notes && (
          <p style={{ marginTop: 10, padding: '10px 12px', borderRadius: 'var(--r-input)',
                      background: 'var(--bg-alt)', border: '1px solid var(--border)',
                      fontSize: 13.5, color: 'var(--body)', lineHeight: 1.55 }}>
            {item.notes}
          </p>
        )}
      </div>

      <section>
        <SectionTitle>Checks</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {item.checks.map((c) => <CheckRow key={c.id} c={c} />)}
        </div>
      </section>

      <section>
        <SectionTitle>Metadata</SectionTitle>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)', padding: '4px 16px',
        }}>
          <Meta label="Place" value={item.place} />
          <Meta label="Coordinates"
                value={`${item.location.lat.toFixed(5)}, ${item.location.lng.toFixed(5)}`}
                sub={item.locationAccuracyM != null ? `±${item.locationAccuracyM} m GPS` : 'Manual entry'}
                mono />
          <Meta label="Extent" value={EXTENT_LABEL[item.extent]} />
          <Meta label="Submitted" value={formatFull(item.submittedAt)} />
          <Meta label="Model" value={`${item.outcome} · ${Math.round(item.confidence * 100)}%`}
                sub={item.modelVersion} mono />
        </div>
      </section>

      {mergeOpen ? (
        <MergePicker
          id={id}
          onCancel={() => setMergeOpen(false)}
          onPick={(targetId) => merge.mutate(targetId)}
          busy={busy}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 4 }}>
          <Action label="Reject" icon="X" tone="red" onClick={() => reject.mutate()} disabled={busy} />
          <Action label="Merge" icon="Grid3x3" tone="neutral" onClick={() => setMergeOpen(true)} disabled={busy} />
          <Action label="Confirm" icon="Check" tone="green" onClick={() => confirm.mutate()} disabled={busy} />
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 11, color: 'var(--muted)', fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
    }}>{children}</h3>
  )
}

function CheckRow({ c }: { c: VerifyCheck }) {
  const tint = c.level === 'pass' ? 'var(--green)' : c.level === 'warn' ? 'var(--amber)' : 'var(--red)'
  const bg = c.level === 'pass' ? 'var(--green-light)' : c.level === 'warn' ? '#FEF3E2' : 'var(--red-light)'
  const border = c.level === 'pass' ? 'var(--green-border)' : c.level === 'warn' ? '#F0D9A8' : 'var(--red-border)'
  const iconName = c.level === 'pass' ? 'Check' : 'AlertTriangle'
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '10px 14px', borderRadius: 'var(--r-input)',
      background: bg, border: `1px solid ${border}`,
    }}>
      <Icon name={iconName} size={16} color={tint} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{c.label}</div>
        <div style={{ fontSize: 12, color: 'var(--body)', marginTop: 2, lineHeight: 1.5 }}>{c.detail}</div>
      </div>
    </div>
  )
}

function Meta({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500,
                    textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div className={mono ? 'mono' : undefined}
           style={{ marginTop: 3, fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>
        {value}
      </div>
      {sub && <div className={mono ? 'mono' : undefined}
                   style={{ marginTop: 2, fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

function Action({ label, icon, tone, onClick, disabled }: {
  label: string; icon: string; tone: 'green' | 'red' | 'neutral'
  onClick: () => void; disabled?: boolean
}) {
  const styles = {
    green: { bg: 'var(--green)', fg: '#fff', border: 'var(--green)' },
    red: { bg: 'var(--red-light)', fg: 'var(--red)', border: 'var(--red-border)' },
    neutral: { bg: 'var(--surface)', fg: 'var(--body)', border: 'var(--border)' },
  }[tone]
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
      border: `1px solid ${styles.border}`, background: styles.bg, color: styles.fg,
      fontWeight: 600, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      <Icon name={icon} size={16} color={styles.fg} />
      {label}
    </button>
  )
}

function MergePicker({ id, onCancel, onPick, busy }: {
  id: string; onCancel: () => void; onPick: (targetId: string) => void; busy: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['merge-candidates', id],
    queryFn: () => api<{ items: MergeCandidate[] }>(`/api/v1/verify/${id}/merge-candidates`),
    staleTime: 10_000,
  })
  const items = data?.items ?? []

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)', padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Merge into…</div>
        <button type="button" onClick={onCancel} aria-label="Cancel" style={{
          width: 28, height: 28, borderRadius: '50%', border: 'none',
          background: 'var(--hover)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="X" size={14} color="var(--body)" />
        </button>
      </div>

      {isLoading && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
      {!isLoading && items.length === 0 && (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No nearby sightings of this species within 500 m. Confirm as new instead.
        </div>
      )}

      {items.length > 0 && (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none' }}>
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c.id)} disabled={busy} style={{
                width: '100%', textAlign: 'left', padding: '10px 12px',
                borderRadius: 'var(--r-input)', border: '1px solid var(--border)',
                background: 'var(--bg-alt)', cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                    {c.speciesName}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                    {c.status} · {c.reportCount} report{c.reportCount === 1 ? '' : 's'}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 12, color: 'var(--body)' }}>
                  {c.distanceM} m
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatFull(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
