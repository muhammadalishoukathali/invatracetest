import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { isEnabled, visibleNav, type NavItem } from '@/app/nav'
import type { Role } from '@/types'
import './bottom-tabs.css'

const LATER = 'Available in a later iteration'
const LEFT_SLOTS = ['map', 'trail'] as const

function Tab({ item, role }: { item: NavItem; role: Role }) {
  const content = (
    <>
      <span className="bottom-tab__icon" aria-hidden>
        <Icon name={item.icon} size={21} strokeWidth={2} />
      </span>
      <span className="bottom-tab__label">{item.label}</span>
    </>
  )

  if (!isEnabled(item, role)) {
    return (
      <span
        role="link"
        aria-disabled="true"
        title={LATER}
        className="bottom-tab bottom-tab--disabled"
      >
        {content}
        <span className="sr-only"> — {LATER}</span>
      </span>
    )
  }

  return (
    <NavLink
      to={item.path}
      className={({ isActive }) => `bottom-tab${isActive ? ' bottom-tab--active' : ''}`}
    >
      {content}
    </NavLink>
  )
}

export function BottomTabs({ role }: { role: Role }) {
  const items = new Map(visibleNav(role).map((item) => [item.id, item]))
  const rightSlots = items.has('verify')
    ? (['verify', 'sessions'] as const)
    : (['sessions', 'impact'] as const)

  return (
    <div className="bottom-tabs-shell">
      <nav aria-label="Primary" className="bottom-tabs">
        {LEFT_SLOTS.map((id) => {
          const item = items.get(id)
          return item ? <Tab key={id} item={item} role={role} /> : <span key={id} aria-hidden />
        })}

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

        {rightSlots.map((id) => {
          const item = items.get(id)
          return item ? <Tab key={id} item={item} role={role} /> : <span key={id} aria-hidden />
        })}
      </nav>
    </div>
  )
}
