import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import './bottom-tabs.css'

/**
 * Mobile bottom bar with a single big Scan action. Only rendered by AppShell
 * on the map screen at narrow widths — the map stays visible behind it, so
 * the bar doesn't need a full tab set, just the one primary action.
 */
export function BottomTabs() {
  return (
    <div className="bottom-tabs-shell">
      <nav aria-label="Primary" className="bottom-tabs bottom-tabs--scan-only">
        <NavLink
          to="/scan"
          state={scanStateFromPath('/map')}
          aria-label="Scan a plant"
          className="bottom-tabs__scan"
        >
          <span className="bottom-tabs__scan-icon" aria-hidden>
            <Icon name="ScanLine" size={23} color="#fff" strokeWidth={2.15} />
          </span>
          <span>Scan</span>
        </NavLink>
      </nav>
    </div>
  )
}
