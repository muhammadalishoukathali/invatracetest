/**
 * Holds the active map filters and whatever sighting is currently selected.
 * I deliberately kept this out of the URL - every filter tap would otherwise
 * push a new browser-history entry, which means Back would just undo filters
 * one at a time instead of leaving the map.
 *
 * I also pulled this out of ThreatMapPage.tsx rather than just using
 * useState there, because MapFilters.tsx and SightingDetailsSheet.tsx both
 * need to read and write the same state and neither is a child of the
 * other, so prop drilling through the page component would've been messy.
 */
import { create } from 'zustand'
import type { SightingStatus, Risk } from '@/types'

interface MapState {
  species: string[]                // empty = every species shown
  statuses: SightingStatus[]       // empty = every status shown
  risks: Risk[]                    // empty = every risk level shown
  search: string
  selectedId: string | null

  toggleSpecies: (id: string | string[]) => void
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
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return
    const cur = get().species
    // A group is "on" when the first id in the group is already selected.
    // We treat toggling as an all-or-nothing operation for the group so a
    // single "Test Plant" chip flips every underlying species_id together.
    const isOn = cur.includes(ids[0])
    if (isOn) {
      const drop = new Set(ids)
      set({ species: cur.filter((x) => !drop.has(x)) })
    } else {
      const merged = new Set(cur)
      for (const value of ids) merged.add(value)
      set({ species: Array.from(merged) })
    }
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
