/** Map filter + selection state. Kept in Zustand rather than URL so filter
 *  toggles don't churn the browser history. */
import { create } from 'zustand'
import type { SightingStatus } from '@/types'

interface MapState {
  species: string[]                // empty = all
  statuses: SightingStatus[]       // empty = all
  search: string
  selectedId: string | null

  toggleSpecies: (id: string) => void
  toggleStatus: (s: SightingStatus) => void
  clearFilters: () => void
  setSearch: (q: string) => void
  select: (id: string | null) => void
}

export const useMap = create<MapState>((set, get) => ({
  species: [],
  statuses: [],
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

  clearFilters: () => set({ species: [], statuses: [], search: '' }),

  setSearch: (q) => set({ search: q }),

  select: (id) => set({ selectedId: id }),
}))
