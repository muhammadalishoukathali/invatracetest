/** Bell + dropdown panel in the app header. Unread count as a red dot.
 *  Click an item → mark read + navigate if `linkTo` is set. */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { useNotifications, useMarkNotificationRead } from '@/lib/notifications'
import type { AppNotification, NotificationKind } from '@/types'

const KIND_ICON: Record<NotificationKind, string> = {
  report_confirmed: 'CircleCheck',
  report_rejected: 'AlertTriangle',
  queue_new: 'ShieldCheck',
  sync_ok: 'WifiOff',
  system: 'Bell',
}
const KIND_TINT: Record<NotificationKind, string> = {
  report_confirmed: 'var(--green)',
  report_rejected: 'var(--red)',
  queue_new: 'var(--green)',
  sync_ok: 'var(--body)',
  system: 'var(--muted)',
}

export function NotificationsPanel() {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { data } = useNotifications()
  const { markOne, markAll } = useMarkNotificationRead()

  const unread = data?.unread ?? 0
  const items = data?.items ?? []

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const openItem = (n: AppNotification) => {
    if (!n.read) void markOne(n.id)
    if (n.linkTo) navigate(n.linkTo)
    setOpen(false)
  }

  return (
    <div ref={wrapper} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 38, height: 38, borderRadius: 'var(--r-input)',
          border: '1px solid var(--border)', background: 'var(--surface)',
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', position: 'relative',
        }}
      >
        <Icon name="Bell" size={18} color="var(--body)" />
        {unread > 0 && (
          <span aria-hidden style={{
            position: 'absolute', top: 6, right: 6,
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--red)', border: '1.5px solid var(--surface)',
          }} />
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" style={{
          position: 'absolute', top: 46, right: 0, width: 340,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-md)',
          zIndex: 20, overflow: 'hidden', maxHeight: 480, display: 'flex', flexDirection: 'column',
        }}>
          <header style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => void markAll()} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12, color: 'var(--green-dark)', fontWeight: 500,
              }}>
                Mark all read
              </button>
            )}
          </header>

          <ul style={{ overflowY: 'auto', listStyle: 'none' }}>
            {items.length === 0 && (
              <li style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                No notifications yet.
              </li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px',
                  background: n.read ? 'var(--surface)' : 'var(--green-light)',
                  border: 'none', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <Icon name={KIND_ICON[n.kind]} size={16} color={KIND_TINT[n.kind]} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{n.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--body)', marginTop: 2, lineHeight: 1.4 }}>
                      {n.body}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      {formatAgo(n.createdAt)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function formatAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}
