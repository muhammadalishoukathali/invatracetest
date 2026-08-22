import type { Role } from '@/types'

export interface NavItem {
  id: string
  path: string
  label: string        // short label, mobile tab bar
  full: string         // full label, desktop rail
  icon: string         // lucide icon name
  /** Iteration that delivers this destination. Anything above 1 renders as a
   *  visible but inert tab — Arch §14 scope, prototype IA preserved. */
  iteration: 1 | 2 | 3
  /** Roles permitted to reach it. Undefined means every signed-in role. */
  roles?: Role[]
}

/** Order matches the approved prototype's information architecture. Later
 *  iteration destinations keep their position so the roadmap reads correctly. */
export const NAV: NavItem[] = [
  { id: 'map',      path: '/map',      label: 'Map',      full: 'Threat map',   icon: 'MapPinned',    iteration: 1 },
  { id: 'trail',    path: '/trail',    label: 'Trail',    full: 'My Trail',     icon: 'Route',        iteration: 2 },
  { id: 'verify',   path: '/verify',   label: 'Verify',   full: 'Verify queue', icon: 'ShieldCheck',  iteration: 1, roles: ['Coordinator', 'Expert', 'Admin'] },
  { id: 'sessions', path: '/sessions', label: 'Sessions', full: 'Sessions',     icon: 'CalendarDays', iteration: 2 },
  { id: 'impact',   path: '/impact',   label: 'Impact',   full: 'Impact',       icon: 'TrendingUp',   iteration: 3 },
]

export const isEnabled = (item: NavItem, role: Role): boolean =>
  item.iteration === 1 && (!item.roles || item.roles.includes(role))

export const visibleNav = (role: Role): NavItem[] =>
  // A destination the role may never reach is hidden outright. A destination
  // that simply has not shipped yet stays visible but inert.
  NAV.filter((i) => i.iteration > 1 || !i.roles || i.roles.includes(role))
