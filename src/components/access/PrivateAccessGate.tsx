import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AccessLayout } from './AccessLayout'
import { Logo } from '@/components/Logo'
import { useIdentity } from '@/lib/identity'

export function PrivateAccessGate() {
  const status = useIdentity((state) => state.status)
  const profile = useIdentity((state) => state.profile)
  const { pathname } = useLocation()

  if (status === 'initializing' || status === 'syncing') {
    return (
      <AccessLayout compact>
        <section className="access-state" aria-busy="true" aria-live="polite">
          <Logo size={52} />
          <h1>Checking this installation</h1>
          <p>Looking for existing private access…</p>
        </section>
      </AccessLayout>
    )
  }
  if (status === 'recovery' && pathname !== '/private-access/recovery') {
    return <Navigate to="/private-access/recovery" replace />
  }
  if (profile && ['ready', 'offline', 'error'].includes(status)) return <Navigate to="/map" replace />
  return <Outlet />
}
