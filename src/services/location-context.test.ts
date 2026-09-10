import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { fetchLocationContext } from './location-context'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('location-context endpoint (AC 3.3.1 - 3.3.2)', () => {
  it('fails closed when accuracy is worse than the ceiling', async () => {
    const body = await fetchLocationContext({
      latitude: 3.1497,
      longitude: 101.6412,
      accuracyM: 400,
    })
    // AC 3.3.1c - never resolve high-accuracy input as "outside".
    expect(body.contextState).toBe('boundary_uncertain')
    expect(body.actionEligible).toBe(false)
    expect(body.accuracyCeilingM).toBe(250)
    expect(body.boundarySource).toBeNull()
  })

  it('reports inside_protected_area with source + version when a polygon hits', async () => {
    const body = await fetchLocationContext({
      latitude: 3.1497,
      longitude: 101.6412,
      accuracyM: 15,
    })
    expect(body.contextState).toBe('inside_protected_area')
    expect(body.actionEligible).toBe(false)
    // AC 3.3.3 - the UI must be able to attribute the boundary that caused
    // the veto without hardcoding either value.
    expect(body.boundarySource).toBe('Federal Dept of Forestry Peninsular Malaysia')
    expect(body.boundaryVersion).toBe('dev-seed-2026-09-11')
    expect(body.boundaryName).toBe('Bukit Kiara Federal Park')
  })

  it('reports no_intersection outside the known dataset, still not eligible', async () => {
    const body = await fetchLocationContext({
      latitude: 3.05,
      longitude: 101.4,
      accuracyM: 15,
    })
    expect(body.contextState).toBe('no_intersection')
    // AC 3.3.1b - action still requires the client-side permission gate.
    expect(body.actionEligible).toBe(false)
  })
})
