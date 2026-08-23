import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useMap } from '@/lib/map-store'
import type { SightingStatus } from '@/types'

/** Species list mirrors the /api/v1/species response (Iteration 1 tracked set). */
const SPECIES = [
  { id: 'mikania-micrantha', label: 'Mikania' },
  { id: 'chromolaena-odorata', label: 'Siam weed' },
  { id: 'eichhornia-crassipes', label: 'Water hyacinth' },
  { id: 'clidemia-hirta', label: "Koster's curse" },
] as const

const STATUSES: { id: SightingStatus; label: string }[] = [
  { id: 'candidate', label: 'Candidate' },
  { id: 'confirmed', label: 'Confirmed' },
]

export function Filters() {
  const isDesktop = useIsDesktop()
  const [sheetOpen, setSheetOpen] = useState(false)
  const {
    species, statuses, search, setSearch,
    toggleSpecies, toggleStatus, clearFilters,
  } = useMap()
  const active = species.length + statuses.length

  return (
    <div style={{
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
      flexShrink: 0, zIndex: 4,
    }}>
      {/* Search + filters trigger row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <label style={{ position: 'relative', display: 'block', flex: 1 }}>
          <span style={{
            position: 'absolute', left: 10, top: '50%',
            transform: 'translateY(-50%)', display: 'flex',
          }}>
            <Icon name="Search" size={16} color="var(--muted)" />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search species…"
            style={{
              width: '100%', height: 'var(--h-nav)', padding: '0 12px 0 34px',
              borderRadius: 'var(--r-input)', border: '1px solid var(--border)',
              background: 'var(--bg)', fontSize: 14, color: 'var(--ink)',
            }}
          />
        </label>

        {!isDesktop && (
          <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" style={{
            flexShrink: 0, height: 'var(--h-nav)', padding: '0 14px',
            borderRadius: 'var(--r-input)',
            border: `1px solid ${active > 0 ? 'var(--green)' : 'var(--border)'}`,
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
          <span aria-hidden style={{
            width: 1, height: 22, background: 'var(--border)', margin: '0 4px',
          }} />
          {STATUSES.map((s) => (
            <Chip key={s.id} label={s.label} on={statuses.includes(s.id)}
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
          toggleSpecies={toggleSpecies}
          toggleStatus={toggleStatus}
          clearFilters={clearFilters}
          active={active}
        />
      )}
    </div>
  )
}

function FiltersSheet({
  onClose, selectedSpecies, selectedStatuses,
  toggleSpecies, toggleStatus, clearFilters, active,
}: {
  onClose: () => void
  selectedSpecies: readonly string[]
  selectedStatuses: readonly SightingStatus[]
  toggleSpecies: (id: string) => void
  toggleStatus: (s: SightingStatus) => void
  clearFilters: () => void
  active: number
}) {
  /* Portal so the sheet escapes any ancestor stacking context (the map
   *  container creates one via absolute-positioned canvas + controls);
   *  otherwise the Legend chip and MapLibre controls can leak on top. */
  return createPortal(
    <>
      <div onClick={onClose} aria-hidden style={{
        position: 'fixed', inset: 0, background: 'rgba(20,32,27,0.35)', zIndex: 9998,
      }} />
      <aside role="dialog" aria-label="Filters" aria-modal="true" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: 'var(--surface)',
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: '0 -6px 20px rgba(20,40,30,0.18)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{
          width: 40, height: 4, borderRadius: 2, background: 'var(--border)',
          margin: '10px auto 4px',
        }} />
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 18px',
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Filters</div>
          <button type="button" onClick={onClose} aria-label="Close filters" style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'var(--hover)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="X" size={14} color="var(--body)" />
          </button>
        </header>

        <div style={{ padding: '0 18px 18px' }}>
          <Group title="Species">
            {SPECIES.map((s) => (
              <Chip key={s.id} label={s.label} on={selectedSpecies.includes(s.id)}
                    onClick={() => toggleSpecies(s.id)} />
            ))}
          </Group>
          <Group title="Status">
            {STATUSES.map((s) => (
              <Chip key={s.id} label={s.label} on={selectedStatuses.includes(s.id)}
                    onClick={() => toggleStatus(s.id)} />
            ))}
          </Group>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button type="button" onClick={clearFilters} disabled={active === 0} style={{
              flex: 1, height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--body)', fontWeight: 600, fontSize: 14,
              cursor: active === 0 ? 'not-allowed' : 'pointer',
            }}>
              Clear all
            </button>
            <button type="button" onClick={onClose} style={{
              flex: 1, height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
              border: 'none', background: 'var(--green)', color: '#fff',
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}>
              Apply
            </button>
          </div>
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

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      flexShrink: 0, height: 'var(--h-chip)', padding: '0 14px',
      borderRadius: 'var(--r-chip)',
      border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
      background: on ? 'var(--green-light)' : 'var(--surface)',
      color: on ? 'var(--green-dark)' : 'var(--body)',
      fontSize: 13, fontWeight: on ? 600 : 500, cursor: 'pointer',
      whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
    }}>
      {label}
    </button>
  )
}
