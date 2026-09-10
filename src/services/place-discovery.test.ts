import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { api } from '@/services/api-client'
import type { PlantAssociationsResponse, PlaceRecord } from './place-discovery'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('place-discovery endpoints (AC 5.1.4 - 5.1.7)', () => {
  it('surfaces place metadata including geometry status and version', async () => {
    const place = await api<PlaceRecord>('/api/v1/places/abcdef')
    expect(place.placeType).toBe('park')
    expect(place.geometryStatus).toBe('authoritative')
    expect(place.geometryVersion).toBe('seed-2026-09')
  })

  it('marks an unsupported place so the UI can render coverage-not-available', async () => {
    const place = await api<PlaceRecord>('/api/v1/places/unsupported-place')
    // AC 5.1.7 - the empty-state must be distinguishable from
    // "no invasive plants recorded"; the geometry status is the signal.
    expect(place.geometryStatus).toBe('unsupported')
  })

  it('returns ranked associations that keep inside evidence ahead of nearby', async () => {
    const body = await api<PlantAssociationsResponse>('/api/v1/places/abcdef/plant-associations')
    expect(body.associations.length).toBeGreaterThan(0)
    // AC 5.1.6 - inside > nearby > upstream. The mock ranks Mikania (inside)
    // above Eichhornia (nearby + upstream) even though Eichhornia has more
    // evidence components, because inside dominates.
    expect(body.associations[0]!.insideArea).toBe(true)
    expect(body.associations[0]!.speciesId).toBe('mikania-micrantha')
  })

  it('carries a disclaimer so the UI never renders inference as a live census', async () => {
    const body = await api<PlantAssociationsResponse>('/api/v1/places/abcdef/plant-associations')
    // AC 5.1.6 - the disclaimer must survive to the payload verbatim.
    expect(body.disclaimer).toContain('not a live census')
  })

  it('exposes the catalogue version and the occurrence-data refresh time', async () => {
    const body = await api<PlantAssociationsResponse>('/api/v1/places/abcdef/plant-associations')
    // AC 5.1.5 - both fields must be readable so a UI can honestly attribute
    // "as of ...". The frontend never re-derives these; the server owns them.
    expect(body.catalogueVersion).toMatch(/^v\d{4}-\d{2}-\d{2}$/)
    expect(body.occurrenceDataUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('flags direction-aware evidence when upstream_waterway components appear', async () => {
    const body = await api<PlantAssociationsResponse>('/api/v1/places/abcdef/plant-associations')
    const aquatic = body.associations.find((a) => a.speciesId === 'eichhornia-crassipes')
    expect(aquatic).toBeDefined()
    // AC 5.1.4b - the client sees a direction-aware flag; the server never
    // emits upstream evidence without one, so the UI is safe to trust it.
    expect(aquatic!.directionAwareEvidence).toBe(true)
    expect(aquatic!.evidence.some((c) => c.kind === 'upstream_waterway')).toBe(true)
  })
})
