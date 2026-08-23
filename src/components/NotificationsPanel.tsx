/** Bell + panel in the app header. Unread count as a red dot.
 *  Click an item → mark read + navigate if `linkTo` is set.
 *  Desktop: anchored dropdown. Mobile: portalled bottom sheet with scrim. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { useIsDesktop } from '@/lib/useIsDesktop'
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
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const { data } = useNotifications()
  const { markOne, markAll } = useMarkNotificationRead()

  const unread = data?.unread ?? 0
  const items = data?.items ?? []

  useEffect(() => {
    /* Desktop dropdown closes on outside-click; the mobile sheet uses its
       own scrim so this handler stays desktop-only. */
    if (!open || !isDesktop) return
    const onDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, isDesktop])

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

      {open && isDesktop && (
        <PanelBody
          items={items} unread={unread}
          onItem={openItem} onMarkAll={() => void markAll()}
          onClose={() => setOpen(false)}
          layout="dropdown"
        />
      )}
      {open && !isDesktop && createPortal(
        <>
          <div onClick={() => setOpen(false)} aria-hidden style={{
            position: 'fixed', inset: 0, background: 'rgba(20,32,27,0.35)', zIndex: 9998,
          }} />
          <PanelBody
            items={items} unread={unread}
            onItem={openItem} onMarkAll={() => void markAll()}
            onClose={() => setOpen(false)}
            layout="sheet"
          />
        </>,
        document.body,
      )}
    </div>
  )
}

function PanelBody({
  items, unread, onItem, onMarkAll, onClose, layout,
}: {
  items: AppNotification[]
  unread: number
  onItem: (n: AppNotification) => void
  onMarkAll: () => void
  onClose: () => void
  layout: 'dropdown' | 'sheet'
}) {
  const isSheet = layout === 'sheet'
  return (
    <div role="dialog" aria-label="Notifications" aria-modal={isSheet ? 'true' : undefined} style={
      isSheet ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: 'var(--surface)',
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: '0 -8px 24px rgba(20,40,30,0.18)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        maxHeight: '82dvh', display: 'flex', flexDirection: 'column',
      } : {
        position: 'absolute', top: 46, right: 0, width: 340,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-md)',
        zIndex: 20, overflow: 'hidden', maxHeight: 480, display: 'flex', flexDirection: 'column',
      }
    }>
      {isSheet && (
        <div style={{
          width: 40, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '10px auto 4px', flexShrink: 0,
        }} />
      )}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: isSheet ? '8px 18px 10px' : '10px 14px',
        borderBottom: isSheet ? 'none' : '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: isSheet ? 16 : 13, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Notifications
          </div>
          {isSheet && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {unread === 0 ? 'All caught up' : `${unread} unread`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {unread > 0 && (
            <button type="button" onClick={onMarkAll} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 12, color: 'var(--green-dark)', fontWeight: 600,
              padding: '6px 8px',
            }}>
              Mark all read
            </button>
          )}
          {isSheet && (
            <button type="button" onClick={onClose} aria-label="Close" style={{
              width: 34, height: 34, borderRadius: '50%', border: 'none',
              background: 'var(--hover)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="X" size={14} color="var(--body)" />
            </button>
          )}
        </div>
      </header>

      <ul style={{ overflowY: 'auto', listStyle: 'none', flex: 1 }}>
        {items.length === 0 && (
          <li style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No notifications yet.
          </li>
        )}
        {items.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onItem(n)} style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: n.read ? 'var(--surface)' : 'var(--green-light)',
              border: 'none', borderBottom: '1px solid var(--border)',
              cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: n.read ? 'var(--bg-alt)' : 'var(--surface)',
                border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name={KIND_ICON[n.kind]} size={15} color={KIND_TINT[n.kind]} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
                  {n.title}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--body)', marginTop: 3, lineHeight: 1.45 }}>
                  {n.body}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                  {formatAgo(n.createdAt)}
                </div>
              </div>
              {!n.read && (
                <span aria-hidden style={{
                  width: 8, height: 8, borderRadius: '50%', background: 'var(--green)',
                  marginTop: 6, flexShrink: 0,
                }} />
              )}
            </button>
          </li>
        ))}
      </ul>
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
