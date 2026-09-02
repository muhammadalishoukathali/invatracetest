/** Shows the connection state and the number of reports waiting to upload.
 *  Selecting the pending count opens the queue details drawer. */
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useOnline } from '@/hooks/useOnline'
import {
  discardQueuedReport,
  flushQueue,
  listQueuedReports,
  onReportQueueChange,
} from '@/features/report/report-queue'
import type { QueuedReport } from '@/types'
import { ReportQueueDrawer } from './components/ReportQueueDrawer'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

export function ReportQueueStatusBanner() {
  const online = useOnline()
  const identityStatus = usePrivateAccess((state) => state.status)
  const syncMessage = usePrivateAccess((state) => state.syncMessage)
  const syncIdentity = usePrivateAccess((state) => state.sync)
  const activeProfileId = usePrivateAccess((state) => state.profile?.id ?? null)
  const [queue, setQueue] = useState<QueuedReport[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [flushing, setFlushing] = useState(false)

  const refresh = useCallback(async () => {
    setQueue(await listQueuedReports(activeProfileId))
  }, [activeProfileId])

  useEffect(() => {
    void refresh()
    return onReportQueueChange(() => { void refresh() })
  }, [refresh])

  const doFlush = useCallback(async () => {
    setFlushing(true)
    try {
      const sessionReady = identityStatus === 'ready' || await syncIdentity()
      if (!sessionReady) return
      await flushQueue()
      await refresh()
    } finally {
      setFlushing(false)
    }
  }, [identityStatus, refresh, syncIdentity])

  const hasQueue = queue.length > 0
  const sessionNeedsAttention = identityStatus === 'syncing' || identityStatus === 'error'
  if (online && !hasQueue && !sessionNeedsAttention) return null

  const isSyncing = identityStatus === 'syncing' || flushing
  const bannerOnline = online && identityStatus !== 'error'
  const iconName = !online
    ? 'WifiOff'
    : identityStatus === 'error'
      ? 'AlertTriangle'
      : identityStatus === 'syncing'
        ? 'Clock'
        : 'CircleCheck'
  const message = !online
    ? "You're offline. New reports will be saved and sent when you reconnect."
    : identityStatus === 'syncing'
      ? 'Restoring synchronization…'
      : identityStatus === 'error'
        ? (syncMessage ?? 'Sync is unavailable. Offline-capable features remain available.')
        : `${queue.length} report${queue.length === 1 ? '' : 's'} pending sync`

  return (
    <>
      <div role="status" aria-live="polite" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '8px 16px', flexShrink: 0, flexWrap: 'wrap',
        background: bannerOnline ? 'var(--green-light)' : 'var(--amber-light)',
        borderBottom: `1px solid ${bannerOnline ? 'var(--green-border)' : 'var(--amber-border)'}`,
        fontSize: 12.5, color: bannerOnline ? 'var(--green-dark)' : 'var(--amber-text)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon name={iconName} size={15}
                color={bannerOnline ? 'var(--green)' : 'var(--amber-text)'} />
          <span style={{ fontWeight: 500 }}>{message}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {hasQueue && (
            <button type="button" onClick={() => setDrawerOpen(true)} style={pillBtn}>
              View queue
            </button>
          )}
          {online && hasQueue && identityStatus === 'ready' && (
            <button type="button" onClick={doFlush} disabled={flushing} style={{
              ...pillBtn, background: 'var(--green)', color: '#fff', border: 'none',
            }}>
              {flushing ? 'Syncing…' : 'Retry reports'}
            </button>
          )}
          {online && identityStatus === 'error' && (
            <button type="button" onClick={() => void syncIdentity()} disabled={isSyncing} style={{
              ...pillBtn, background: 'var(--green)', color: '#fff', border: 'none',
            }}>
              Retry sync
            </button>
          )}
        </div>
      </div>

      {drawerOpen && (
        <ReportQueueDrawer
          queue={queue}
          onClose={() => setDrawerOpen(false)}
          onRetry={doFlush}
          onDiscard={(id) => { void discardQueuedReport(id) }}
          flushing={flushing}
          activeProfileId={activeProfileId}
        />
      )}
    </>
  )
}

const pillBtn: React.CSSProperties = {
  minHeight: 'var(--h-chip)', padding: '4px 12px', borderRadius: 'var(--r-chip)',
  border: '1px solid currentColor', background: 'transparent',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', color: 'inherit',
}
