import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useMapView } from '@/features/map/map-view-store'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { modelSpeciesCatalog } from '@/data/model-species-catalog'
import type { SightingStatus, Risk } from '@/types'
import './map-controls.css'

/** Every invasive class emitted by the bundled model. */
export const MAP_FILTER_SPECIES = modelSpeciesCatalog.classes
  .filter((species) => species.malaysia_status === 'invasive')
  .map((species) => ({
    id: species.machine_label.replaceAll('_', '-'),
    label: species.display_name,
  }))

const STATUSES: { id: SightingStatus; label: string; dot?: string }[] = [
  { id: 'screened', label: 'Rule screened' },
  { id: 'removed', label: 'Removed', dot: '#8B978F' },
]

const RISKS: { id: Risk; label: string; dot: string }[] = [
  { id: 'high', label: 'High risk', dot: '#C2412D' },
  { id: 'watch', label: 'Watch', dot: '#D9880F' },
]

export function MapFilters() {
  const isDesktop = useIsDesktop()
  const [sheetOpen, setSheetOpen] = useState(false)
  const {
    species, statuses, risks, search, setSearch,
    toggleSpecies, toggleStatus, toggleRisk, clearFilters,
  } = useMapView()
  const active = species.length + statuses.length + risks.length

  return (
    <div className="map-toolbar">
      {/* The search box is always visible. On mobile, the filter button opens
          the choices in a bottom sheet because the chips do not fit in one row. */}
      <div className="map-toolbar__row">
        <label className="field-shell map-search" style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
          height: 'var(--h-nav)', paddingLeft: 11,
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
            aria-expanded={sheetOpen} aria-controls="map-filters-sheet"
            className={`map-filter-trigger${active > 0 ? ' map-filter-trigger--active' : ''}`}>
            <Icon name="SlidersHorizontal" size={16}
                  color={active > 0 ? 'var(--green)' : 'var(--body)'} />
            Filters{active > 0 ? ` · ${active}` : ''}
          </button>
        )}
      </div>

      {/* Desktop has enough width to show every filter as an inline chip. */}
      {isDesktop && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {MAP_FILTER_SPECIES.map((s) => (
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

      {/* On mobile, render the same filter choices in a keyboard-accessible dialog. */}
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

  /* Render the sheet under document.body so the map canvas and controls cannot
   * appear above it. The map container creates its own stacking layer. */
  return createPortal(
    <>
      <div onClick={onClose} aria-hidden className="app-sheet-backdrop" />
      <aside ref={dialogRef} id="map-filters-sheet" tabIndex={-1}
        role="dialog" aria-label="Filters" aria-modal="true"
        className="app-sheet map-filter-sheet">
        <div className="app-sheet__handle" aria-hidden />
        <header className="app-sheet__header">
          <div className="app-sheet__heading">
            <h2 tabIndex={-1} data-dialog-initial className="app-sheet__title">Filter sightings</h2>
            <p className="app-sheet__subtitle">
              {active === 0 ? 'All map records are visible' : `${active} filter${active === 1 ? '' : 's'} active`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close filters" className="app-sheet__close">
            <Icon name="X" size={18} color="var(--body)" />
          </button>
        </header>

        <div className="app-sheet__body map-filter-sheet__body">
          <FilterGroup title="Risk level" description="Prioritize the most urgent sightings.">
            <div className="filter-option-grid">
            {RISKS.map((r) => (
                <FilterOption key={r.id} label={r.label} on={selectedRisks.includes(r.id)} dot={r.dot}
                              onClick={() => toggleRisk(r.id)} />
            ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Species" description="Choose one or more tracked plants.">
            <div className="filter-option-grid">
            {MAP_FILTER_SPECIES.map((s) => (
                <FilterOption key={s.id} label={s.label} on={selectedSpecies.includes(s.id)}
                              onClick={() => toggleSpecies(s.id)} />
            ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Status" description="Show rule-screened or already removed plants.">
            <div className="filter-option-grid filter-option-grid--status">
            {STATUSES.map((s) => (
                <FilterOption key={s.id} label={s.label} on={selectedStatuses.includes(s.id)} dot={s.dot}
                              onClick={() => toggleStatus(s.id)} />
            ))}
            </div>
          </FilterGroup>
        </div>

        <div className="app-sheet__footer map-filter-sheet__footer">
          <button type="button" onClick={clearFilters} disabled={active === 0}
            className="map-filter-sheet__reset">
            Reset
          </button>
          <button type="button" onClick={onClose} className="map-filter-sheet__apply">
            Show results
          </button>
        </div>
      </aside>
    </>,
    document.body,
  )
}

function FilterGroup({ title, description, children }: {
  title: string; description: string; children: React.ReactNode
}) {
  return (
    <section className="filter-group">
      <div className="filter-group__heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </section>
  )
}

function FilterOption({ label, on, onClick, dot }: {
  label: string; on: boolean; onClick: () => void; dot?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`filter-option${on ? ' filter-option--selected' : ''}`}>
      <span className="filter-option__label">
        {dot && <span aria-hidden className="filter-option__dot" style={{ background: dot }} />}
        <span>{label}</span>
      </span>
      <span aria-hidden className="filter-option__check">
        {on && <Icon name="Check" size={13} color="#fff" strokeWidth={2.4} />}
      </span>
    </button>
  )
}

function Chip({ label, on, onClick, dot }: {
  label: string; on: boolean; onClick: () => void; dot?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`map-filter-chip${on ? ' map-filter-chip--selected' : ''}`}>
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
