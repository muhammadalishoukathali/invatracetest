import guidanceJson from './plant-guidance.json'

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

export const plantGuidanceDataset = guidanceJson as unknown as PlantGuidanceDataset

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
