/** Mobile bottom navigation. FAB sits in a notch cut out of the bar; each
 *  tab is a full column tap target with an active pill indicator. Safe-area
 *  padding keeps the FAB clear of the home indicator on modern iPhones. */
import { NavLink, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { isEnabled, visibleNav, type NavItem } from '@/app/nav'
import type { Role } from '@/types'

const LATER = 'Available in a later iteration'

/* Height of the visible bar plus the FAB overhang. Kept in a const so the
   home-indicator safe-area padding can add on top of it consistently. */
const BAR_HEIGHT = 62
const FAB_SIZE = 54
const FAB_LIFT = 20         // how far the FAB sits above the bar's top edge
const NOTCH_WIDTH = 78      // notch column must clearly exceed FAB_SIZE

function Tab({ item, role }: { item: NavItem; role: Role }) {
  const cell: React.CSSProperties = {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 3,
    minHeight: BAR_HEIGHT, padding: '6px 4px',
    textDecoration: 'none', fontSize: 10.5, fontWeight: 500,
    WebkitTapHighlightColor: 'transparent',
  }

  if (!isEnabled(item, role)) {
    return (
      <span role="link" aria-disabled="true" title={LATER}
            style={{ ...cell, color: 'var(--icon)' }}>
        <Icon name={item.icon} size={22} color="var(--icon)" />
        <span>{item.label}</span>
        <span className="sr-only"> — {LATER}</span>
      </span>
    )
  }

  return (
    <NavLink to={item.path} style={({ isActive }) => ({
      ...cell, color: isActive ? 'var(--green-dark)' : 'var(--icon)', position: 'relative',
    })}>
      {({ isActive }) => (
        <>
          {isActive && (
            <span aria-hidden style={{
              position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
              width: 28, height: 3, borderRadius: 2, background: 'var(--green)',
            }} />
          )}
          <Icon name={item.icon} size={22}
                color={isActive ? 'var(--green)' : 'var(--icon)'}
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
  const left = items.slice(0, mid)
  const right = items.slice(mid)

  return (
    <nav aria-label="Primary" style={{
      position: 'relative', flexShrink: 0,
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: 'var(--surface)',
      borderTop: '1px solid var(--border)',
      boxShadow: '0 -1px 3px rgba(20,40,30,0.04)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'stretch',
        height: BAR_HEIGHT, position: 'relative',
      }}>
        {left.map((i) => <Tab key={i.id} item={i} role={role} />)}

        {/* Central spacer that carves out room for the FAB. */}
        <div aria-hidden style={{
          width: NOTCH_WIDTH, flexShrink: 0, position: 'relative',
        }}>
          {/* Notch: soft white cutout so the FAB sits in an inset. */}
          <div style={{
            position: 'absolute', top: -FAB_LIFT, left: 0, right: 0,
            height: FAB_LIFT + 6, background: 'var(--surface)',
            borderTopLeftRadius: 34, borderTopRightRadius: 34,
          }} />
        </div>

        {right.map((i) => <Tab key={i.id} item={i} role={role} />)}
      </div>

      {/* FAB — absolute so it can sit inside the notch, above the bar's top. */}
      <button
        type="button"
        onClick={() => navigate('/scan')}
        aria-label="Scan a plant"
        style={{
          position: 'absolute', left: '50%', top: -FAB_LIFT,
          transform: 'translateX(-50%)',
          width: FAB_SIZE, height: FAB_SIZE, borderRadius: '50%',
          border: 'none', background: 'var(--green)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 14px rgba(20,40,30,0.28)',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <Icon name="ScanLine" size={24} color="#fff" />
      </button>
    </nav>
  )
}
