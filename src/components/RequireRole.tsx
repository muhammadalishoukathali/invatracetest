import { Navigate } from 'react-router-dom'
import { useSession } from '@/lib/session'
import type { Role } from '@/types'

/** Gate a route to specific roles. Anyone else is bounced to /map so the
 *  URL is never a leaked capability check. Detectors / Volunteers never
 *  see nor reach the /verify screen. */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const user = useSession((s) => s.user)
  if (!user) return null
  if (!roles.includes(user.role)) return <Navigate to="/map" replace />
  return <>{children}</>
}
