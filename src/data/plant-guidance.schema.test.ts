import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import guidance from './plant-guidance.json'
import schema from './plant-guidance.schema.json'

// AC 3.1.4 — the bundled dataset must validate against the published guidance
// JSON schema at build-time so drift (missing plant_id, content_version or
// last_reviewed) fails CI before it reaches the client fallback path.
describe('plant-guidance.json schema conformance', () => {
  it('validates against plant-guidance.schema.json', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    const validate = ajv.compile(schema)
    const ok = validate(guidance)
    if (!ok) {
      const message = (validate.errors ?? [])
        .slice(0, 10)
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('\n')
      throw new Error(`plant-guidance.json failed schema validation:\n${message}`)
    }
    expect(ok).toBe(true)
  })

  it('every plant has plant_id, content_version-critical fields', () => {
    const g = guidance as { plants: Array<Record<string, unknown>> }
    for (const p of g.plants) {
      expect(p).toHaveProperty('plant_id')
      expect(p).toHaveProperty('scientific_name')
      expect(p).toHaveProperty('guidance_mode')
    }
  })
})
