/** Top banner shown while the browser is offline (Arch §12). Also surfaces
 *  a "N reports pending" chip that opens the queue drawer. */
import { useCallback, useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useOnline } from '@/lib/useOnline'
import { flushQueue, listQueue, onQueueChange } from '@/lib/report-queue'
import type { QueuedReport } from '@/types'
import { QueueDrawer } from './QueueDrawer'

export function OfflineBanner() {
  const online = useOnline()
  const [queue, setQueue] = useState<QueuedReport[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [flushing, setFlushing] = useState(false)

  const refresh = useCallback(async () => {
    setQueue(await listQueue())
  }, [])

  useEffect(() => {
    void refresh()
    return onQueueChange(() => { void refresh() })
  }, [refresh])

  const doFlush = useCallback(async () => {
    setFlushing(true)
    try {
      await flushQueue()
      await refresh()
    } finally {
      setFlushing(false)
    }
  }, [refresh])

  const hasQueue = queue.length > 0
  if (online && !hasQueue) return null

  return (
    <>
      <div role="status" aria-live="polite" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '8px 16px', flexShrink: 0,
        background: online ? 'var(--green-light)' : '#FEF3E2',
        borderBottom: `1px solid ${online ? 'var(--green-border)' : '#F0D9A8'}`,
        fontSize: 12.5, color: online ? 'var(--green-dark)' : 'var(--amber)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon name={online ? 'CircleCheck' : 'WifiOff'} size={15}
                color={online ? 'var(--green)' : 'var(--amber)'} />
          <span style={{ fontWeight: 500 }}>
            {online
              ? `${queue.length} report${queue.length === 1 ? '' : 's'} pending sync`
              : "You're offline. New reports will be saved and sent when you reconnect."}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {hasQueue && (
            <button type="button" onClick={() => setDrawerOpen(true)} style={pillBtn}>
              View queue
            </button>
          )}
          {online && hasQueue && (
            <button type="button" onClick={doFlush} disabled={flushing} style={{
              ...pillBtn, background: 'var(--green)', color: '#fff', border: 'none',
            }}>
              {flushing ? 'Syncing…' : 'Retry now'}
            </button>
          )}
        </div>
      </div>

      {drawerOpen && (
        <QueueDrawer
          queue={queue}
          onClose={() => setDrawerOpen(false)}
          onRetry={doFlush}
          flushing={flushing}
        />
      )}
    </>
  )
}

const pillBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 'var(--r-chip)',
  border: '1px solid currentColor', background: 'transparent',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', color: 'inherit',
}
