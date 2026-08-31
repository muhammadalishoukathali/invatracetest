import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomTabs } from './BottomTabs'
import { ReportQueueStatusBanner } from '@/features/report/ReportQueueStatusBanner'
import { ErrorBoundary } from './ErrorBoundary'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { NAV } from '@/app/nav'
import { Icon } from './Icon'
import './app-shell.css'

const TITLES: Record<string, [string, string]> = {
  '/map': ['Live threat map', 'Bukit Kiara · updated 2 hours ago'],
  '/access': ['Private access', 'Recovery codes and authorized installations'],
}

export function AppShell() {
  const isDesktop = useIsDesktop()
  const profile = usePrivateAccess((state) => state.profile)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { headingRef.current?.focus() }, [pathname])

  if (!profile) return null
  const [title, subtitle] = TITLES[pathname] ?? [
    NAV.find((n) => n.path === pathname)?.full ?? 'InvaTrace', '',
  ]
  const pageFillsAvailableSpace = pathname === '/map'

  return (
    <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column',
                  height: '100dvh', background: 'var(--bg)',
                  paddingTop: isDesktop ? 0 : 'env(safe-area-inset-top)' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {isDesktop && <Sidebar profile={profile} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ReportQueueStatusBanner />
        <header className="app-header">
          <div className="app-header__heading">
            <h1 ref={headingRef} tabIndex={-1} className="app-header__title">{title}</h1>
            {subtitle && <p className="app-header__subtitle">{subtitle}</p>}
          </div>
          <div className="app-header__actions">
            {!isDesktop && (
              <button
                type="button"
                aria-label="Manage private access"
                title="Private access"
                onClick={() => navigate('/access')}
                className={`app-header__action${pathname === '/access' ? ' app-header__action--active' : ''}`}
              >
                <Icon name="User" size={18} color={pathname === '/access' ? 'var(--green)' : 'var(--body)'} />
              </button>
            )}
            {/* NotificationsPanel removed — coordinator-tier feature not in this iteration. */}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} style={{
          flex: 1, minHeight: 0,
          // The map handles its own scrolling and dimensions. Other pages use
          // this main element as their padded scrolling container.
          overflow: pageFillsAvailableSpace ? 'hidden' : 'auto',
          padding: pageFillsAvailableSpace ? 0 : (isDesktop ? 26 : 16),
          /* Scrollable mobile pages need room for the floating navigation island. */
          paddingBottom: pageFillsAvailableSpace ? 0 : (isDesktop ? 26 : 'var(--mobile-nav-clearance)'),
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
