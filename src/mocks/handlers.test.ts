import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

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
