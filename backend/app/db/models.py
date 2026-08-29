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

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Profile(TimestampMixin, Base):
    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint(
            "role IN ('Detector','Volunteer','Coordinator','Expert','Admin')", name="role"
        ),
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
    action_guides: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON_TYPE, default=list, nullable=False
    )


class MonitoredPlace(Base):
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
    __tablename__ = "monitored_areas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    geometry: Mapped[Any] = mapped_column(
        Geography("MULTIPOLYGON", srid=4326, spatial_index=False), nullable=False
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)


class Trail(Base):
    __tablename__ = "trails"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    geometry: Mapped[Any] = mapped_column(
        Geography("MULTILINESTRING", srid=4326, spatial_index=False), nullable=False
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)


class UploadGrant(Base):
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


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('processing','confirmed','merged','needs_rescan','rejected',"
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
        CheckConstraint("capture_source = 'camera'", name="capture_source"),
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
    content_sha256: Mapped[bytes | None] = mapped_column(LargeBinary(32), index=True)
    perceptual_hash: Mapped[str | None] = mapped_column(String(32), index=True)
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
    validation_model_version: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Sighting(Base):
    __tablename__ = "sightings"
    __table_args__ = (
        CheckConstraint(
            "status IN ('candidate','confirmed','rejected','removed','merged')", name="status"
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ReportSightingLink(Base):
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


class VerificationDecision(Base):
    __tablename__ = "verification_decisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    acting_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    previous_state: Mapped[str] = mapped_column(String(20), nullable=False)
    resulting_state: Mapped[str] = mapped_column(String(20), nullable=False)
    merge_target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sightings.id", ondelete="RESTRICT")
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VerificationJob(Base):
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
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('report_confirmed','report_rejected','report_needs_rescan',"
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


class ModelVersion(Base):
    __tablename__ = "model_versions"
    __table_args__ = (UniqueConstraint("provider", "version", name="uq_model_provider_version"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(80), nullable=False)
    version: Mapped[str] = mapped_column(String(120), nullable=False)
    device: Mapped[str] = mapped_column(String(30), nullable=False)
    fake: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class InferenceRecord(Base):
    __tablename__ = "inference_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), index=True, nullable=False
    )
    model_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_versions.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    quality_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    detection_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    identification_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    embedding_json: Mapped[list[float] | None] = mapped_column(JSON_TYPE)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class AutomatedValidationDecision(Base):
    __tablename__ = "automated_validation_decisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    decision: Mapped[str] = mapped_column(String(30), nullable=False)
    previous_state: Mapped[str] = mapped_column(String(30), nullable=False)
    resulting_state: Mapped[str] = mapped_column(String(30), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(120), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(120))
    reason_codes: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    checks_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    merge_target_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sightings.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class OsmImport(Base):
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


class OvcviStreamEvent(Base):
    __tablename__ = "ovcvi_stream_events"
    __table_args__ = (
        UniqueConstraint("stream_id", "event_id", name="uq_ovcvi_stream_event"),
        CheckConstraint("status IN ('received','predicted','labeled','failed')", name="status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    event_id: Mapped[str] = mapped_column(String(160), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    feature_schema_version: Mapped[str] = mapped_column(String(80), nullable=False)
    payload_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    features_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, nullable=False)
    prediction_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    label_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    state_version_before: Mapped[str | None] = mapped_column(String(120))
    state_version_after: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="received", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    labeled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OvcviCheckpoint(Base):
    __tablename__ = "ovcvi_checkpoints"
    __table_args__ = (UniqueConstraint("stream_id", "state_version", name="uq_ovcvi_stream_state"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stream_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    state_version: Mapped[str] = mapped_column(String(120), nullable=False)
    model_version: Mapped[str] = mapped_column(String(120), nullable=False)
    object_key: Mapped[str] = mapped_column(String(500), nullable=False)
    checksum: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


Index("ix_reports_location_gist", Report.location, postgresql_using="gist")
Index("ix_sightings_location_gist", Sighting.location, postgresql_using="gist")
Index("ix_places_location_gist", MonitoredPlace.location, postgresql_using="gist")
Index("ix_areas_geometry_gist", MonitoredArea.geometry, postgresql_using="gist")
Index("ix_trails_geometry_gist", Trail.geometry, postgresql_using="gist")
