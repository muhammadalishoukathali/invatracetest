import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import { profileStateFromPath } from '@/features/private-access/profile-navigation'
import './bottom-tabs.css'

/**
 * Mobile primary navigation. Instagram-style five-slot bar: two tabs on the
 * left, a raised Scan FAB in the middle, two tabs on the right. Mounted by
 * AppShell on every shell route so tab switching stays consistent while the
 * map screen underneath keeps its own floating controls (legend, historical,
 * attribution) above the FAB rather than colliding with it.
 */
interface Tab {
  path: string
  label: string
  icon: string
}

const LEFT_TABS: Tab[] = [
  { path: '/map', label: 'Map', icon: 'MapPinned' },
  { path: '/reports', label: 'Records', icon: 'ClipboardList' },
]

const RIGHT_TABS: Tab[] = [
  { path: '/plants', label: 'Plants', icon: 'Sprout' },
  // Epic 6 - adopt-area monitoring is a primary flow; keep it one tap away.
  // Profile lives in the top-right icon on mobile so this slot stays free.
  // Bookmark reads as "saved places" rather than "verified" (which is what
  // ShieldCheck implied) and matches the mental model of adopting an area.
  { path: '/areas', label: 'Areas', icon: 'Bookmark' },
]

function TabLink({ tab, state }: { tab: Tab; state?: unknown }) {
  return (
    <NavLink
      to={tab.path}
      state={state}
      className={({ isActive }) => `bottom-tab${isActive ? ' bottom-tab--active' : ''}`}
      end={tab.path === '/map'}
    >
      {({ isActive }) => (
        <>
          <span className="bottom-tab__icon" aria-hidden>
            <Icon
              name={tab.icon}
              size={22}
              color={isActive ? 'var(--nav-glass-accent)' : 'currentColor'}
              strokeWidth={isActive ? 2.2 : 1.9}
            />
          </span>
          <span className="bottom-tab__label">{tab.label}</span>
        </>
      )}
    </NavLink>
  )
}

export function BottomTabs() {
  const { pathname } = useLocation()
  const profileState = profileStateFromPath(pathname)
  return (
    <div className="bottom-tabs-shell">
      <nav aria-label="Primary" className="bottom-tabs">
        {LEFT_TABS.map((tab) => (
          <TabLink key={tab.path} tab={tab} state={tab.path === '/profile' ? profileState : undefined} />
        ))}
        <NavLink
          to="/scan"
          state={scanStateFromPath(pathname)}
          aria-label="Scan a plant"
          className="bottom-tabs__scan"
        >
          <span className="bottom-tabs__scan-icon" aria-hidden>
            <Icon name="ScanLine" size={23} color="#fff" strokeWidth={2.15} />
          </span>
          <span>Scan</span>
        </NavLink>
        {RIGHT_TABS.map((tab) => (
          <TabLink key={tab.path} tab={tab} state={tab.path === '/profile' ? profileState : undefined} />
        ))}
      </nav>
    </div>
  )
}
