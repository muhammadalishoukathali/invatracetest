import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers, resolveSightingSpecies } from './handlers'
import { modelSpeciesCatalog } from '@/data/model-species-catalog'
import { plantGuidanceDataset } from '@/data/plant-guidance'
import { developmentIdentifyResultForHash } from '@/features/scan/plant-model-adapter'
import { MAP_FILTER_SPECIES } from '@/features/map/MapFilters'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const server = setupServer(...handlers)
const installationToken = (character: string) => character.repeat(43)

async function start(token = installationToken('A')) {
  const response = await fetch('http://localhost/api/v1/profiles/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationToken: token, role: 'Admin', trustLevel: 'Steward' }),
  })
  return { response, payload: await response.json() as {
    accessToken: string
    profile: { id: string; role: string; trustLevel: string }
    recoveryCodes: string[]
  } }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  server.listen({ onUnhandledRequest: 'error' })
})
afterAll(() => server.close())
beforeEach(() => localStorage.clear())

describe('reported sighting species labels', () => {
  it('exposes exactly the 31 model classes with the catalogue status split', async () => {
    const response = await fetch('http://localhost/api/v1/species')
    const body = await response.json() as {
      items: Array<{ id: string; isInvasive: boolean; malaysiaStatus: string }>
    }
    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(31)
    expect(body.items.filter((item) => item.isInvasive)).toHaveLength(16)
    expect(body.items.filter((item) => !item.isInvasive)).toHaveLength(15)
    expect(new Set(body.items.map((item) => item.id))).toEqual(new Set(
      modelSpeciesCatalog.classes.map((item) => item.machine_label.replaceAll('_', '-')),
    ))
  })

  it('makes the fake development model emit every catalogue class with its real status', () => {
    const results = modelSpeciesCatalog.classes.map((_, index) => developmentIdentifyResultForHash(index))
    expect(results.map((result) => result.speciesId)).toEqual(
      modelSpeciesCatalog.classes.map((item) => item.machine_label.replaceAll('_', '-')),
    )
    expect(results.filter((result) => result.outcome === 'target')).toHaveLength(16)
    expect(results.filter((result) => result.outcome === 'other_plant')).toHaveLength(15)
    expect(developmentIdentifyResultForHash(31).outcome).toBe('uncertain')
  })

  it('derives map filters and guidance status from the model catalogue', () => {
    const invasive = modelSpeciesCatalog.classes.filter((item) => item.malaysia_status === 'invasive')
    expect(MAP_FILTER_SPECIES).toHaveLength(16)
    expect(MAP_FILTER_SPECIES.map((item) => item.id)).toEqual(
      invasive.map((item) => item.machine_label.replaceAll('_', '-')),
    )
    for (const plant of plantGuidanceDataset.plants) {
      const modelClass = modelSpeciesCatalog.classes.find((item) => item.machine_label === plant.plant_id)
      expect(modelClass).toBeDefined()
      expect(plant.malaysia_status.category === 'invasive').toBe(
        modelClass?.malaysia_status === 'invasive',
      )
    }
  })

  it('keeps the model identification for Mimosa diplotricha on the map', () => {
    expect(resolveSightingSpecies('mimosa-diplotricha')).toEqual({
      speciesName: 'Mimosa diplotricha',
      latinName: 'Mimosa diplotricha',
      risk: 'high',
    })
  })

  it('uses the unavailable fallback only for IDs outside the reviewed catalogue', () => {
    expect(resolveSightingSpecies('not-a-reviewed-species')).toMatchObject({
      speciesName: 'Reported plant',
      latinName: 'Identification unavailable',
    })
  })

  it('has exact display coverage for every class the model can emit', () => {
    expect(modelSpeciesCatalog.class_count).toBe(31)
    expect(modelSpeciesCatalog.classes).toHaveLength(31)
    for (const modelClass of modelSpeciesCatalog.classes) {
      const speciesId = modelClass.machine_label.replaceAll('_', '-')
      expect(resolveSightingSpecies(speciesId)).toMatchObject({
        speciesName: modelClass.display_name,
        latinName: modelClass.scientific_name,
      })
    }
  })

  it('returns a general reference image for every model species detail', async () => {
    for (const modelClass of modelSpeciesCatalog.classes) {
      const speciesId = modelClass.machine_label.replaceAll('_', '-')
      const response = await fetch(`http://localhost/api/v1/species/${speciesId}`)
      const detail = await response.json() as {
        latinName: string
        isInvasive: boolean
        reportEligible: boolean
        referenceImageUrl: string | null
      }
      expect(response.status).toBe(200)
      expect(detail.latinName).toBe(modelClass.scientific_name)
      expect(detail.isInvasive).toBe(modelClass.malaysia_status === 'invasive')
      expect(detail.reportEligible).toBe(modelClass.malaysia_status === 'invasive')
      expect(detail.referenceImageUrl).toMatch(/^\/reference-images\/.+\.jpg$/)
    }
  })
})

describe('private access mock contract', () => {
  it('creates explicit Detector/New access, returns ten 128-bit codes, and persists only hashes', async () => {
    const { response, payload } = await start()

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payload.profile).toMatchObject({ role: 'Detector', trustLevel: 'New' })
    expect(payload.profile.id).toMatch(/^IVT-/)
    expect(payload.recoveryCodes).toHaveLength(10)
    for (const code of payload.recoveryCodes) expect(code.replace(/-/g, '')).toHaveLength(26)

    const persisted = localStorage.getItem('invatrace-mock-server-v2') ?? ''
    expect(persisted).not.toContain(installationToken('A'))
    for (const code of payload.recoveryCodes) expect(persisted).not.toContain(code)
    expect(persisted).not.toContain(payload.accessToken)
  })

  it('bootstrap restores known installations, never creates unknown ones, and tracks setup acknowledgement', async () => {
    const { payload } = await start()
    const unknown = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('B') }),
    })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: 'installation_not_found' })

    const bootstrap = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('A') }),
    })
    expect(await bootstrap.json()).toMatchObject({
      profile: { id: payload.profile.id },
      recoverySetupRequired: true,
    })

    await fetch('http://localhost/api/v1/profiles/me/recovery-setup/acknowledge', {
      method: 'POST', headers: { Authorization: `Bearer ${payload.accessToken}` },
    })
    const acknowledged = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('A') }),
    })
    expect(await acknowledged.json()).toMatchObject({ recoverySetupRequired: false })
  })

  it('restores a second installation transactionally and returns indistinguishable failures', async () => {
    const { payload } = await start()
    const restore = (token: string, profileId = payload.profile.id, code = payload.recoveryCodes[0]) =>
      fetch('http://localhost/api/v1/profiles/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, recoveryCode: code, installationToken: token }),
      })

    const concurrent = await Promise.all([
      restore(installationToken('B')),
      restore(installationToken('C')),
    ])
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 400])

    const invalidId = await restore(installationToken('D'), 'IVT-MISSING', payload.recoveryCodes[1])
    const usedCode = await restore(installationToken('E'))
    expect(invalidId.status).toBe(usedCode.status)
    expect(await invalidId.text()).toBe(await usedCode.text())

    const successful = concurrent.find((response) => response.status === 200)!
    const restored = await successful.json() as { accessToken: string }
    const overview = await fetch('http://localhost/api/v1/profiles/me/access', {
      headers: { Authorization: `Bearer ${restored.accessToken}` },
    })
    const access = await overview.json() as { installations: unknown[]; unusedRecoveryCodeCount: number }
    expect(access.installations).toHaveLength(2)
    expect(access.unusedRecoveryCodeCount).toBe(9)
  })

  it('rotation invalidates older unused codes and revocation blocks only the selected installation', async () => {
    const { payload } = await start()
    const restoredResponse = await fetch('http://localhost/api/v1/profiles/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: payload.profile.id,
        recoveryCode: payload.recoveryCodes[0],
        installationToken: installationToken('B'),
      }),
    })
    const restored = await restoredResponse.json() as { accessToken: string }
    const rotatedResponse = await fetch('http://localhost/api/v1/profiles/me/recovery-codes/rotate', {
      method: 'POST', headers: { Authorization: `Bearer ${restored.accessToken}` },
    })
    const rotated = await rotatedResponse.json() as { recoveryCodes: string[] }
    expect(rotated.recoveryCodes).toHaveLength(10)

    const oldCode = await fetch('http://localhost/api/v1/profiles/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: payload.profile.id,
        recoveryCode: payload.recoveryCodes[1],
        installationToken: installationToken('C'),
      }),
    })
    expect(oldCode.status).toBe(400)

    const overview = await fetch('http://localhost/api/v1/profiles/me/access', {
      headers: { Authorization: `Bearer ${restored.accessToken}` },
    }).then((response) => response.json()) as {
      installations: Array<{ id: string; current: boolean }>
    }
    const earlier = overview.installations.find((item) => !item.current)!
    expect((await fetch(`http://localhost/api/v1/profiles/me/installations/${earlier.id}/revoke`, {
      method: 'POST', headers: { Authorization: `Bearer ${restored.accessToken}` },
    })).status).toBe(204)

    const revoked = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('A') }),
    })
    const current = await fetch('http://localhost/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: installationToken('B') }),
    })
    expect(revoked.status).toBe(401)
    expect(current.status).toBe(200)
  })
})
