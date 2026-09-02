import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import guidance from './plant-guidance.json'
import schema from './plant-guidance.schema.json'

// Validate the bundled dataset during the build so missing required fields
// fail before the client needs its fallback path.
describe('plant-guidance.json schema conformance', () => {
  it('validates against plant-guidance.schema.json', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/)
    ajv.addFormat('uri', {
      validate(value: string) {
        try {
          new URL(value)
          return true
        } catch {
          return false
        }
      },
    })
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
