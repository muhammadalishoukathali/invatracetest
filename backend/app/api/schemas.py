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


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        extra="forbid",
    )


Role = Literal["Detector", "Volunteer", "Coordinator", "Expert", "Admin"]
TrustLevel = Literal["New", "Trusted", "Steward"]
Outcome = Literal["target", "other_plant", "uncertain"]
Extent = Literal["single", "small_patch", "large_area"]
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

InstallationSecret = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]
DisplayName = Annotated[str, StringConstraints(max_length=80)]


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


class SeasonalActionGuide(ApiModel):
    action_mode: Literal["remove", "contain", "report_only"]
    title: str
    summary: str
    valid_months: list[int]
    steps: list[RemovalStep]
    do_not_do: list[str]
    ppe: list[str]
    decontamination: list[str]
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


class SpeciesListResponse(ApiModel):
    items: list[SpeciesSummary]


class PresignRequest(ApiModel):
    content_type: Literal["image/jpeg"]
    size_bytes: int = Field(gt=0)


class PresignResponse(ApiModel):
    upload_id: str
    upload_url: str
    photo_key: str
    expires_at: datetime


class GeoPoint(ApiModel):
    lat: float = Field(ge=0.8, le=7.5)
    lng: float = Field(ge=99.3, le=119.5)


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
    capture_source: Literal["camera"]
    location: GeoPoint
    location_accuracy_m: int | None = Field(default=None, ge=0, le=100_000)
    extent: Extent
    notes: Annotated[str, StringConstraints(max_length=280)] = ""
    consent: Consent


class ReportSubmission(ReportSubmissionDetails):
    @field_validator("model_version", "notes")
    @classmethod
    def reject_controls(cls, value: str) -> str:
        return _no_controls(value).strip()

    @model_validator(mode="after")
    def validate_species_outcome(self) -> ReportSubmission:
        if self.outcome == "target" and not self.species_id:
            raise ValueError("target reports require a speciesId")
        if self.outcome != "target" and self.species_id is not None:
            raise ValueError("only target reports may include speciesId")
        observed = self.observed_at
        if observed.tzinfo is None:
            raise ValueError("observedAt must include a timezone")
        now = datetime.now(UTC)
        if observed > now + timedelta(minutes=5):
            raise ValueError("observedAt cannot be in the future")
        if observed < now - timedelta(days=30):
            raise ValueError("observedAt is outside the reporting window")
        return self


class ReportValidation(ApiModel):
    reason_codes: list[str]
    retryable: bool
    policy_version: str | None
    model_version: str | None
    screening_method: Literal["deterministic_rules"] | None = None
    authenticity_assessed: Literal[False] = False


class ReportResponse(ApiModel):
    id: str
    status: ReportStatus
    created_at: datetime
    submission: ReportSubmissionDetails
    tracking_url: str
    validation: ReportValidation
    sighting_id: str | None


class ReportListResponse(ApiModel):
    items: list[ReportResponse]
    next_cursor: str | None = None


class PlaceAssociation(ApiModel):
    display_name: str
    area_name: str | None
    trail_name: str | None
    source: Literal["osm", "seed", "fallback"]


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
    screening_method: Literal["deterministic_rules"] = "deterministic_rules"
    authenticity_assessed: Literal[False] = False


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


class OkResponse(ApiModel):
    ok: Literal[True] = True


class HealthResponse(ApiModel):
    status: str
    database: str
    redis: str | None = None
    storage: str | None = None
    screening: str | None = None
    verification_backlog: int | None = None


IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
