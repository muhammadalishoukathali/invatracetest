import { Navigate } from 'react-router-dom'
import { useIdentity } from '@/lib/identity'
import type { Role } from '@/types'

/** Gate a route to specific roles. Anyone else is bounced to /map so the
 *  URL is never a leaked capability check. Detectors / Volunteers never
 *  see nor reach the /verify screen. */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const profile = useIdentity((state) => state.profile)
  if (!profile) return null
  if (!roles.includes(profile.role)) return <Navigate to="/map" replace />
  return <>{children}</>
}
