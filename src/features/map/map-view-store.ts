/**
 * Stores the active map filters and selected sighting. This state is not kept
 * in the URL because changing a filter should not add browser-history entries.
 *
 * Pulled out of ThreatMapPage.tsx (rather than useState there) so MapFilters.tsx
 * and SightingDetailsSheet.tsx can read and write it directly without prop
 * drilling through the page component — both need it, and neither is a child
 * of the other.
 */
import { create } from 'zustand'
import type { SightingStatus, Risk } from '@/types'

interface MapState {
  species: string[]                // An empty list includes every species.
  statuses: SightingStatus[]       // An empty list includes every status.
  risks: Risk[]                    // An empty list includes every risk level.
  search: string
  selectedId: string | null

  toggleSpecies: (id: string) => void
  toggleStatus: (s: SightingStatus) => void
  toggleRisk: (r: Risk) => void
  clearFilters: () => void
  setSearch: (q: string) => void
  select: (id: string | null) => void
}

export const useMapView = create<MapState>((set, get) => ({
  species: [],
  statuses: [],
  risks: [],
  search: '',
  selectedId: null,

  toggleSpecies: (id) => {
    const cur = get().species
    set({ species: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  },

  toggleStatus: (s) => {
    const cur = get().statuses
    set({ statuses: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] })
  },

  toggleRisk: (r) => {
    const cur = get().risks
    set({ risks: cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r] })
  },

  clearFilters: () => set({ species: [], statuses: [], risks: [], search: '' }),

  setSearch: (q) => set({ search: q }),

  select: (id) => set({ selectedId: id }),
}))
