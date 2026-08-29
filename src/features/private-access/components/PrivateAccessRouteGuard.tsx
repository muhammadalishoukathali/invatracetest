import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PrivateAccessLayout } from './PrivateAccessLayout'
import { Logo } from '@/components/Logo'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

/** Keeps signed-in users out of setup pages, keeps recovery setup from being
 *  skipped, and shows a loading state while the saved installation is checked. */
export function PrivateAccessRouteGuard() {
  const status = usePrivateAccess((state) => state.status)
  const profile = usePrivateAccess((state) => state.profile)
  const { pathname } = useLocation()

  if (status === 'initializing' || status === 'syncing') {
    return (
      <PrivateAccessLayout compact>
        <section className="access-state" aria-busy="true" aria-live="polite">
          <Logo size={52} />
          <h1>Checking this installation</h1>
          <p>Looking for existing private access…</p>
        </section>
      </PrivateAccessLayout>
    )
  }
  if (status === 'recovery' && pathname !== '/private-access/recovery') {
    return <Navigate to="/private-access/recovery" replace />
  }
  if (profile && ['ready', 'offline', 'error'].includes(status)) return <Navigate to="/map" replace />
  return <Outlet />
}
