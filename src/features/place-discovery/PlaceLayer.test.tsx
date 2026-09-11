/** Wave 2c — PlaceLayer spec-builder tests. MapLibre cannot boot in
 *  the vitest Node env (no canvas), so we test the pure spec generator
 *  instead: it captures the filter, source and paint contract that the
 *  layer wiring depends on. */
import { describe, expect, it } from 'vitest'

import {
  buildPlaceLayerSpecs,
  placesToFeatureCollection,
  PLACES_PARK_FILL_LAYER_ID,
  PLACES_PARK_OUTLINE_LAYER_ID,
  PLACES_SOURCE_ID,
  PLACES_TRAIL_LAYER_ID,
} from './PlaceLayer'
import type { PlaceListItem } from '@/services/place-discovery'

describe('buildPlaceLayerSpecs', () => {
  const specs = buildPlaceLayerSpecs()

  it('produces the three expected layer ids in stacking order', () => {
    expect(specs.map((spec) => spec.id)).toEqual([
      PLACES_PARK_FILL_LAYER_ID,
      PLACES_PARK_OUTLINE_LAYER_ID,
      PLACES_TRAIL_LAYER_ID,
    ])
  })

  it('binds every layer to the shared places source', () => {
    for (const spec of specs) {
      expect((spec as { source?: string }).source).toBe(PLACES_SOURCE_ID)
    }
  })

  it('filters park + forest onto the fill/outline layers and trail onto its own', () => {
    const fill = specs.find((spec) => spec.id === PLACES_PARK_FILL_LAYER_ID)!
    expect(JSON.stringify((fill as { filter?: unknown }).filter)).toContain('park')
    expect(JSON.stringify((fill as { filter?: unknown }).filter)).toContain('forest')
    const trail = specs.find((spec) => spec.id === PLACES_TRAIL_LAYER_ID)!
    expect(JSON.stringify((trail as { filter?: unknown }).filter)).toContain('trail')
  })
})

describe('placesToFeatureCollection', () => {
  it('carries place_id, place_type and display_name onto each feature', () => {
    const items: PlaceListItem[] = [
      {
        placeId: 'p1',
        displayName: 'Test Park',
        placeType: 'park',
        sourceFeatureId: 'osm-1',
        geometryStatus: 'authoritative',
        source: 'openstreetmap',
        sourceVersion: '2026-09-01',
        geometrySimplified: {
          type: 'Polygon',
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        },
      },
    ]
    const collection = placesToFeatureCollection(items)
    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].properties).toEqual({
      place_id: 'p1',
      place_type: 'park',
      display_name: 'Test Park',
    })
  })
})
