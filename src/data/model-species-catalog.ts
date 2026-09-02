// Species catalog for the bundled on-device PULIH model (see vendor/PULIH_Model1_v4_FP16_Web_Kit).
// The JSON here is the checksum-verified model kit's own class list, so it's the only
// place that's actually guaranteed to match what the ONNX model can output — everything
// else (guidance copy, map labels, report species pickers) should resolve through this
// file rather than hardcoding species names, or a model swap will silently desync them.
// Consumed by src/features/scan/plant-model-adapter.ts to turn a raw class index from
// inference into a species result, and by src/data/plant-guidance.ts to attach the
// authoritative Malaysia status to each guidance entry.
import catalogJson from '../../vendor/PULIH_Model1_v4_FP16_Web_Kit/model/species_31.json'

// Shape of species_31.json — one entry per class the model was trained to output.
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

// machine_label in the JSON uses underscores, but species IDs elsewhere in the app
// (routes, plant_id in the guidance dataset) use hyphens, so we index on the hyphenated
// form and normalize any incoming query the same way in findModelSpecies below.
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
