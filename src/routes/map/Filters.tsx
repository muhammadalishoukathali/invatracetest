import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useMap } from '@/lib/map-store'
import { useDialogA11y } from '@/lib/useDialogA11y'
import type { SightingStatus, Risk } from '@/types'

/** Species list mirrors the /api/v1/species response (Iteration 1 tracked set). */
const SPECIES = [
  { id: 'mikania-micrantha', label: 'Mikania' },
  { id: 'chromolaena-odorata', label: 'Siam weed' },
  { id: 'eichhornia-crassipes', label: 'Water hyacinth' },
  { id: 'clidemia-hirta', label: "Koster's curse" },
] as const

const STATUSES: { id: SightingStatus; label: string; dot?: string }[] = [
  { id: 'candidate', label: 'Candidate' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'removed', label: 'Removed', dot: '#8B978F' },
]

const RISKS: { id: Risk; label: string; dot: string }[] = [
  { id: 'high', label: 'High risk', dot: '#C2412D' },
  { id: 'watch', label: 'Watch', dot: '#D9880F' },
]

export function Filters() {
  const isDesktop = useIsDesktop()
  const [sheetOpen, setSheetOpen] = useState(false)
  const {
    species, statuses, risks, search, setSearch,
    toggleSpecies, toggleStatus, toggleRisk, clearFilters,
  } = useMap()
  const active = species.length + statuses.length + risks.length

  return (
    <div style={{
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
      flexShrink: 0, zIndex: 4,
    }}>
      {/* Search + filters trigger row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <label className="field-shell" style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
          height: 'var(--h-nav)', paddingLeft: 11, borderRadius: 'var(--r-input)',
          border: '1px solid var(--border)', background: 'var(--bg)',
        }}>
          <span aria-hidden style={{ display: 'flex', flexShrink: 0 }}>
            <Icon name="Search" size={16} color="var(--muted)" />
          </span>
          <input
            type="search"
            aria-label="Search species"
            className="field-control"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search species…"
            style={{
              flex: 1, height: '100%', padding: 0, paddingRight: search ? 0 : 12,
              border: 'none', outline: 'none',
              background: 'transparent', fontSize: 14, color: 'var(--ink)',
            }}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search" style={{
              width: 42, height: 42, borderRadius: '50%', border: 'none',
              background: 'transparent', cursor: 'pointer', padding: 0, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="X" size={14} color="var(--muted)" />
            </button>
          )}
        </label>

        {!isDesktop && (
          <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog"
            aria-expanded={sheetOpen} aria-controls="map-filters-sheet" style={{
            flexShrink: 0, height: 'var(--h-nav)', padding: '0 14px',
            borderRadius: 'var(--r-input)',
            border: `1px solid ${active > 0 ? 'var(--green)' : 'var(--control-border)'}`,
            background: active > 0 ? 'var(--green-light)' : 'var(--surface)',
            color: active > 0 ? 'var(--green-dark)' : 'var(--body)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="SlidersHorizontal" size={16}
                  color={active > 0 ? 'var(--green)' : 'var(--body)'} />
            Filters{active > 0 ? ` · ${active}` : ''}
          </button>
        )}
      </div>

      {/* Desktop: inline chip row. */}
      {isDesktop && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {SPECIES.map((s) => (
            <Chip key={s.id} label={s.label} on={species.includes(s.id)}
                  onClick={() => toggleSpecies(s.id)} />
          ))}
          <Divider />
          {RISKS.map((r) => (
            <Chip key={r.id} label={r.label} on={risks.includes(r.id)} dot={r.dot}
                  onClick={() => toggleRisk(r.id)} />
          ))}
          <Divider />
          {STATUSES.map((s) => (
            <Chip key={s.id} label={s.label} on={statuses.includes(s.id)} dot={s.dot}
                  onClick={() => toggleStatus(s.id)} />
          ))}
          {active > 0 && (
            <button type="button" onClick={clearFilters} style={{
              marginLeft: 'auto', padding: '0 10px', height: 'var(--h-chip)',
              borderRadius: 'var(--r-chip)', border: 'none',
              background: 'transparent', color: 'var(--muted)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}>
              Clear ({active})
            </button>
          )}
        </div>
      )}

      {/* Mobile sheet */}
      {!isDesktop && sheetOpen && (
        <FiltersSheet
          onClose={() => setSheetOpen(false)}
          selectedSpecies={species}
          selectedStatuses={statuses}
          selectedRisks={risks}
          toggleSpecies={toggleSpecies}
          toggleStatus={toggleStatus}
          toggleRisk={toggleRisk}
          clearFilters={clearFilters}
          active={active}
        />
      )}
    </div>
  )
}

function Divider() {
  return <span aria-hidden style={{
    width: 1, height: 22, background: 'var(--border)', margin: '0 4px',
  }} />
}

function FiltersSheet({
  onClose, selectedSpecies, selectedStatuses, selectedRisks,
  toggleSpecies, toggleStatus, toggleRisk, clearFilters, active,
}: {
  onClose: () => void
  selectedSpecies: readonly string[]
  selectedStatuses: readonly SightingStatus[]
  selectedRisks: readonly Risk[]
  toggleSpecies: (id: string) => void
  toggleStatus: (s: SightingStatus) => void
  toggleRisk: (r: Risk) => void
  clearFilters: () => void
  active: number
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogA11y(dialogRef, onClose)

  /* Portal so the sheet escapes any ancestor stacking context (the map
   *  container creates one via absolute-positioned canvas + controls);
   *  otherwise the Legend chip and MapLibre controls can leak on top. */
  return createPortal(
    <>
      <div onClick={onClose} aria-hidden style={{
        position: 'fixed', inset: 0, background: 'rgba(20,32,27,0.35)', zIndex: 9998,
      }} />
      <aside ref={dialogRef} id="map-filters-sheet" tabIndex={-1}
        role="dialog" aria-label="Filters" aria-modal="true" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: 'var(--surface)',
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: '0 -6px 20px rgba(20,40,30,0.18)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        maxHeight: '82dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          width: 40, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '10px auto 4px', flexShrink: 0,
        }} />
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 18px 6px', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Filters</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {active === 0 ? 'Showing all sightings' : `${active} active`}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close filters" data-dialog-initial style={{
            width: 44, height: 44, borderRadius: '50%', border: 'none',
            background: 'var(--hover)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="X" size={14} color="var(--body)" />
          </button>
        </header>

        <div style={{ padding: '4px 18px 14px', overflowY: 'auto', flex: 1 }}>
          <Group title="Risk level">
            {RISKS.map((r) => (
              <Chip key={r.id} label={r.label} on={selectedRisks.includes(r.id)} dot={r.dot}
                    onClick={() => toggleRisk(r.id)} />
            ))}
          </Group>
          <Group title="Species">
            {SPECIES.map((s) => (
              <Chip key={s.id} label={s.label} on={selectedSpecies.includes(s.id)}
                    onClick={() => toggleSpecies(s.id)} />
            ))}
          </Group>
          <Group title="Status">
            {STATUSES.map((s) => (
              <Chip key={s.id} label={s.label} on={selectedStatuses.includes(s.id)} dot={s.dot}
                    onClick={() => toggleStatus(s.id)} />
            ))}
          </Group>
        </div>

        <div style={{
          display: 'flex', gap: 10, padding: '12px 18px 14px',
          borderTop: '1px solid var(--border)', background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <button type="button" onClick={clearFilters} disabled={active === 0} style={{
            flex: '0 0 auto', padding: '0 18px', height: 'var(--h-primary)',
            borderRadius: 'var(--r-button)',
          border: '1px solid var(--control-border)', background: 'var(--surface)',
            color: 'var(--body)', fontWeight: 600, fontSize: 14,
            cursor: active === 0 ? 'not-allowed' : 'pointer',
          }}>
            Reset
          </button>
          <button type="button" onClick={onClose} style={{
            flex: 1, height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
            border: 'none', background: 'var(--green)', color: '#fff',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>
            Show results
          </button>
        </div>
      </aside>
    </>,
    document.body,
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        fontSize: 11, color: 'var(--muted)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
      }}>{title}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function Chip({ label, on, onClick, dot }: {
  label: string; on: boolean; onClick: () => void; dot?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      flexShrink: 0, height: 'var(--h-chip)', padding: dot ? '0 14px 0 10px' : '0 14px',
      borderRadius: 'var(--r-chip)',
      border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
      background: on ? 'var(--green-light)' : 'var(--surface)',
      color: on ? 'var(--green-dark)' : 'var(--body)',
      fontSize: 13, fontWeight: on ? 600 : 500, cursor: 'pointer',
      whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
      display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      {dot && (
        <span aria-hidden style={{
          width: 8, height: 8, borderRadius: '50%', background: dot,
          boxShadow: '0 0 0 1.5px #fff, 0 0 0 2.5px var(--border)',
        }} />
      )}
      {label}
    </button>
  )
}
