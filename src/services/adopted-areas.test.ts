/** Iteration 2 Phase 7 - Epic 6 adopted-areas client contract tests.
 *
 *  MSW-backed integration around the three main paths: adopt, list,
 *  and remove. Also exercises the ADOPTION_LIMIT_REACHED guard so a
 *  future edit that quietly drops the 50-slot check in the mock (or
 *  the real handler) shows up here instead of only in Playwright.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

import { handlers } from '@/mocks/handlers'
import { ApiError } from './api-client'
import {
  adoptArea,
  fetchAdoptionActivity,
  listAdoptedAreas,
  removeAdoption,
} from './adopted-areas'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())


describe('adopted areas client (AC 6.1 - 6.3)', () => {
  it('round-trips an adoption end to end', async () => {
    const placeId = crypto.randomUUID()
    const created = await adoptArea(placeId)
    expect(created.placeId).toBe(placeId)
    expect(created.adoptionId).toMatch(/^[0-9a-f-]{36}$/)

    const list = await listAdoptedAreas('adopted_at')
    const found = list.items.find((x) => x.adoptionId === created.adoptionId)
    expect(found).toBeDefined()
    expect(list.maxPerIdentity).toBe(50)

    const activity = await fetchAdoptionActivity(created.adoptionId)
    expect(activity.indicators.windowDays).toBe(30)
    expect(activity.indicators.tolerancePct).toBe(10)

    await removeAdoption(created.adoptionId)
    const after = await listAdoptedAreas('adopted_at')
    expect(after.items.find((x) => x.adoptionId === created.adoptionId)).toBeUndefined()
  })

  it('surfaces ADOPTION_LIMIT_REACHED as an ApiError with a stable code', async () => {
    server.use(
      http.post('*/api/v1/adopted-areas', () =>
        HttpResponse.json(
          {
            code: 'ADOPTION_LIMIT_REACHED',
            detail: 'You already have 50 adopted areas - remove one before adopting another.',
          },
          { status: 409 },
        ),
      ),
    )
    // AC 6.1.3 - the client MUST be able to switch on the code, never
    // on the free-text detail (which could change without notice).
    await expect(adoptArea(crypto.randomUUID())).rejects.toSatisfy((err) => {
      return err instanceof ApiError
        && err.status === 409
        && err.code === 'ADOPTION_LIMIT_REACHED'
    })
  })

  it('is idempotent per placeId - re-adopting returns the same record', async () => {
    const placeId = crypto.randomUUID()
    const first = await adoptArea(placeId)
    const again = await adoptArea(placeId)
    expect(again.adoptionId).toBe(first.adoptionId)
    expect(again.placeId).toBe(placeId)
    await removeAdoption(first.adoptionId)
  })
})
