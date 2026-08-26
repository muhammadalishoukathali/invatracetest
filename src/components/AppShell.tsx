import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomTabs } from './BottomTabs'
import { Icon } from './Icon'
import { NotificationsPanel } from './NotificationsPanel'
import { OfflineBanner } from './OfflineBanner'
import { ErrorBoundary } from './ErrorBoundary'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useSession } from '@/lib/session'
import { NAV } from '@/app/nav'

const TITLES: Record<string, [string, string]> = {
  '/map': ['Live threat map', 'Bukit Kiara · updated 2 hours ago'],
  '/verify': ['Verify queue', 'Confirm what reaches the shared map'],
}

export function AppShell() {
  const isDesktop = useIsDesktop()
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  const { pathname } = useLocation()

  if (!user) return null
  const [title, subtitle] = TITLES[pathname] ?? [
    NAV.find((n) => n.path === pathname)?.full ?? 'InvaTrace', '',
  ]
  const bleed = pathname === '/map'  // map fills its own container

  return (
    <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column',
                  height: '100dvh', background: 'var(--bg)',
                  paddingTop: isDesktop ? 0 : 'env(safe-area-inset-top)' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {isDesktop && <Sidebar user={user} onSignOut={signOut} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <OfflineBanner />
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
          padding: isDesktop ? '18px 26px' : '12px 16px', background: 'var(--surface)',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div>
            <h1 style={{ fontSize: isDesktop ? 20 : 17, fontWeight: 700 }}>{title}</h1>
            {subtitle && <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isDesktop && (
              /* Sign-out lives in the header so pilot testers can swap
                 accounts, but a stray tap would kick them out mid-report.
                 Confirm before firing it. */
              <button type="button" aria-label="Sign out" title="Sign out"
                onClick={() => {
                  if (window.confirm('Sign out of InvaTrace?')) signOut()
                }}
                style={{
                  width: 44, height: 44, borderRadius: 'var(--r-input)', border: '1px solid var(--control-border)',
                  background: 'var(--surface)', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <Icon name="LogOut" size={18} color="var(--body)" />
              </button>
            )}
            <NotificationsPanel />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} style={{
          flex: 1, minHeight: 0,
          overflow: bleed ? 'hidden' : 'auto',
          padding: bleed ? 0 : (isDesktop ? 26 : 16),
          /* Mobile scrollable pages need extra bottom room so the last row
             clears the tab-bar + FAB overhang; the tab bar itself sits below
             this main element, so plain padding is enough. */
          paddingBottom: bleed ? 0 : (isDesktop ? 26 : 32),
        }}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {!isDesktop && <BottomTabs role={user.role} />}
    </div>
  )
}
