import { NavLink, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { isEnabled, visibleNav, type NavItem } from '@/app/nav'
import type { Role } from '@/types'

const LATER = 'Available in a later iteration'

const cell: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
  minHeight: 48, padding: '6px 2px', textDecoration: 'none', fontSize: 11, fontWeight: 500,
}

function Tab({ item, role }: { item: NavItem; role: Role }) {
  if (!isEnabled(item, role)) {
    return (
      <span role="link" aria-disabled="true" title={LATER} style={{ ...cell, color: 'var(--icon)' }}>
        <Icon name={item.icon} size={21} color="var(--icon)" />
        <span>{item.label}</span>
        <span className="sr-only"> — {LATER}</span>
      </span>
    )
  }
  return (
    <NavLink to={item.path} style={({ isActive }) => ({ ...cell, color: isActive ? 'var(--green)' : 'var(--icon)' })}>
      {({ isActive }) => (
        <>
          <Icon name={item.icon} size={21} color={isActive ? 'var(--green)' : 'var(--icon)'}
                strokeWidth={isActive ? 2.2 : 1.9} />
          <span style={{ fontWeight: isActive ? 600 : 500 }}>{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

export function BottomTabs({ role }: { role: Role }) {
  const navigate = useNavigate()
  const items = visibleNav(role)
  const mid = Math.ceil(items.length / 2)

  return (
    <nav aria-label="Primary" style={{
      display: 'flex', alignItems: 'stretch', background: 'var(--surface)',
      borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)',
      flexShrink: 0, position: 'relative',
    }}>
      {items.slice(0, mid).map((i) => <Tab key={i.id} item={i} role={role} />)}

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => navigate('/scan')}
          aria-label="Scan a plant"
          style={{
            width: 52, height: 52, borderRadius: '50%', border: 'none',
            background: 'var(--green)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-md)',
            transform: 'translateY(-8px)',
          }}
        >
          <Icon name="ScanLine" size={24} color="#fff" />
        </button>
      </div>

      {items.slice(mid).map((i) => <Tab key={i.id} item={i} role={role} />)}
    </nav>
  )
}
