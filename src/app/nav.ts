import type { Role } from '@/types'

export interface NavItem {
  id: string
  path: string
  label: string        // Short label used in the mobile tab bar.
  full: string         // Full label used in the desktop sidebar.
  icon: string         // Name of the matching Lucide icon.
  /** Version that will enable this destination. Version 1 is available now.
   *  Later versions stay visible but cannot be opened yet. */
  iteration: 1 | 2 | 3
  /** Roles that may open this destination. No list means every profile role. */
  roles?: Role[]
}

/** This order is shared by the mobile tabs and desktop sidebar. Future
 *  destinations keep their position so navigation does not move between releases. */
export const NAV: NavItem[] = [
  { id: 'map',      path: '/map',      label: 'Map',      full: 'Threat map',   icon: 'MapPinned',    iteration: 1 },
  { id: 'reports',  path: '/reports',  label: 'Records',  full: 'My records',   icon: 'ClipboardList', iteration: 1 },
  // Add future destinations here only when their routes are ready.
]

export const isEnabled = (item: NavItem, role: Role): boolean =>
  item.iteration === 1 && (!item.roles || item.roles.includes(role))

export const visibleNav = (role: Role): NavItem[] =>
  // Hide destinations that are not ready instead of showing dead controls.
  NAV.filter((i) => isEnabled(i, role))
