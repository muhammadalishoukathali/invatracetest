"""ORM models for the whole InvaTrace schema.

One file for everything rather than splitting per-feature, since most
tables reference profiles/species/reports/sightings and it's easier to see
the relationships in one place. Falls roughly into: pseudonymous auth
(Profile, Installation, RecoveryCode*), the reference data seeded from
OSM/species lists (Species, MonitoredPlace/Area, Trail), the
report -> screening -> sighting pipeline (Report, VerificationJob,
AutomatedValidationDecision, Sighting, ReportSightingLink), and support
tables (UploadGrant, ObjectDeletionJob, Notification, AuditEvent,
IdempotencyRecord). CheckConstraints double as documentation for the
allowed enum-ish string values since we're not using native Postgres enums.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# JSON on SQLite for tests, JSONB on Postgres in real life - lets the test
# suite run against sqlite without needing a real Postgres instance
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class TimestampMixin:
    """created_at/updated_at pair reused by most tables. Not every table gets
    this - a few (Installation, RecoveryCode, etc) manage their own timestamp
    columns because they don't need the auto-updating updated_at.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Profile(TimestampMixin, Base):
    """The pseudonymous "account" - no email or password attached to it.

    Identified externally by public_id (see app/core/security.py), and can
    have multiple Installations (one per device). trust_level starts at
    "New" and affects both rate limiting headroom and whether their reports
    get coordinate displacement (see app/core/privacy.py). The counters below
    are denormalized rather than computed from reports/sightings on every
    read, since trust level is checked on basically every submission.
    """

    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint("role IN ('Detector','Volunteer','Expert','Admin')", name="role"),
        CheckConstraint("trust_level IN ('New','Trusted','Steward')", name="trust_level"),
        CheckConstraint(
            "display_name IS NULL OR char_length(display_name) <= 80", name="display_name"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    public_id: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(20), default="Detector", nullable=False)
    trust_level: Mapped[str] = mapped_column(String(20), default="New", nullable=False)
    recovery_setup_acknowledged: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    resolved_reports: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    valid_reports: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    hard_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    installations: Mapped[list[Installation]] = relationship(back_populates="profile")


class Installation(Base):
    """One row per device/browser that's linked to a Profile.

    We never store the raw installation token, only its HMAC (token_hash,
    see app/core/security.py:keyed_hash). revoked_at lets a user (or an
    admin) kill one device's access - e.g. after "lost my phone" - without
    touching the profile or its other installations.
    """

    __tablename__ = "installations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True, nullable=False)
    key_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    profile: Mapped[Profile] = relationship(back_populates="installations")


class RecoveryCodeBatch(Base):
    """Groups a set of RecoveryCode rows issued together, e.g. when a profile
    is created or a user asks to rotate their codes. Rotating invalidates the
    whole previous batch (invalidated_at) so old codes can't be mixed with new.
    """

    __tablename__ = "recovery_code_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RecoveryCode(Base):
    """Individual one-time-use codes, hashed the same way as installation
    tokens (never stored raw). used_at gets set on redemption instead of
    deleting the row, so we keep a record of when/whether recovery happened.
    key_version tracks which hashing key generation produced code_hash, in
    case credential_hash_key ever needs to be rotated.
    """

    __tablename__ = "recovery_codes"
    __table_args__ = (UniqueConstraint("batch_id", "code_hash", name="uq_recovery_batch_hash"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recovery_code_batches.id", ondelete="CASCADE"), index=True, nullable=False
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    code_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    key_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Species(TimestampMixin, Base):
    """Reference data for plants the app can identify - invasive species plus
    enough native look-alikes to explain "this is what you might be confusing
    it with". id is a slug (not a UUID) since these are curated/seeded, not
    user-generated. action_guides holds the raw seasonal removal-guidance
    JSON blobs that app/domain/action_guidance.py hydrates into API schemas;
    the shape has drifted over time (camelCase vs snake_case keys, old
    action_mode vs newer guidance_mode) which is why that module has to check
    both when reading a guide.
    """

    __tablename__ = "species"
    __table_args__ = (CheckConstraint("risk IS NULL OR risk IN ('high','watch')", name="risk"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    latin_name: Mapped[str] = mapped_column(String(160), nullable=False)
    common_names: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    is_invasive: Mapped[bool] = mapped_column(Boolean, nullable=False)
    risk: Mapped[str | None] = mapped_column(String(20))
    traits: Mapped[list[dict[str, Any]]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    native_twin: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    removal_steps: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON_TYPE, default=list, nullable=False
    )
    do_not_do: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    detail_available: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reportable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # per-month removal guidance, see app/domain/action_guidance.py for how this
    # gets picked apart and turned into a SeasonalActionGuide
    action_guides: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON_TYPE, default=list, nullable=False
    )
    malaysia_status: Mapped[str | None] = mapped_column(String(60))
    status_source: Mapped[str | None] = mapped_column(String(200))
    status_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    general_information: Mapped[str | None] = mapped_column(Text)
    action_eligible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    guidance_content_version: Mapped[str | None] = mapped_column(String(60))
    guidance_last_reviewed: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    guidance_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSON_TYPE, default=dict, nullable=False
    )
    # Iteration 2 Phase 2 - evidence catalogue (32-species v2026-09-08). Every
    # row that belongs to the new catalogue carries the version string; rows
    # left over from the Iteration 1 model-derived seed keep it null so the
    # /api/v1/catalogue endpoint can filter to just the evidence set.
    catalogue_version: Mapped[str | None] = mapped_column(String(32), index=True)
    evidence_codes: Mapped[list[str]] = mapped_column(
        JSON_TYPE, default=list, nullable=False
    )
    evidence_sources: Mapped[list[str]] = mapped_column(
        JSON_TYPE, default=list, nullable=False
    )
    malaysian_states: Mapped[list[str]] = mapped_column(
        JSON_TYPE, default=list, nullable=False
    )
    habitat: Mapped[str | None] = mapped_column(String(60))
    accepted_name_usage: Mapped[str | None] = mapped_column(String(160))
    reference_image_url: Mapped[str | None] = mapped_column(String(500))
    image_attribution: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    identifying_characteristics: Mapped[str | None] = mapped_column(Text)
    typical_habitat: Mapped[str | None] = mapped_column(Text)
    documented_impacts: Mapped[str | None] = mapped_column(Text)
    severity_assessment_available: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    beginner_safe_action_available: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CatalogueVersion(Base):
    """One row per published Iteration 2 catalogue snapshot. AC 5.2.1 needs
    the app to render the version + last-reviewed date so users can trust
    the source of truth is dated."""

    __tablename__ = "catalogue_versions"

    version: Mapped[str] = mapped_column(String(32), primary_key=True)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    reviewed_at: Mapped[Any] = mapped_column(Date, nullable=False)
    total_species_count: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


# location/geometry columns below are GENERATED (Computed) from lat/lng or an
# imported geometry rather than set directly - write latitude/longitude (or
# geometry) and Postgres derives the PostGIS geography column for us. The
# actual gist indexes for spatial queries are declared at the bottom of the
# file rather than inline, since Index() needs the fully-defined column.


class MonitoredPlace(Base):
    """Small set of hand-seeded named locations (parks, reserves) used as a
    last-resort fallback in app/domain/place_association.py when a report's
    coordinates don't fall inside any imported OSM area or trail.
    """

    __tablename__ = "monitored_places"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    latitude: Mapped[Decimal] = mapped_column(Numeric(8, 5), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(Numeric(8, 5), nullable=False)
    location: Mapped[Any] = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False),
        Computed("ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography", persisted=True),
    )


class MonitoredArea(Base):
    """Polygon areas imported from OpenStreetMap (see OsmImport) - parks,
    reserves, forest boundaries. Used to label where a sighting happened
    (app/domain/place_association.py) with something more useful than a
    lat/lng dump.
    """

    __tablename__ = "monitored_areas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    geometry: Mapped[Any] = mapped_column(
        Geography("MULTIPOLYGON", srid=4326, spatial_index=False), nullable=False
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)


class Trail(Base):
    """Line geometry (hiking trails etc) from the same OSM import as
    MonitoredArea, used the same way for place labelling.
    """

    __tablename__ = "trails"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    geometry: Mapped[Any] = mapped_column(
        Geography("MULTILINESTRING", srid=4326, spatial_index=False), nullable=False
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)


class UploadGrant(Base):
    """Tracks a presigned-upload slot handed out for direct-to-R2/MinIO photo
    upload. expires_at bounds how long the presigned URL is valid;
    consumed_at/consumed_by_report_id get set once the grant is actually used
    to submit a report, so a grant can't be replayed against a second report.
    """

    __tablename__ = "upload_grants"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="positive_size"),
        UniqueConstraint("object_key", name="uq_upload_object_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    object_key: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consumed_by_report_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reports.id", ondelete="SET NULL")
    )


class ObjectDeletionJob(Base):
    """Queue of R2/MinIO object keys waiting to be deleted by a background
    worker. attempts/last_error support retrying deletes that fail (object
    storage hiccups) instead of losing track of orphaned objects.
    """

    __tablename__ = "object_deletion_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    object_key: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    last_error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Scan(Base):
    """On-device ML identification result, logged for every capture even if
    it never turns into a Report (e.g. the on-device model said "not the
    target plant" and the user didn't submit). Useful for measuring
    client-model accuracy over time. capture_id is unique and is the join key
    back to a Report if/when the user does submit.
    """

    __tablename__ = "scans"
    __table_args__ = (
        CheckConstraint("outcome IN ('target','other_plant','uncertain')", name="scan_outcome"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="scan_confidence"),
        CheckConstraint(
            "capture_source IS NULL OR capture_source IN ('camera','gallery')",
            name="scan_capture_source",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    capture_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    predicted_species_id: Mapped[str | None] = mapped_column(
        ForeignKey("species.id", ondelete="SET NULL")
    )
    outcome: Mapped[str] = mapped_column(String(30), nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)
    model_version: Mapped[str] = mapped_column(String(120), nullable=False)
    image_sha256: Mapped[bytes | None] = mapped_column(LargeBinary(32))
    # AC 2.2.1 - persisted on the scan (rather than only on the report) so the
    # report's capture_source can be cross-checked against what the client
    # said at classification time.
    capture_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Report(Base):
    """A single submission from a profile: one photo, one location, one
    outcome. This is the "raw" record - it goes through the screening
    worker (app/domain/evidence_screening.py + validation.py) and, if it
    passes, gets linked to a Sighting via ReportSightingLink (a Report never
    becomes public on its own). The lat/lng CheckConstraints hard-pin
    submissions to Malaysia's bounding box, matching the app's scope.
    idempotency_key + profile_id is unique so a retried submission with the
    same key can't create a duplicate row (see app/core/idempotency.py for
    how the lock around that is taken).
    """

    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('processing','screened','merged','needs_rescan','rejected',"
            "'validation_unavailable')",
            name="status",
        ),
        CheckConstraint("outcome IN ('target','other_plant','uncertain')", name="outcome"),
        CheckConstraint("extent IN ('single','small_patch','large_area')", name="extent"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence"),
        CheckConstraint("latitude BETWEEN 0.8 AND 7.5", name="malaysia_latitude"),
        CheckConstraint("longitude BETWEEN 99.3 AND 119.5", name="malaysia_longitude"),
        CheckConstraint("location_accuracy_m IS NULL OR location_accuracy_m >= 0", name="accuracy"),
        CheckConstraint("char_length(notes) <= 280", name="notes_length"),
        CheckConstraint("submitter_trust IN ('New','Trusted','Steward')", name="submitter_trust"),
        CheckConstraint("capture_source IN ('camera','gallery')", name="capture_source"),
        UniqueConstraint("profile_id", "idempotency_key", name="uq_report_idempotency"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    species_id: Mapped[str | None] = mapped_column(ForeignKey("species.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(
        String(30), default="processing", index=True, nullable=False
    )
    photo_key: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    outcome: Mapped[str] = mapped_column(String(30), nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)
    client_model_version: Mapped[str] = mapped_column(String(120), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    capture_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True, nullable=False)
    capture_source: Mapped[str] = mapped_column(String(20), nullable=False)
    # AC 2.2.1 - every report is tied back to the scan the classifier produced
    # for that capture, so create_report can re-verify species/outcome/model
    # version/hash instead of trusting the submitted body alone.
    scan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scans.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    # both indexed - the screening worker uses these to catch exact and
    # near-duplicate photo replays, see app/domain/evidence_screening.py
    content_sha256: Mapped[bytes | None] = mapped_column(LargeBinary(32), index=True)
    perceptual_hash: Mapped[str | None] = mapped_column(String(160), index=True)
    latitude: Mapped[Decimal] = mapped_column(Numeric(8, 5), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(Numeric(8, 5), nullable=False)
    location: Mapped[Any] = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False),
        Computed("ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography", persisted=True),
    )
    location_accuracy_m: Mapped[int | None] = mapped_column(Integer)
    extent: Mapped[str] = mapped_column(String(30), nullable=False)
    notes: Mapped[str] = mapped_column(String(280), default="", nullable=False)
    consent_accurate: Mapped[bool] = mapped_column(Boolean, nullable=False)
    consent_no_pii: Mapped[bool] = mapped_column(Boolean, nullable=False)
    submitter_trust: Mapped[str] = mapped_column(String(20), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    validation_reasons: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    validation_policy_version: Mapped[str | None] = mapped_column(String(120))
    # AC 2.3.2 - self-reference to the retained report a near-duplicate merge
    # folded this one into. Nullable so non-merged reports leave it unset;
    # ON DELETE SET NULL keeps the merged report row intact if the retained
    # report is ever deleted for a legitimate reason.
    merged_into_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reports.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Sighting(Base):
    """The public-facing record - what the map/list actually shows. Created
    once a Report clears screening (or merged into an existing Sighting if
    it's the same species nearby and recent, see app/domain/validation.py).
    Deliberately decoupled from Report: a sighting can have multiple reports
    linked to it over time (ReportSightingLink), and its own lat/lng gets
    passed through app/core/privacy.py's displacement logic before ever
    reaching a public response - the raw Report coordinates never do.
    """

    __tablename__ = "sightings"
    __table_args__ = (
        CheckConstraint(
            "status IN ('candidate','screened','rejected','removed','merged')", name="status"
        ),
        CheckConstraint("reporter_trust IN ('New','Trusted','Steward')", name="reporter_trust"),
        CheckConstraint("latitude BETWEEN 0.8 AND 7.5", name="malaysia_latitude"),
        CheckConstraint("longitude BETWEEN 99.3 AND 119.5", name="malaysia_longitude"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    species_id: Mapped[str] = mapped_column(
        ForeignKey("species.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    source_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    risk: Mapped[str] = mapped_column(String(20), nullable=False)
    latitude: Mapped[Decimal] = mapped_column(Numeric(8, 5), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(Numeric(8, 5), nullable=False)
    location: Mapped[Any] = mapped_column(
        Geography("POINT", srid=4326, spatial_index=False),
        Computed("ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography", persisted=True),
    )
    reporter_trust: Mapped[str] = mapped_column(String(20), nullable=False)
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False)
    merged_into_sighting_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sightings.id", ondelete="SET NULL")
    )
    area_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("monitored_areas.id", ondelete="SET NULL"), index=True
    )
    trail_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("trails.id", ondelete="SET NULL"), index=True
    )
    place_label: Mapped[str] = mapped_column(
        String(380), default="Reported location, Malaysia", nullable=False
    )
    thumbnail_key: Mapped[str | None] = mapped_column(String(500))
    # AC 4.3.1 - nearest OSM feature within 5 km computed at publication time
    # by app.domain.place_association.nearest_osm_feature. Nullable so a
    # sighting outside the 5 km search radius still publishes cleanly.
    nearest_feature_type: Mapped[str | None] = mapped_column(String(30))
    nearest_feature_name: Mapped[str | None] = mapped_column(String(200))
    nearest_feature_distance_m: Mapped[float | None] = mapped_column(Numeric(8, 2))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ReportSightingLink(Base):
    """Join table between Report and Sighting. "active" plus the partial
    unique index right below (uq_report_sighting_active) enforces that a
    given report can only be actively linked to one sighting at a time,
    while still letting the history of past links stick around (ended_at)
    if a report ever gets re-merged elsewhere.
    """

    __tablename__ = "report_sighting_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sighting_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sightings.id", ondelete="CASCADE"), index=True, nullable=False
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


Index(
    "uq_report_sighting_active",
    ReportSightingLink.report_id,
    unique=True,
    postgresql_where=ReportSightingLink.active.is_(True),
)


class VerificationJob(Base):
    """Queue row that drives the screening worker for one Report. Workers pick
    up jobs where available_at <= now, stamp locked_at while processing, and
    move status through pending -> running -> completed (or retry/unavailable/
    failed on the way). Decoupled from the Report row itself so retries and
    worker locking don't need to touch report data directly.
    """

    __tablename__ = "verification_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','retry','unavailable','failed')",
            name="status",
        ),
        UniqueConstraint("report_id", name="uq_verification_job_report"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Notification(Base):
    """In-app notifications for a profile (report screened, rejected, merged,
    etc). read_at is nullable/indexed so "unread count" queries are cheap.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('report_screened','report_rejected','report_needs_rescan',"
            "'report_merged','validation_unavailable','sync_ok','system')",
            name="kind",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    link_to: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class AuditEvent(Base):
    """Generic append-only audit trail - subject_type/subject_id is a loose
    polymorphic reference (not an FK) so this one table can log against any
    entity in the system without a constraint per subject type.
    acting_profile_id is nullable and SET NULL on delete since we still want
    the audit row even if the profile responsible is later deleted.
    """

    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    acting_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"), index=True
    )
    subject_type: Mapped[str] = mapped_column(String(80), nullable=False)
    subject_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(100))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class IdempotencyRecord(Base):
    """Stores the response we sent for a given (profile, scope, idempotency_key)
    so a retried request gets the exact same response replayed back instead
    of re-running the operation. request_hash lets us detect the edge case
    where a client reuses a key with a different body - see
    app/core/idempotency.py:canonical_request_hash. expires_at bounds how
    long we bother remembering it.
    """

    __tablename__ = "idempotency_records"
    __table_args__ = (
        UniqueConstraint("profile_id", "scope", "idempotency_key", name="uq_idempotency_scope_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    scope: Mapped[str] = mapped_column(String(80), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )


class AutomatedValidationDecision(Base):
    """Audit trail specifically for the deterministic screening worker's
    decisions on a Report - kept separate from the generic AuditEvent table
    because this one needs structured fields (checks_json, reason_codes,
    merge_target_id) that are worth querying directly rather than digging
    through a JSON blob. policy_version lets us tell which ruleset produced
    a given decision if the rules change later.
    """

    __tablename__ = "automated_validation_decisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    decision: Mapped[str] = mapped_column(String(30), nullable=False)
    previous_state: Mapped[str] = mapped_column(String(30), nullable=False)
    resulting_state: Mapped[str] = mapped_column(String(30), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(120), nullable=False)
    reason_codes: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    checks_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    merge_target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sightings.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class OsmImport(Base):
    """Records each batch import of OpenStreetMap data that populated
    MonitoredArea/Trail rows. sha256 is unique so re-running an import
    script against the same source file is a harmless no-op instead of
    duplicating areas/trails.
    """

    __tablename__ = "osm_imports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sha256: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True, nullable=False)
    area_count: Mapped[int] = mapped_column(Integer, nullable=False)
    trail_count: Mapped[int] = mapped_column(Integer, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# GiST indexes for the geography/geometry columns - regular btree indexes
# don't help with ST_DWithin/ST_Covers spatial queries, these do. Declared
# here rather than inline on the columns since Index() needs the mapped
# column objects to already exist.
Index("ix_reports_location_gist", Report.location, postgresql_using="gist")
Index("ix_sightings_location_gist", Sighting.location, postgresql_using="gist")
Index("ix_places_location_gist", MonitoredPlace.location, postgresql_using="gist")
Index("ix_areas_geometry_gist", MonitoredArea.geometry, postgresql_using="gist")
Index("ix_trails_geometry_gist", Trail.geometry, postgresql_using="gist")
