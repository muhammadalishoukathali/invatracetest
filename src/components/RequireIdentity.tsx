import { Navigate } from 'react-router-dom'
import { Logo } from './Logo'
import { useIdentity } from '@/lib/identity'

export function RequireIdentity({ children }: { children: React.ReactNode }) {
  const status = useIdentity((state) => state.status)
  const profile = useIdentity((state) => state.profile)
  const syncMessage = useIdentity((state) => state.syncMessage)
  const initialize = useIdentity((state) => state.initialize)

  if (!profile && (status === 'initializing' || status === 'syncing')) {
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
    void syncMessage
    void initialize
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
