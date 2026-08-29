import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import type { QueuedReport } from '@/types'

interface Props {
  queue: QueuedReport[]
  onClose: () => void
  onRetry: () => void
  onDiscard: (id: string) => void
  flushing: boolean
  activeProfileId: string | null
}

/** Right-side drawer listing IndexedDB-queued reports awaiting sync. */
export function ReportQueueDrawer({
  queue, onClose, onRetry, onDiscard, flushing, activeProfileId,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogA11y(dialogRef, onClose)

  return createPortal(
    <>
      <div onClick={onClose} aria-hidden style={{
        position: 'fixed', inset: 0, background: 'rgba(20,32,27,0.32)', zIndex: 9998,
      }} />
      <aside ref={dialogRef} tabIndex={-1}
        role="dialog" aria-label="Queued reports" aria-modal="true" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9999,
        width: 'min(420px, 100vw)', background: 'var(--surface)',
        boxShadow: '-4px 0 16px rgba(20,40,30,0.14)',
        display: 'flex', flexDirection: 'column',
      }}>
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: 'max(14px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) 14px max(18px, env(safe-area-inset-left))',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Pending sync</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {queue.length} report{queue.length === 1 ? '' : 's'} waiting
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" data-dialog-initial style={{
            width: 44, height: 44, borderRadius: '50%', border: 'none',
            background: 'var(--hover)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="X" size={14} color="var(--body)" />
          </button>
        </header>

        <ul style={{
          flex: 1, overflowY: 'auto', listStyle: 'none',
          padding: '14px max(14px, env(safe-area-inset-right)) 14px max(14px, env(safe-area-inset-left))',
        }}>
          {queue.length === 0 && (
            <li style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Queue is empty.
            </li>
          )}
          {queue.map((q) => (
            <li key={q.id} style={{
              marginBottom: 10, padding: '10px 12px',
              background: 'var(--bg-alt)', borderRadius: 'var(--r-input)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {q.submission.speciesId ?? 'Unknown species'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  attempt {q.attempts}
                </span>
              </div>
              <div className="mono" style={{
                fontSize: 12, fontWeight: 500, color: 'var(--body)',
                marginTop: 3, whiteSpace: 'nowrap',
              }}>
                {q.submission.location.lat.toFixed(5)}, {q.submission.location.lng.toFixed(5)}
              </div>
              {q.lastError && (
                <div style={{ fontSize: 11, color: 'var(--red-text)', marginTop: 4, lineHeight: 1.4 }}>
                  {q.lastError.slice(0, 120)}
                </div>
              )}
              {q.ownerProfileId !== activeProfileId && (
                <div style={{ fontSize: 11, color: 'var(--amber-text)', marginTop: 5, lineHeight: 1.4 }}>
                  Saved under another private profile. Restore that profile to send it.
                </div>
              )}
              {q.retryable === false && q.ownerProfileId === activeProfileId && (
                <div style={{ fontSize: 11, color: 'var(--red-text)', marginTop: 5, lineHeight: 1.4 }}>
                  This report needs correction and will not retry automatically.
                </div>
              )}
              <button type="button" onClick={() => onDiscard(q.id)} style={{
                marginTop: 8, border: 'none', background: 'transparent', padding: 0,
                color: 'var(--red-text)', fontSize: 11.5, cursor: 'pointer',
              }}>
                Discard local report
              </button>
            </li>
          ))}
        </ul>

        {queue.some((item) => item.ownerProfileId === activeProfileId && item.retryable !== false) && (
          <footer style={{
            padding: '14px max(14px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left))',
            borderTop: '1px solid var(--border)',
          }}>
            <button type="button" onClick={onRetry} disabled={flushing} style={{
              width: '100%', height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
              border: 'none', background: 'var(--green)', color: '#fff',
              fontWeight: 600, fontSize: 14, cursor: flushing ? 'not-allowed' : 'pointer',
            }}>
              {flushing ? 'Syncing…' : 'Retry all now'}
            </button>
          </footer>
        )}
      </aside>
    </>,
    document.body,
  )
}
