import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '@/lib/session'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status)
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />
  }

  return <>{children}</>
}
