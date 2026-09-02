import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { isEnabled, visibleNav, type NavItem } from '@/app/nav'
import { safeDisplayName } from '@/features/private-access/display-name'
import type { PseudonymousProfile } from '@/types'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import { profileStateFromPath } from '@/features/private-access/profile-navigation'

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

function Row({ item, role }: { item: NavItem; role: PseudonymousProfile['role'] }) {
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

export function Sidebar({ profile }: { profile: PseudonymousProfile }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (
    <aside style={{
      width: 'var(--sidebar-w)', flex: '0 0 var(--sidebar-w)', background: 'var(--surface)',
      borderRight: '1px solid var(--border)', padding: '22px 16px',
      display: 'flex', flexDirection: 'column', gap: 22,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
        <Logo size={36} />
        <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.038em', lineHeight: 1, color: 'var(--ink)' }}>
          InvaTrace
        </span>
      </div>

      <button
        type="button"
        onClick={() => navigate('/scan', { state: scanStateFromPath(pathname) })}
        className="sidebar-scan-button"
      >
        <span className="sidebar-scan-button__icon" aria-hidden>
          <Icon name="ScanLine" size={19} color="#fff" strokeWidth={2.2} />
        </span>
        <span>
          <strong>Scan a plant</strong>
          <small>Camera or library</small>
        </span>
        <Icon name="ChevronRight" size={17} color="rgba(255,255,255,.76)" />
      </button>

      <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleNav(profile.role).map((i) => <Row key={i.id} item={i} role={profile.role} />)}
      </nav>

      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <button
          type="button"
          aria-label={`Open profile for ${safeDisplayName(profile.displayName)}`}
          onClick={() => navigate('/profile', { state: profileStateFromPath(pathname) })}
          style={{
            width: '100%', minHeight: 52, display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 8px', margin: '-6px -8px', border: 0,
            borderRadius: 'var(--r-input)', background: 'transparent', cursor: 'pointer', textAlign: 'left',
          }}>
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
              {safeDisplayName(profile.displayName)}
            </div>
          </div>
          <Icon name="ChevronRight" size={16} color="var(--icon)" />
        </button>
      </div>
    </aside>
  )
}
