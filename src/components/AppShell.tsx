import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomTabs } from './BottomTabs'
import { NotificationsPanel } from './NotificationsPanel'
import { OfflineBanner } from './OfflineBanner'
import { ErrorBoundary } from './ErrorBoundary'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useIdentity } from '@/lib/identity'
import { NAV } from '@/app/nav'
import { Icon } from './Icon'

const TITLES: Record<string, [string, string]> = {
  '/map': ['Live threat map', 'Bukit Kiara · updated 2 hours ago'],
  '/verify': ['Verify queue', 'Confirm what reaches the shared map'],
  '/access': ['Private access', 'Recovery codes and authorized installations'],
}

export function AppShell() {
  const isDesktop = useIsDesktop()
  const profile = useIdentity((state) => state.profile)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { headingRef.current?.focus() }, [pathname])

  if (!profile) return null
  const [title, subtitle] = TITLES[pathname] ?? [
    NAV.find((n) => n.path === pathname)?.full ?? 'InvaTrace', '',
  ]
  const bleed = pathname === '/map'  // map fills its own container

  return (
    <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column',
                  height: '100dvh', background: 'var(--bg)',
                  paddingTop: isDesktop ? 0 : 'env(safe-area-inset-top)' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {isDesktop && <Sidebar profile={profile} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <OfflineBanner />
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
          padding: isDesktop ? '18px 26px' : '12px 16px', background: 'var(--surface)',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div>
            <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: isDesktop ? 20 : 17, fontWeight: 700 }}>{title}</h1>
            {subtitle && <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isDesktop && (
              <button
                type="button"
                aria-label="Manage private access"
                title="Private access"
                onClick={() => navigate('/access')}
                style={{
                  width: 44, height: 44, borderRadius: 'var(--r-input)',
                  border: pathname === '/access' ? '1px solid var(--green-border)' : '1px solid var(--border)',
                  background: pathname === '/access' ? 'var(--green-light)' : 'var(--surface)',
                  cursor: 'pointer', display: 'grid', placeItems: 'center',
                }}
              >
                <Icon name="User" size={18} color={pathname === '/access' ? 'var(--green)' : 'var(--body)'} />
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

      {!isDesktop && <BottomTabs role={profile.role} />}
    </div>
  )
}
