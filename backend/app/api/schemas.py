from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


"""Pydantic request/response models for the whole API.

Field names are snake_case in Python but serialize as camelCase (to_camel
below) so the React frontend gets the naming convention it expects without
every router having to do the conversion by hand. Grouped roughly by
router: identity/access stuff first, then species, scans, uploads, reports,
sightings, notifications, admin.
"""

def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


# Base class every schema in this file inherits from. extra="forbid" means an
# unexpected field in the request body is a 422, not silently ignored - helps
# catch frontend/backend drift early instead of debugging a mystery later.
class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        extra="forbid",
    )


Role = Literal["Detector", "Volunteer", "Expert", "Admin"]
TrustLevel = Literal["New", "Trusted", "Steward"]
Outcome = Literal["target", "other_plant", "uncertain"]
Extent = Literal["single", "small_patch", "large_area"]
MalaysiaStatus = Literal["invasive", "information_only", "status_uncertain"]
GuidanceMode = Literal[
    "active_guidance",
    "site_manager_confirmation_required",
    "report_only",
]
ReportStatus = Literal[
    "processing",
    "screened",
    "merged",
    "needs_rescan",
    "rejected",
    "validation_unavailable",
]
SightingStatus = Literal["screened", "removed"]
Risk = Literal["high", "watch"]

# 43 chars = a base64url-encoded 256-bit random value generated client-side -
# this is the closest thing to a "password" in the whole auth model.
InstallationSecret = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]
DisplayName = Annotated[str, StringConstraints(max_length=80)]


# Rejects control characters in free-text fields (display names, notes) -
# mostly to stop someone smuggling weird terminal escape codes or null bytes
# through into stored data / notifications.
def _no_controls(value: str) -> str:
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("control characters are not allowed")
    return value


class ErrorResponse(ApiModel):
    code: str
    detail: str
    request_id: str


class ProfileResponse(ApiModel):
    id: str
    display_name: str | None
    role: Role
    trust_level: TrustLevel


class StartProfileRequest(ApiModel):
    installation_token: InstallationSecret
    display_name: DisplayName | None = None

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = _no_controls(value.strip())
        return value or None


class StartProfileResponse(ApiModel):
    access_token: str
    profile: ProfileResponse
    recovery_codes: list[str]
    installation_id: str


class BootstrapRequest(ApiModel):
    installation_token: InstallationSecret


class BootstrapResponse(ApiModel):
    access_token: str
    profile: ProfileResponse
    recovery_setup_required: bool


class RestoreRequest(ApiModel):
    profile_id: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    recovery_code: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    installation_token: InstallationSecret

    # Recovery codes/profile IDs are displayed to the user in uppercase, so
    # normalize case here rather than expecting the client to get it exactly right.
    @field_validator("profile_id", "recovery_code")
    @classmethod
    def normalize_secret_label(cls, value: str) -> str:
        return value.strip().upper()


class RestoreResponse(ApiModel):
    access_token: str
    profile: ProfileResponse
    installation_id: str


class UpdateProfileRequest(ApiModel):
    display_name: DisplayName | None

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = _no_controls(value.strip())
        return value or None


class RecoveryBatchResponse(ApiModel):
    recovery_codes: list[str]
    created_at: datetime


class InstallationResponse(ApiModel):
    id: str
    created_at: datetime
    last_used_at: datetime
    revoked_at: datetime | None
    current: bool


class AccessOverviewResponse(ApiModel):
    profile_id: str
    unused_recovery_code_count: int
    installations: list[InstallationResponse]


class SpeciesSummary(ApiModel):
    id: str
    name: str
    latin_name: str
    is_invasive: bool


class Trait(ApiModel):
    label: str
    value: str


class NativeTwin(ApiModel):
    id: str
    name: str
    latin_name: str
    distinguishing_traits: list[str]


class RemovalStep(ApiModel):
    order: int
    action: str
    safe: bool


class GuidanceSource(ApiModel):
    id: str
    title: str
    publisher: str | None = None
    url: str | None = None
    accessed: str | None = None


class SeasonalActionGuide(ApiModel):
    action_mode: Literal[
        "remove", "contain", "report_only",
        "active_guidance", "site_manager_confirmation_required",
    ]
    guidance_mode: GuidanceMode
    plant_id: str
    content_version: str
    last_reviewed: datetime | None = None
    title: str
    summary: str
    valid_months: list[int]
    steps: list[RemovalStep]
    do_not_do: list[str]
    ppe: list[str]
    decontamination: list[str]
    stop_conditions: list[str] = Field(default_factory=list)
    spread_prevention: list[str] = Field(default_factory=list)
    prohibited_actions: list[str] = Field(default_factory=list)
    sources: list[GuidanceSource] = Field(default_factory=list)
    revision: str


class SpeciesDetail(ApiModel):
    id: str
    name: str
    latin_name: str
    common_names: list[str]
    is_invasive: bool
    risk: Risk
    traits: list[Trait]
    native_twin: NativeTwin | None
    removal_steps: list[RemovalStep]
    do_not_do: list[str]
    reportable: bool
    action_guide: SeasonalActionGuide | None
    malaysia_status: MalaysiaStatus
    status_source_id: str | None = None
    status_reviewed_at: datetime | None = None
    general_information: str | None = None
    # AC 1.2.3 - canonical "do not act" message tailored per Malaysia status.
    safety_message: str | None = None
    action_eligible: bool
    report_eligible: bool


class SpeciesListResponse(ApiModel):
    items: list[SpeciesSummary]


class ScanCreateRequest(ApiModel):
    capture_id: uuid.UUID
    predicted_species_id: Annotated[str, StringConstraints(max_length=80)] | None = None
    outcome: Outcome
    confidence: float = Field(ge=0, le=1)
    model_version: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    image_sha256_hex: Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F]{64}$")] | None = None
    # AC 2.2.1 - capture source recorded at classification time so the later
    # report submission can be checked against it.
    capture_source: Literal["camera", "gallery"] | None = None


class ScanResponse(ApiModel):
    id: str
    capture_id: uuid.UUID
    predicted_species_id: str | None
    outcome: Outcome
    confidence: float
    model_version: str
    capture_source: Literal["camera", "gallery"] | None = None
    created_at: datetime


class PresignRequest(ApiModel):
    content_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(gt=0)


class PresignResponse(ApiModel):
    upload_id: str
    upload_url: str
    photo_key: str
    expires_at: datetime


# Bounds are roughly Malaysia's bounding box - the app is scoped to that
# region so we don't accept (or publish) coordinates from anywhere else.
class GeoPoint(ApiModel):
    lat: float = Field(ge=0.8, le=7.5)
    lng: float = Field(ge=99.3, le=119.5)


# Both fields must literally be True - pydantic rejects the request outright
# if the client sends false, so there's no code path where we'd accidentally
# accept a report the user didn't confirm as accurate/PII-free.
class Consent(ApiModel):
    accurate: Literal[True]
    no_pii: Literal[True] = Field(alias="noPII")


class ReportSubmissionDetails(ApiModel):
    photo_key: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    species_id: Annotated[str, StringConstraints(max_length=80)] | None
    outcome: Outcome
    confidence: float = Field(ge=0, le=1)
    model_version: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    observed_at: datetime
    capture_id: uuid.UUID
    capture_source: Literal["camera", "gallery"]
    location: GeoPoint
    location_accuracy_m: int | None = Field(default=None, ge=0, le=100_000)
    extent: Extent
    notes: Annotated[str, StringConstraints(max_length=280)] = ""
    consent: Consent


class ReportSubmission(ReportSubmissionDetails):
    # Early comparison value only - the server re-hashes the uploaded bytes
    # and rejects any mismatch (see reports.create_report). Never trusted
    # alone, and never echoed back in ReportResponse.submission.
    image_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F]{64}$")] | None = None

    @field_validator("model_version", "notes")
    @classmethod
    def reject_controls(cls, value: str) -> str:
        return _no_controls(value).strip()

    @model_validator(mode="after")
    def validate_species_outcome(self) -> ReportSubmission:
        # A "target" (i.e. it's the invasive species) report needs a
        # species_id; anything else (other_plant/uncertain) must not have one.
        if self.outcome == "target" and not self.species_id:
            raise ValueError("target reports require a speciesId")
        if self.outcome != "target" and self.species_id is not None:
            raise ValueError("only target reports may include speciesId")
        observed = self.observed_at
        if observed.tzinfo is None:
            raise ValueError("observedAt must include a timezone")
        now = datetime.now(UTC)
        # Small forgiveness window for clock skew between device and server -
        # a timestamp a couple minutes in the future gets clamped rather than
        # rejected, since phone clocks drift.
        future_max = now + timedelta(minutes=5)
        if observed > future_max:
            object.__setattr__(self, "observed_at", future_max)
        # Anything older than 30 days is probably a stale offline-queue entry
        # or a bogus timestamp - reject rather than publish an old sighting
        # as if it just happened.
        if self.observed_at < now - timedelta(days=30):
            raise ValueError("observedAt is outside the reporting window")
        return self


class ReportValidation(ApiModel):
    reason_codes: list[str]
    retryable: bool
    policy_version: str | None
    screening_method: Literal["deterministic_rules"] | None = None


class ReportResponse(ApiModel):
    id: str
    status: ReportStatus
    created_at: datetime
    submission: ReportSubmissionDetails
    tracking_url: str
    validation: ReportValidation
    sighting_id: str | None
    # AC 2.3.2 - the retained report id when this row was merged into a
    # prior report; null otherwise. Serialises as ``retainedReportId``.
    retained_report_id: str | None = None


class ReportListResponse(ApiModel):
    items: list[ReportResponse]
    next_cursor: str | None = None


class PlaceAssociation(ApiModel):
    display_name: str
    area_name: str | None
    trail_name: str | None
    source: Literal["osm", "seed", "fallback"]
    # AC 6.1.2 - post-report adopt prompt needs the place UUID so the
    # client can call POST /api/v1/adopted-areas straight from the
    # result screen. Nullable when the sighting did not land inside any
    # MonitoredArea polygon (the "fallback" source case).
    area_id: str | None = None


class SightingResponse(ApiModel):
    id: str
    species_id: str
    species_name: str
    latin_name: str
    status: SightingStatus
    risk: Risk
    location: GeoPoint
    precision_reduced: bool
    report_count: int
    last_reported_at: datetime
    place: PlaceAssociation
    thumbnail_url: str | None
    # AC 4.2.2 - confidence associated with the representative (max across
    # currently-linked reports) so the detail panel can show how confident
    # the classifier was overall. Nullable for legacy rows lacking reports.
    confidence: float | None = None
    # AC 4.3.1 - nearest OSM feature stored at publication time. Rendered
    # first in the detail panel; a live client lookup is non-authoritative.
    nearest_feature_type: str | None = None
    nearest_feature_name: str | None = None
    nearest_feature_distance_m: float | None = None
    screening_method: Literal["deterministic_rules"] = "deterministic_rules"


class SightingDetailResponse(SightingResponse):
    recommended_action: str
    action_guide: SeasonalActionGuide | None
    reporter_trust: TrustLevel


class SightingListResponse(ApiModel):
    items: list[SightingResponse]
    next_cursor: str | None = None


class NotificationResponse(ApiModel):
    id: str
    kind: Literal[
        "report_screened",
        "report_rejected",
        "report_needs_rescan",
        "report_merged",
        "validation_unavailable",
        "sync_ok",
        "system",
    ]
    title: str
    body: str
    created_at: datetime
    read: bool
    link_to: str | None = None


class NotificationListResponse(ApiModel):
    items: list[NotificationResponse]
    unread: int
    next_cursor: str | None = None


class AdminRepairRequest(ApiModel):
    expected_status: ReportStatus
    action: Literal["requeue", "set_needs_rescan", "set_rejected"]
    reason: Annotated[str, StringConstraints(min_length=10, max_length=500)]


class AdminRoleUpdateRequest(ApiModel):
    role: Literal["Detector", "Volunteer", "Expert", "Admin"]
    reason: Annotated[str, StringConstraints(min_length=5, max_length=500)]


class AdminSightingRemoveRequest(ApiModel):
    reason: Annotated[str, StringConstraints(min_length=10, max_length=500)]


class OkResponse(ApiModel):
    ok: Literal[True] = True


class HealthResponse(ApiModel):
    status: str
    database: str
    redis: str | None = None
    storage: str | None = None
    screening: str | None = None
    verification_backlog: int | None = None
    catalogue: dict[str, object] | None = None


# Shape check for the client-supplied Idempotency-Key header, used by both
# uploads.py and reports.py before it ever touches the idempotency table.
IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
