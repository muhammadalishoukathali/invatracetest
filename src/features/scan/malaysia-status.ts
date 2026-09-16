import type { IdentifyResult, MalaysiaStatusState } from '@/types'
import {
  findApprovedSpecies,
  plantStatusDataset,
  type ApprovedSpeciesRecord,
} from '@shared/catalogue'

/**
 * Malaysian status gets resolved once, from the shared catalogue
 * (shared/catalogue/plant-status.json). I only trust the model manifest for
 * the class list itself - the catalogue's ui_state is the actual source of
 * truth for whether something's invasive.
 *
 * A supported classification result carries a ui_state string that comes
 * from the catalogue. If a lookup for the identified class fails at runtime
 * (an older cached bundle, an unknown label, whatever), the fallback is
 * always status_uncertain - I never want a permissive "safe/reportable"
 * default to slip through there.
 *
 * One more thing worth flagging: the model manifest version and the
 * catalogue version have to match. If they drift apart, the class list the
 * classifier is emitting might no longer line up with what the catalogue was
 * written against, so status gets forced to status_uncertain and reporting
 * stays blocked until the shipped catalogue catches up again.
 */
const VALID_UI_STATES: ReadonlySet<MalaysiaStatusState> = new Set([
  'invasive',
  'information_only',
  'status_uncertain',
])

const CATALOGUE_MODEL_VERSION = plantStatusDataset.model_version

export type ResultPathway =
  | 'invasive_reportable'
  | 'invasive_unsupported'
  | 'information_only'
  | 'status_uncertain'
  | 'other_plant'
  | 'uncertain'
  | 'retake_recommended'

export interface ResolvedPathway {
  pathway: ResultPathway
  statusState: MalaysiaStatusState | null
  /** True when reporting is eligible from the catalogue's perspective -
   *  the trust/persistence/server gates still apply at the UI layer. */
  canReport: boolean
  /** True when in-panel removal/containment actions may be offered. */
  canAction: boolean
}

export function deriveMalaysiaStatusState(result: IdentifyResult): MalaysiaStatusState | null {
  if (result.outcome === 'uncertain') return null
  if (isVersionMismatch(result.modelVersion)) return 'status_uncertain'
  const catalogueRecord = resolveCatalogueRecord(result)
  if (catalogueRecord) return 'invasive'
  // Second chance: maybe the model adapter already attached a ui_state itself.
  const carried = result.malaysiaStatus
  if (carried && VALID_UI_STATES.has(carried as MalaysiaStatusState)) {
    return carried as MalaysiaStatusState
  }
  // If nothing matched in the catalogue, fail safe and call it uncertain - I
  // never want to derive invasive or information-only from a lookup that
  // came up empty.
  return 'status_uncertain'
}

export function isReportEligible(state: MalaysiaStatusState | null): boolean {
  return state === 'invasive'
}

/**
 * This is the one place that decides what the result screen should actually
 * render. I kept it pure - no store or DOM dependency - specifically so the
 * invasive / information-only / status-uncertain pathways could all be
 * tested without having to mount the whole page.
 */
export function resolveResultPathway(result: IdentifyResult): ResolvedPathway {
  // Retake takes precedence over every other pathway: the local model already
  // said the photo isn't classifiable, so nothing downstream (PlantNet, the
  // catalogue lookup) should carry weight in the UI.
  if (result.retakeAdvice) {
    return { pathway: 'retake_recommended', statusState: null, canReport: false, canAction: false }
  }
  if (result.outcome === 'uncertain') {
    return { pathway: 'uncertain', statusState: null, canReport: false, canAction: false }
  }
  if (result.outcome === 'other_plant') {
    // "other_plant" already means it's not on the tracked list, so the
    // status_uncertain label here is really just a convenience value - there's
    // nothing to report or act on either way.
    return {
      pathway: 'other_plant',
      statusState: 'status_uncertain',
      canReport: false,
      canAction: false,
    }
  }
  const statusState = deriveMalaysiaStatusState(result)
  if (statusState === 'invasive') {
    // Only a catalogue record that's actually marked reportable gets to offer
    // action or reporting - unsupported target classes fall through to the
    // unsupported pathway below instead.
    if (result.reportable) {
      return { pathway: 'invasive_reportable', statusState, canReport: true, canAction: true }
    }
    return { pathway: 'invasive_unsupported', statusState, canReport: false, canAction: false }
  }
  if (statusState === 'information_only') {
    return { pathway: 'information_only', statusState, canReport: false, canAction: false }
  }
  return { pathway: 'status_uncertain', statusState: 'status_uncertain', canReport: false, canAction: false }
}

function resolveCatalogueRecord(result: IdentifyResult): ApprovedSpeciesRecord | null {
  return findApprovedSpecies({
    speciesId: result.speciesId ?? null,
    scientificName: result.scientificName ?? null,
  })
}

function isVersionMismatch(resultVersion: string | undefined): boolean {
  if (!resultVersion || !CATALOGUE_MODEL_VERSION) return false
  return resultVersion !== CATALOGUE_MODEL_VERSION
}
