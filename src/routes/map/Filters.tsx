import { Icon } from '@/components/Icon'
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
  const { species, statuses, search, setSearch, toggleSpecies, toggleStatus, clearFilters } = useMap()
  const active = species.length + statuses.length + (search ? 1 : 0)

  return (
    <div style={{
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
      flexShrink: 0, zIndex: 4,
    }}>
      <label style={{ position: 'relative', display: 'block' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
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

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SPECIES.map((s) => (
          <Chip key={s.id} label={s.label} on={species.includes(s.id)} onClick={() => toggleSpecies(s.id)} />
        ))}
        <span style={{ width: 1, background: 'var(--border)' }} aria-hidden />
        {STATUSES.map((s) => (
          <Chip key={s.id} label={s.label} on={statuses.includes(s.id)} onClick={() => toggleStatus(s.id)} />
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
    </div>
  )
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      height: 'var(--h-chip)', padding: '0 12px', borderRadius: 'var(--r-chip)',
      border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
      background: on ? 'var(--green-light)' : 'var(--surface)',
      color: on ? 'var(--green-dark)' : 'var(--body)',
      fontSize: 12.5, fontWeight: on ? 600 : 500, cursor: 'pointer',
    }}>
      {label}
    </button>
  )
}
