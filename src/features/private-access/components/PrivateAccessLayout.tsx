import type { ReactNode } from 'react'
import { LogoWordmark } from '@/components/Logo'

/** Shared page frame for private-access screens. The compact version keeps
 *  short loading and restore screens from becoming unnecessarily wide. */
export function PrivateAccessLayout({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <div className={`private-access-shell${compact ? ' private-access-shell--compact' : ''}`}>
      <header className="private-access-brand">
        <LogoWordmark size={16} />
        <span>Private field access</span>
      </header>
      <main id="main-content" className="private-access-main">{children}</main>
      <footer className="private-access-footer">
        InvaTrace connects reports to a pseudonymous profile. Your recovery codes remain yours to protect.
      </footer>
    </div>
  )
}
