import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import runtimeCatalog from '../../public/models/pulih-model1-v4/species_31.json'
import {
  findModelSpecies, modelReferenceImageUrl, modelSpeciesCatalog,
} from './model-species-catalog'

describe('shared model species catalogue', () => {
  it('exactly matches the catalogue shipped to the browser model', () => {
    expect(modelSpeciesCatalog).toEqual(runtimeCatalog)
    expect(modelSpeciesCatalog.class_count).toBe(modelSpeciesCatalog.classes.length)
  })

  it('contains unique class indexes and machine labels', () => {
    expect(new Set(modelSpeciesCatalog.classes.map((item) => item.class_index)).size).toBe(31)
    expect(new Set(modelSpeciesCatalog.classes.map((item) => item.machine_label)).size).toBe(31)
  })

  it('resolves every model class and has a bundled general reference image', () => {
    for (const modelClass of modelSpeciesCatalog.classes) {
      const speciesId = modelClass.machine_label.replaceAll('_', '-')
      expect(findModelSpecies({ speciesId })).toBe(modelClass)
      expect(findModelSpecies({ scientificName: modelClass.scientific_name })).toBe(modelClass)
      const imageUrl = modelReferenceImageUrl(modelClass)
      const imagePath = fileURLToPath(new URL(`../../public${imageUrl}`, import.meta.url))
      expect(existsSync(imagePath), `${modelClass.machine_label} reference image`).toBe(true)
    }
  })
})
