import { describe, expect, it } from 'vitest'
import speciesCatalog from '../../public/models/pulih-model1-v4/species_31.json'
import { findPlantGuidance, plantGuidanceDataset, getSources } from './plant-guidance'

interface CatalogEntry {
  machine_label: string
  scientific_name: string
  display_name: string
}

const catalog = speciesCatalog as { classes: CatalogEntry[] }

describe('plant-guidance dataset', () => {
  it('loads dataset with expected shape', () => {
    expect(plantGuidanceDataset.jurisdiction).toBe('Malaysia')
    expect(plantGuidanceDataset.plants.length).toBeGreaterThan(0)
    expect(plantGuidanceDataset.safety_policy.permission_rule).toBeTruthy()
  })

  it('resolves lookup by scientific name for every guidance entry', () => {
    for (const plant of plantGuidanceDataset.plants) {
      const hit = findPlantGuidance({ scientificName: plant.scientific_name })
      expect(hit?.plant_id).toBe(plant.plant_id)
    }
  })

  it('resolves dashed speciesId form emitted by the pulih model', () => {
    const dashed = 'mimosa-pudica'
    const hit = findPlantGuidance({ plantId: dashed })
    expect(hit?.plant_id).toBe('mimosa_pudica')
  })

  it('every model class either has guidance or is intentionally missing (documented)', () => {
    const knownUncovered = new Set([
      'miconia_crenata',
      'sphagneticola_trilobata',
      'lantana_camara',
    ])
    const uncovered: string[] = []
    for (const entry of catalog.classes) {
      const hit = findPlantGuidance({
        plantId: entry.machine_label,
        scientificName: entry.scientific_name,
      })
      if (!hit) uncovered.push(entry.machine_label)
    }
    expect(new Set(uncovered)).toEqual(knownUncovered)
  })

  it('returns null for unknown species without throwing', () => {
    expect(findPlantGuidance({ scientificName: 'Foo bar' })).toBeNull()
    expect(findPlantGuidance({})).toBeNull()
  })

  it('every sourced item cites at least one valid source', () => {
    const knownSourceIds = new Set(plantGuidanceDataset.sources.map((s) => s.source_id))
    for (const plant of plantGuidanceDataset.plants) {
      expect(plant.general_information_source_ids.length).toBeGreaterThan(0)
      for (const id of plant.malaysia_status.source_ids) {
        expect(knownSourceIds.has(id)).toBe(true)
      }
      const buckets = [plant.spread_prevention, plant.do_not_do, plant.follow_up]
      for (const bucket of buckets) {
        for (const item of bucket) {
          for (const id of item.source_ids) {
            expect(knownSourceIds.has(id)).toBe(true)
          }
        }
      }
    }
  })

  it('no active step recommends a universally prohibited technique', () => {
    const prohibitedPatterns = [
      /\bburn(?:s|ing|ed)?\b/i,
      /\bherbicide\b/i,
      /\bpower\s*tool/i,
      /\bchainsaw/i,
      /\bpetrol\b/i,
      /\bclimb(?:ing)?\b/i,
      /\benter\s+(?:the\s+)?water/i,
      /\bmature\s+tree/i,
      /\bdense\s+thicket/i,
    ]
    const doNotPrefix = /^\s*(do not|don['’]t|never|avoid)/i
    for (const plant of plantGuidanceDataset.plants) {
      if (!plant.actions) continue
      for (const key of ['protected_or_permission_unknown', 'authorised_site'] as const) {
        for (const step of plant.actions[key].steps) {
          if (doNotPrefix.test(step.text)) continue
          for (const pattern of prohibitedPatterns) {
            expect(pattern.test(step.text), `${plant.plant_id}/${key}: "${step.text}"`).toBe(false)
          }
        }
      }
    }
  })

  it('resolves cited sources by id', () => {
    const plant = plantGuidanceDataset.plants[0]
    const sources = getSources(plant.general_information_source_ids)
    expect(sources.length).toBe(plant.general_information_source_ids.length)
    for (const src of sources) {
      expect(src.url).toMatch(/^https?:\/\//)
    }
  })
})
