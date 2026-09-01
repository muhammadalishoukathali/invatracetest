/** A role controls which actions a profile may perform. Trust level describes
 *  how much review its evidence needs, so the two values stay separate. */
export type Role = 'Detector' | 'Volunteer' | 'Expert' | 'Admin'
export type TrustLevel = 'New' | 'Trusted' | 'Steward'

/** Server-authoritative profile connected to one or more browser installations. */
export interface PseudonymousProfile {
  id: string
  displayName: string | null
  role: Role
  trustLevel: TrustLevel
}

/** The only long-lived private-access record stored in this browser. */
export interface InstallationIdentity {
  schemaVersion: 2
  installationToken: string
  createdAt: string
  profileId: string | null
  recoverySetupComplete: boolean
}

export interface StartPrivateAccessResponse {
  accessToken: string
  profile: PseudonymousProfile
  recoveryCodes: string[]
  installationId: string
}

export interface BootstrapSessionResponse {
  accessToken: string
  profile: PseudonymousProfile
  recoverySetupRequired: boolean
}

export interface RestorePrivateAccessResponse {
  accessToken: string
  profile: PseudonymousProfile
  installationId: string
}

export interface RecoveryCodeBatchResponse {
  recoveryCodes: string[]
  createdAt: string
}

export interface AuthorizedInstallation {
  id: string
  createdAt: string
  lastUsedAt: string
  revokedAt: string | null
  current: boolean
}

export interface AccessOverview {
  profileId: string
  unusedRecoveryCodeCount: number
  installations: AuthorizedInstallation[]
}

/** Screened means the current deterministic rules passed. */
export type SightingStatus = 'screened' | 'removed'
export type ReportStatus =
  | 'processing'
  | 'screened'
  | 'merged'
  | 'needs_rescan'
  | 'rejected'
  | 'validation_unavailable'
export type Risk = 'high' | 'watch'

// Scan and species data.

export type Outcome = 'target' | 'other_plant' | 'uncertain'

export interface BBox { x: number; y: number; w: number; h: number }

export interface QualityResult { ok: boolean; reason?: string }

export type MalaysiaStatusState = 'invasive' | 'information_only' | 'status_uncertain'

export interface IdentifyResult {
  outcome: Outcome
  speciesId?: string
  speciesName?: string
  scientificName?: string
  malaysiaStatus?: string
  statusSource?: string
  isInvasive?: boolean
  confidence: number
  modelVersion: string
  unknownProbability?: number
  reportable: boolean
  topPredictions?: Array<{
    speciesId: string
    name: string
    confidence: number
    isInvasive: boolean
  }>
}

export interface Trait { label: string; value: string }

export interface NativeTwin {
  id: string
  name: string
  latinName: string
  distinguishingTraits: string[]
  /** Photo of the native look-alike so the user can compare visually. */
  referenceImageUrl?: string
  referenceImageCredit?: string
}

export interface RemovalStep { order: number; action: string; safe: boolean }

export interface SpeciesDetail {
  id: string
  name: string
  latinName: string
  commonNames: string[]
  isInvasive: boolean
  risk: Risk
  traits: Trait[]
  nativeTwin: NativeTwin | null
  removalSteps: RemovalStep[]
  doNotDo: string[]
  reportable?: boolean
  actionGuide?: SeasonalActionGuide | null
  // AC 1.2.3 — server-supplied action/report gates. When false, the UI hides
  // the corresponding controls regardless of client-side derivation.
  actionEligible?: boolean
  reportEligible?: boolean
  // AC 1.2.2 — per-species reviewed date for the Malaysia-status record.
  statusReviewedAt?: string
  statusSourceId?: string
  /** Curated reference photo of a healthy specimen. Used in the look-alike
   *  comparison so the user can eyeball their scan against a known example. */
  referenceImageUrl?: string
  referenceImageCredit?: string
}

export interface SeasonalActionGuide {
  actionMode: 'remove' | 'contain' | 'report_only'
  title: string
  summary: string
  validMonths: number[]
  steps: RemovalStep[]
  doNotDo: string[]
  ppe: string[]
  decontamination: string[]
  revision: string
}

// Report data.

export type ExtentSize = 'single' | 'small_patch' | 'large_area'

export interface GeoPoint { lat: number; lng: number }

export interface PresignedUpload {
  uploadId: string
  uploadUrl: string   // Temporary URL where the client uploads the image.
  photoKey: string    // Server-generated key included when creating the report.
  expiresAt: string   // ISO timestamp for when the upload URL expires.
}

/** What the client builds locally before submitting. */
export interface ReportDraft {
  photoKey: string | null           // Set after the image upload succeeds.
  speciesId: string | null          // Null when the model result is uncertain.
  outcome: Outcome
  confidence: number
  modelVersion: string
  observedAt: string
  captureId: string
  captureSource: 'camera'
  location: GeoPoint | null
  locationAccuracyM: number | null  // GPS accuracy in metres; null until a fix is available.
  extent: ExtentSize
  notes: string
  consentAccurate: boolean
  consentNoPII: boolean
}

/** The submission wire format. */
export interface ReportSubmission {
  photoKey: string
  /** AC 2.3.1 — SHA-256 of the raw capture bytes, computed client-side once
   *  and sent with the submission so the server can reject exact duplicates
   *  from the same identity without ever inspecting the image bytes. */
  imageSha256?: string
  speciesId: string | null
  outcome: Outcome
  confidence: number
  modelVersion: string
  observedAt: string
  captureId: string
  captureSource: 'camera'
  location: GeoPoint
  locationAccuracyM: number | null
  extent: ExtentSize
  notes: string
  consent: { accurate: true; noPII: true }
}

export interface Report {
  id: string
  status: ReportStatus
  createdAt: string
  submission: ReportSubmission
  trackingUrl: string
  validation: {
    reasonCodes: string[]
    retryable: boolean
    policyVersion: string | null
    screeningMethod: 'deterministic_rules' | null
  }
  sightingId: string | null
  /** AC 2.3.1 / 2.3.2 — server-scoped owner used for same-identity dedup. */
  ownerProfileId?: string
}

export interface ReportListResponse {
  items: Report[]
  nextCursor?: string | null
}

/** Item held in the IndexedDB offline queue when submission fails. */
export interface QueuedReport {
  id: string           // Stable idempotency key created before the first network attempt.
  ownerProfileId: string | null
  createdAt: string
  attempts: number
  retryable: boolean
  lastError: string | null
  submission: ReportSubmission
  imageBlob: Blob      // Image kept locally until upload and report creation succeed.
}

// Map data.

/** Map pin returned by the sightings API. The server reduces coordinate
 *  precision when needed. `precisionReduced` tells the UI to explain that the
 *  displayed location is approximate. */
export interface Sighting {
  id: string
  speciesId: string
  speciesName: string
  latinName: string
  status: SightingStatus
  risk: Risk
  location: GeoPoint
  precisionReduced: boolean
  reportCount: number
  lastReportedAt: string
  place: PlaceAssociation
  thumbnailUrl: string | null
  screeningMethod: 'deterministic_rules'
}

export interface SightingDetail extends Sighting {
  recommendedAction: string
  actionGuide: SeasonalActionGuide | null
  reporterTrust: TrustLevel  // New profiles receive stronger location privacy.
}

export interface PlaceAssociation {
  displayName: string
  areaName: string | null
  trailName: string | null
  source: 'osm' | 'seed' | 'fallback'
}

// Notification data.

export type NotificationKind =
  | 'report_screened'    // Deterministic rules published the user's report.
  | 'report_rejected'    // Automated integrity checks rejected the report.
  | 'report_needs_rescan'
  | 'report_merged'
  | 'validation_unavailable'
  | 'sync_ok'            // An offline report reached the server after reconnecting.
  | 'system'             // A general message that does not fit another category.

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: string
  read: boolean
  linkTo?: string        // Optional application route opened when selected.
}
