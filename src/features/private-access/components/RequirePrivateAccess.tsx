import { Navigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

/** Protects the main application until this browser has a usable private
 *  profile. Incomplete recovery setup is sent back to the recovery screen. */
export function RequirePrivateAccess({ children }: { children: React.ReactNode }) {
  const status = usePrivateAccess((state) => state.status)
  const profile = usePrivateAccess((state) => state.profile)

  if (status === 'initializing' || status === 'syncing') {
    return (
      <main aria-busy="true" aria-live="polite" style={stateLayout}>
        <Logo size={46} />
        <h1 style={stateTitle}>Preparing InvaTrace</h1>
        <p style={stateBody}>Restoring this installation…</p>
      </main>
    )
  }

  if (status === 'recovery') return <Navigate to="/private-access/recovery" replace />

  if (status === 'storage-error' && profile) {
    return <Navigate to="/private-access/restore" replace />
  }

  if (!profile) {
    return <Navigate to="/private-access" replace />
  }

  return <>{children}</>
}

const stateLayout: React.CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 24,
  textAlign: 'center',
  background: 'var(--bg)',
}

const stateTitle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: '-0.02em',
}

const stateBody: React.CSSProperties = {
  maxWidth: '48ch',
  color: 'var(--body)',
  fontSize: 14,
}
