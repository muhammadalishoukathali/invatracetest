import { NavLink, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { isEnabled, visibleNav, type NavItem } from '@/app/nav'
import type { User } from '@/types'

const LATER = 'Available in a later iteration'

function itemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 11, height: 'var(--h-nav)',
    padding: '0 12px', borderRadius: 'var(--r-input)', textDecoration: 'none',
    background: active ? 'var(--green-light)' : 'transparent',
    color: active ? 'var(--green-dark)' : 'var(--body)',
    fontWeight: active ? 600 : 500, fontSize: 14,
  }
}

function Row({ item, role }: { item: NavItem; role: User['role'] }) {
  const enabled = isEnabled(item, role)
  if (!enabled) {
    return (
      <span role="link" aria-disabled="true" title={LATER} style={itemStyle(false)}>
        <Icon name={item.icon} color="var(--icon)" />
        <span>{item.full}</span>
        <span className="sr-only"> — {LATER}</span>
      </span>
    )
  }
  return (
    <NavLink to={item.path} style={({ isActive }) => itemStyle(isActive)}>
      {({ isActive }) => (
        <>
          <Icon name={item.icon} color={isActive ? 'var(--green)' : 'var(--icon)'}
                strokeWidth={isActive ? 2.2 : 1.9} />
          <span>{item.full}</span>
        </>
      )}
    </NavLink>
  )
}

export function Sidebar({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const navigate = useNavigate()
  return (
    <aside style={{
      width: 'var(--sidebar-w)', flex: '0 0 var(--sidebar-w)', background: 'var(--surface)',
      borderRight: '1px solid var(--border)', padding: '22px 16px',
      display: 'flex', flexDirection: 'column', gap: 22,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 2 }}>
        <Logo size={34} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.032em', lineHeight: 1, color: 'var(--green)' }}>
            inva<span style={{ fontWeight: 400, color: 'var(--ink)' }}>trace</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Bukit Kiara crew
          </div>
        </div>
      </div>

      <button type="button" onClick={() => navigate('/scan')} style={{
        height: 'var(--h-primary)', borderRadius: 'var(--r-button)', border: 'none',
        background: 'var(--green)', color: '#fff', fontWeight: 600, fontSize: 14,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <Icon name="ScanLine" size={18} color="#fff" />
        New scan
      </button>

      <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleNav(user.role).map((i) => <Row key={i.id} item={i} role={user.role} />)}
      </nav>

      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: 'var(--green-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon name="User" size={16} color="var(--green)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user.name ?? 'Guest reporter'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{user.role}</div>
          </div>
          <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" style={{
            width: 32, height: 32, borderRadius: 'var(--r-button)',
            border: '1px solid var(--border)', background: 'var(--surface)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="LogOut" size={15} color="var(--muted)" />
          </button>
        </div>
      </div>
    </aside>
  )
}
