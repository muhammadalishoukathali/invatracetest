import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import type { QueuedReport } from '@/types'

interface Props {
  queue: QueuedReport[]
  onClose: () => void
  onRetry: () => void
  flushing: boolean
}

/** Right-side drawer listing IndexedDB-queued reports awaiting sync. */
export function QueueDrawer({ queue, onClose, onRetry, flushing }: Props) {
  return createPortal(
    <>
      <div onClick={onClose} aria-hidden style={{
        position: 'fixed', inset: 0, background: 'rgba(20,32,27,0.32)', zIndex: 9998,
      }} />
      <aside role="dialog" aria-label="Queued reports" aria-modal="true" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9999,
        width: 'min(420px, 100vw)', background: 'var(--surface)',
        boxShadow: '-4px 0 16px rgba(20,40,30,0.14)',
        display: 'flex', flexDirection: 'column',
      }}>
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Pending sync</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {queue.length} report{queue.length === 1 ? '' : 's'} waiting
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'var(--hover)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="X" size={14} color="var(--body)" />
          </button>
        </header>

        <ul style={{ flex: 1, overflowY: 'auto', listStyle: 'none', padding: 14 }}>
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
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--body)', marginTop: 3 }}>
                {q.submission.location.lat.toFixed(5)}, {q.submission.location.lng.toFixed(5)}
              </div>
              {q.lastError && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, lineHeight: 1.4 }}>
                  {q.lastError.slice(0, 120)}
                </div>
              )}
            </li>
          ))}
        </ul>

        {queue.length > 0 && (
          <footer style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
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
