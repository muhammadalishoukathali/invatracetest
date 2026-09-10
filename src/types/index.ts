// All the shared request/response shapes for the app live here. UI
// components, feature stores, and src/mocks/handlers.ts all import from this
// one file instead of each feature rolling its own version of what a Report
// or a Sighting looks like - I found that got messy fast when I first tried
// letting each feature define its own types. Roughly grouped below:
// identity/access, scan and species data, report data, map data, notifications.

/** Role and trust level look like they could be one field but they're not -
 *  role is about what actions you're allowed to do, trust level is about how
 *  much review your submitted evidence needs. Kept them separate on purpose. */
export type Role = 'Detector' | 'Volunteer' | 'Expert' | 'Admin'
export type TrustLevel = 'New' | 'Trusted' | 'Steward'

/** The profile as the server sees it, linked to one or more browser installations. */
export interface PseudonymousProfile {
  id: string
  displayName: string | null
  role: Role
  trustLevel: TrustLevel
}

/** The one thing that actually persists long-term in this browser for private access. */
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

/** "screened" just means it passed the current deterministic rules, not that a human looked at it. */
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
  // this is for the Iteration 1 P2 AC - true only when the server's
  // model-config gate was actually reachable and accepted the result.
  // false covers both "the gate rejected it" and "couldn't reach the gate
  // at all" (server down, app offline, etc). Either way the UI still shows
  // the local classification, it just won't let you report until this
  // comes back true.
  serverAccepted?: boolean
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
  /** Photo of the native look-alike, mainly so people can visually compare it against what they scanned. */
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
  // these two come from the server and win over whatever the client
  // would've worked out on its own - if either is false, the UI just
  // hides the matching controls, no exceptions
  actionEligible?: boolean
  reportEligible?: boolean
  // metadata about when/how the species' Malaysia-status record was last reviewed
  statusReviewedAt?: string
  statusSourceId?: string
  // AC 1.2.3 wanted every accepted supported label to come with some sourced
  // context even when it's information-only or status-uncertain, plus a
  // fixed safety message explaining why the app isn't giving active removal
  // guidance for it
  generalInformation?: string | null
  safetyMessage?: string | null
  /** Curated reference photo of the specimen for visual comparison. */
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
  uploadUrl: string   // temporary URL the client uploads the image to
  photoKey: string    // server-generated key, gets included when the report is created
  expiresAt: string   // ISO timestamp for when the upload URL stops working
}

/** This is what the client assembles locally before it's actually submitted. */
export interface ReportDraft {
  photoKey: string | null           // only set once the image upload actually succeeds
  speciesId: string | null          // null whenever the model came back uncertain
  outcome: Outcome
  confidence: number
  modelVersion: string
  observedAt: string
  captureId: string
  captureSource: 'camera' | 'gallery'
  location: GeoPoint | null
  locationAccuracyM: number | null  // GPS accuracy in metres, null until we get a fix
  extent: ExtentSize | null
  notes: string
  consentAccurate: boolean
  consentNoPII: boolean
}

/** The actual wire format sent to the server for a submission. */
export interface ReportSubmission {
  photoKey: string
  /** SHA-256 of the raw capture bytes, worked out once client-side and sent
   *  along with the submission. Lets the server catch exact duplicate
   *  reports from the same identity without ever needing to look at the
   *  actual image bytes. */
  imageSha256?: string
  speciesId: string | null
  outcome: Outcome
  confidence: number
  modelVersion: string
  observedAt: string
  captureId: string
  captureSource: 'camera' | 'gallery'
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
  /**
   * For AC 2.3.2 - this is the id of the earlier report this one got merged
   * into. Stays null if it wasn't merged. Note `id` itself doesn't change to
   * the merged-into report's id, it keeps being the incoming report's id, so
   * /reports/{id} still tracks this specific submission.
   */
  retainedReportId: string | null
  /** Owner id from the server's perspective, used to spot duplicate reports from one profile. */
  ownerProfileId?: string
}

export interface ReportListResponse {
  items: Report[]
  nextCursor?: string | null
}

/** What sits in the IndexedDB offline queue when a submission couldn't go through. */
export interface QueuedReport {
  id: string           // stable idempotency key, generated before the first network attempt ever fires
  ownerProfileId: string | null
  createdAt: string
  attempts: number
  retryable: boolean
  lastError: string | null
  submission: ReportSubmission
  imageBlob: Blob      // kept around locally until both the upload and report creation actually succeed
}

// Map data.

/** This is what a map pin looks like coming back from the sightings API. The
 *  server sometimes reduces coordinate precision for privacy reasons, and
 *  when it does, precisionReduced tells the UI to say the location shown is
 *  approximate rather than exact. */
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
  /** For AC 4.2.2 - a stand-in confidence value for the whole aggregated
   *  sighting, worked out as the max across all currently-linked reports.
   *  Null if none of the linked reports actually recorded a confidence. */
  confidence: number | null
  /** For AC 4.3.1 - the nearest named OSM feature within 5km, stored server-side.
   *  Null if nothing on the allow-list is close enough. */
  nearestFeatureType: string | null
  nearestFeatureName: string | null
  nearestFeatureDistanceM: number | null
  screeningMethod: 'deterministic_rules'
}

export interface SightingDetail extends Sighting {
  recommendedAction: string
  actionGuide: SeasonalActionGuide | null
  reporterTrust: TrustLevel  // newer profiles get stronger location privacy applied
}

export interface PlaceAssociation {
  displayName: string
  areaName: string | null
  trailName: string | null
  source: 'osm' | 'seed' | 'fallback'
  /** AC 6.1.2 - MonitoredArea id when the sighting fell inside an area
   *  polygon. Null for the fallback place-source case. Powers the
   *  post-report "Adopt this area" prompt so the client can call
   *  POST /api/v1/adopted-areas without a second round-trip. */
  areaId?: string | null
}

// Notification data.

export type NotificationKind =
  | 'report_screened'    // means the deterministic rules published this report
  | 'report_rejected'    // automated integrity checks knocked it back
  | 'report_needs_rescan'
  | 'report_merged'
  | 'validation_unavailable'
  | 'sync_ok'            // an offline report finally made it to the server after reconnecting
  | 'system'             // catch-all for anything that doesn't fit the other kinds

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: string
  read: boolean
  linkTo?: string        // route to open in the app if the notification gets tapped, optional
}
