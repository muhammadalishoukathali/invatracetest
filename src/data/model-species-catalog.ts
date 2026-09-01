import catalogJson from '../../vendor/PULIH_Model1_v4_FP16_Web_Kit/model/species_31.json'

export interface ModelSpeciesClass {
  class_index: number
  machine_label: string
  scientific_name: string
  display_name: string
  recognition_category: string
  malaysia_status: string
  status_source: string
}

export interface ModelSpeciesCatalog {
  schema_version: string
  model_version: string
  class_count: number
  classes: ModelSpeciesClass[]
}

/** Single source of truth for every label the bundled PULIH model can emit. */
export const modelSpeciesCatalog = catalogJson as ModelSpeciesCatalog

const bySpeciesId = new Map(
  modelSpeciesCatalog.classes.map((item) => [item.machine_label.replaceAll('_', '-'), item]),
)
const byScientificName = new Map(
  modelSpeciesCatalog.classes.map((item) => [item.scientific_name.toLowerCase(), item]),
)

export function findModelSpecies(query: {
  speciesId?: string | null
  scientificName?: string | null
}): ModelSpeciesClass | null {
  if (query.speciesId) {
    const hit = bySpeciesId.get(query.speciesId.trim().toLowerCase().replaceAll('_', '-'))
    if (hit) return hit
  }
  if (query.scientificName) {
    const hit = byScientificName.get(query.scientificName.trim().toLowerCase())
    if (hit) return hit
  }
  return null
}

export function modelReferenceImageUrl(modelSpecies: ModelSpeciesClass): string {
  return `/reference-images/${modelSpecies.machine_label}.jpg`
}
