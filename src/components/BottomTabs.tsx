import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import type { Role } from '@/types'
import './bottom-tabs.css'

// Iteration 1: map is always the underlying view, so only Scan appears here.
// Other destinations (trail, sessions, impact, verify) return in later iterations.
export function BottomTabs({ role: _role }: { role: Role }) {
  return (
    <div className="bottom-tabs-shell">
      <nav aria-label="Primary" className="bottom-tabs bottom-tabs--scan-only">
        <NavLink
          to="/scan"
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
