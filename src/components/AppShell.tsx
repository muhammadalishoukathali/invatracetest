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
import { profileReturnPath, profileStateFromPath } from '@/features/private-access/profile-navigation'
import './app-shell.css'

const TITLES: Record<string, [string, string]> = {
  '/map': ['Live threat map', 'Bukit Kiara · updated 2 hours ago'],
  '/profile': ['My profile', 'Identity, recovery and device access'],
  '/reports': ['My records', 'Your submitted field reports'],
}

export function AppShell() {
  const isDesktop = useIsDesktop()
  const profile = usePrivateAccess((state) => state.profile)
  const location = useLocation()
  const { pathname } = location
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { headingRef.current?.focus() }, [pathname])

  if (!profile) return null
  const [title, subtitle] = pathname.startsWith('/reports/')
    ? ['Report details', 'Status and screening result']
    : TITLES[pathname] ?? [NAV.find((n) => n.path === pathname)?.full ?? 'InvaTrace', '']
  const pageFillsAvailableSpace = pathname === '/map'
  const showBottomTabs = !isDesktop && pathname === '/map'
  const showProfileBack = !isDesktop && pathname === '/profile'
  const showProfileShortcut = !isDesktop && pathname !== '/profile' && pathname !== '/reports'
  const profileReturnTo = profileReturnPath(location.state)

  return (
    <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column',
                  height: '100dvh', background: 'var(--bg)',
                  paddingTop: isDesktop ? 0 : 'env(safe-area-inset-top)' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {isDesktop && <Sidebar profile={profile} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ReportQueueStatusBanner />
        <header className="app-header">
          <div className="app-header__leading">
            {showProfileBack && (
              <button
                type="button"
                className="app-header__back"
                aria-label={profileReturnTo === '/reports' ? 'Back to my records' : 'Back to threat map'}
                onClick={() => navigate(profileReturnTo, { replace: true })}
              >
                <Icon name="ChevronLeft" size={20} color="var(--body)" />
              </button>
            )}
            <div className="app-header__heading">
              <h1 ref={headingRef} tabIndex={-1} className="app-header__title">{title}</h1>
              {subtitle && <p className="app-header__subtitle">{subtitle}</p>}
            </div>
          </div>
          <div className="app-header__actions">
            {showProfileShortcut && (
              <button
                type="button"
                aria-label="Manage private access"
                title="Private access"
                onClick={() => navigate('/profile', { state: profileStateFromPath(pathname) })}
                className="app-header__action"
              >
                <Icon name="User" size={18} color="var(--body)" />
              </button>
            )}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} style={{
          flex: 1, minHeight: 0,
          overflow: pageFillsAvailableSpace ? 'hidden' : 'auto',
          padding: pageFillsAvailableSpace ? 0 : (isDesktop ? 26 : 16),
          paddingBottom: pageFillsAvailableSpace
            ? 0
            : isDesktop
              ? 26
              : showBottomTabs ? 'var(--mobile-nav-clearance)' : 24,
        }}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {showBottomTabs && <BottomTabs />}
    </div>
  )
}
