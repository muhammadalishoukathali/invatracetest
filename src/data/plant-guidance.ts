import guidanceJson from './plant-guidance.json'
import { findModelSpecies } from './model-species-catalog'

export type GuidanceMode =
  | 'general_information'
  | 'active_guidance'
  | 'site_manager_confirmation_required'
  | 'report_only'

export type MalaysiaStatusCategory =
  | 'invasive'
  | 'naturalised'
  | 'native'
  | 'introduced'
  | 'cultivated'
  | string

export interface SourceRef {
  source_id: string
  title: string
  publisher: string
  url: string
  accessed: string
  use: string
}

export interface SourcedItem {
  text: string
  source_ids: string[]
}

export interface ActionPath {
  title: string
  eligibility: string
  steps: SourcedItem[]
  stop_conditions: SourcedItem[]
  disposal: SourcedItem[]
}

export interface MalaysiaStatus {
  category: MalaysiaStatusCategory
  display_label: string
  confidence: 'high' | 'medium' | 'low'
  note: string
  source_ids: string[]
}

export interface PlantGuidance {
  plant_id: string
  model_label: string
  scientific_name: string
  common_names: string[]
  malaysia_status: MalaysiaStatus
  guidance_mode: GuidanceMode
  general_information: string
  general_information_source_ids: string[]
  identification_note: string
  risk_flags: string[]
  actions: {
    protected_or_permission_unknown: ActionPath
    authorised_site: ActionPath
  } | null
  spread_prevention: SourcedItem[]
  do_not_do: SourcedItem[]
  follow_up: SourcedItem[]
  /** Curated public-domain / CC-BY-SA reference photo bundled with the app.
   *  Renders alongside the panel header so users can compare their scan with
   *  a known-good specimen. */
  reference_image?: string
  reference_image_credit?: string
}

export interface SafetyPolicy {
  permission_rule: string
  model_rule: string
  protected_land_rule?: string
  never_recommend: string[]
  decision_logic?: string[]
}

export interface PlantGuidanceDataset {
  schema_version: string
  content_version: string
  last_reviewed?: string
  next_review_due?: string
  jurisdiction: string
  locale: string
  safety_policy: SafetyPolicy
  sources: SourceRef[]
  plants: PlantGuidance[]
}

const rawPlantGuidanceDataset = guidanceJson as unknown as PlantGuidanceDataset

const MODEL_STATUS_PRESENTATION: Record<string, Pick<MalaysiaStatus, 'category' | 'display_label' | 'confidence'>> = {
  invasive: {
    category: 'invasive', display_label: 'Invasive in Malaysia', confidence: 'high',
  },
  alien_not_marked_invasive: {
    category: 'information_only', display_label: 'Alien plant · not a target', confidence: 'high',
  },
  common_cultivated_status_not_inferred: {
    category: 'information_only', display_label: 'Cultivated plant · status not inferred', confidence: 'medium',
  },
  introduced: {
    category: 'information_only', display_label: 'Introduced plant · information only', confidence: 'high',
  },
  native: {
    category: 'information_only', display_label: 'Native plant · information only', confidence: 'high',
  },
  naturalised: {
    category: 'information_only', display_label: 'Naturalised plant · information only', confidence: 'high',
  },
  status_requires_expert_review: {
    category: 'status_uncertain', display_label: 'Malaysia status needs expert review', confidence: 'low',
  },
  cryptogenic_uncertain: {
    category: 'status_uncertain', display_label: 'Malaysia status uncertain', confidence: 'low',
  },
  watchlist_not_present: {
    category: 'status_uncertain', display_label: 'Watchlist · not recorded in Malaysia', confidence: 'medium',
  },
}

/**
 * Guidance remains curated content, but identification status always comes
 * from the exact catalogue bundled with the model. This prevents an older
 * guidance review from relabelling a model class in the result UI.
 */
export const plantGuidanceDataset: PlantGuidanceDataset = {
  ...rawPlantGuidanceDataset,
  plants: rawPlantGuidanceDataset.plants.map((plant) => {
    const modelSpecies = findModelSpecies({
      speciesId: plant.plant_id,
      scientificName: plant.scientific_name,
    })
    if (!modelSpecies) return plant
    return {
      ...plant,
      malaysia_status: modelMalaysiaStatus(modelSpecies.malaysia_status, modelSpecies.status_source),
    }
  }),
}

function modelMalaysiaStatus(rawStatus: string, source: string): MalaysiaStatus {
  const status = MODEL_STATUS_PRESENTATION[rawStatus] ?? {
    category: 'status_uncertain',
    display_label: 'Malaysia status needs review',
    confidence: 'low' as const,
  }
  return {
    ...status,
    note: `Model catalogue status source: ${source}.`,
    source_ids: [],
  }
}

const byScientificName = new Map<string, PlantGuidance>()
const byModelLabel = new Map<string, PlantGuidance>()
const byPlantId = new Map<string, PlantGuidance>()

for (const plant of plantGuidanceDataset.plants) {
  byScientificName.set(plant.scientific_name.toLowerCase(), plant)
  byModelLabel.set(plant.model_label.toLowerCase(), plant)
  byPlantId.set(plant.plant_id, plant)
}

const sourceIndex = new Map<string, SourceRef>()
for (const src of plantGuidanceDataset.sources) {
  sourceIndex.set(src.source_id, src)
}

function normalizePlantId(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_')
}

export function findPlantGuidance(query: {
  scientificName?: string | null
  modelLabel?: string | null
  plantId?: string | null
}): PlantGuidance | null {
  const { scientificName, modelLabel, plantId } = query
  if (plantId) {
    const hit = byPlantId.get(normalizePlantId(plantId))
    if (hit) return hit
  }
  if (scientificName) {
    const hit = byScientificName.get(scientificName.toLowerCase())
    if (hit) return hit
  }
  if (modelLabel) {
    const hit = byModelLabel.get(modelLabel.toLowerCase())
    if (hit) return hit
  }
  return null
}

export function getSources(sourceIds: string[]): SourceRef[] {
  const seen = new Set<string>()
  const out: SourceRef[] = []
  for (const id of sourceIds) {
    if (seen.has(id)) continue
    const src = sourceIndex.get(id)
    if (src) {
      out.push(src)
      seen.add(id)
    }
  }
  return out
}

export function getSafetyPolicy(): SafetyPolicy {
  return plantGuidanceDataset.safety_policy
}
