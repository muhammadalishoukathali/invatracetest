"""Demo fixtures wired to every acceptance-criteria row.

Layered on top of :func:`app.seed.load_development_fixtures`. Idempotent by
public/business keys so re-runs are no-ops. Refuses to run in production; the
CLI enforces that guard.

The point is that walking `docs/iteration-2-ac-verification.md` and
`docs/ac-remediation-plan.md` end-to-end no longer requires manually staging
merged reports, `needs_rescan`, `validation_unavailable`, recovery codes,
adopted areas, place-sighting evidence, protected areas, and waterway
graph data - a single `invatrace seed-acceptance-demo` run leaves all of it
in place.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    AdoptedArea,
    AuditEvent,
    AutomatedValidationDecision,
    IdempotencyRecord,
    Installation,
    MonitoredArea,
    MonitoredPlace,
    Notification,
    OccurrenceRecord,
    OsmImport,
    PlaceOccurrenceWaterwayEvidence,
    PlaceSightingEvidence,
    Profile,
    ProtectedArea,
    ProtectedAreaDataset,
    RecoveryCode,
    RecoveryCodeBatch,
    Report,
    ReportSightingLink,
    Scan,
    Sighting,
    SightingStatusEvent,
    Trail,
    UploadGrant,
    VerificationJob,
    WaterwayDataset,
    WaterwayEdge,
)
from app.featured_places_seed import seed_featured_places
from app.seed import load_development_fixtures

# Deterministic UUID root so every re-run of the seed produces the same ids
# for the same logical rows - lets us upsert by primary key instead of by an
# extra "seed key" column.
_AC_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "invatrace-acceptance-demo-v1")
_NOW = datetime(2026, 9, 15, 8, 0, tzinfo=UTC)
_POLICY_VERSION = "acceptance-demo-policy-v1"
_MODEL_VERSION = "student33-v1"
_GEOMETRY_VERSION = "acceptance-demo-geometry-v1"
_DATA_VERSION = "acceptance-demo-data-v1"


def _ac_uuid(key: str) -> uuid.UUID:
    return uuid.uuid5(_AC_NAMESPACE, key)


def _digest(key: str) -> bytes:
    return hashlib.sha256(f"acceptance-demo:{key}".encode()).digest()


PROFILES = (
    # (public_id, display_name, role, trust_level, resolved_reports, valid_reports, hard_failures)
    ("nurul-aisyah", "Nurul Aisyah", "Detector", "New", 0, 0, 0),
    ("hafiz-rahman", "Muhammad Hafiz Rahman", "Volunteer", "Trusted", 12, 10, 1),
    ("siti-nurhaliza", "Dr. Siti Nurhaliza Ismail", "Expert", "Steward", 40, 38, 0),
    ("ahmad-faizal", "Ahmad Faizal Zulkifli", "Admin", "Steward", 5, 5, 0),
)


def _upsert_profile(
    session: Session,
    public_id: str,
    display_name: str,
    role: str,
    trust: str,
    resolved: int,
    valid: int,
    failures: int,
) -> Profile:
    existing = session.scalar(select(Profile).where(Profile.public_id == public_id))
    if existing:
        return existing
    profile = Profile(
        id=_ac_uuid(f"profile:{public_id}"),
        public_id=public_id,
        display_name=display_name,
        role=role,
        trust_level=trust,
        recovery_setup_acknowledged=True,
        resolved_reports=resolved,
        valid_reports=valid,
        hard_failures=failures,
    )
    session.add(profile)
    session.flush()
    return profile


def _seed_installations(session: Session, profile: Profile) -> None:
    """Two active installations + one revoked, so multi-device and revocation
    ACs (2.3.x recovery + device management) have data to display.
    """
    specs = [
        (f"{profile.public_id}:device-primary", None),
        (f"{profile.public_id}:device-secondary", None),
        (f"{profile.public_id}:device-revoked", _NOW - timedelta(days=3)),
    ]
    for key, revoked_at in specs:
        install_id = _ac_uuid(f"installation:{key}")
        if session.get(Installation, install_id):
            continue
        session.add(
            Installation(
                id=install_id,
                profile_id=profile.id,
                token_hash=_digest(f"installation:{key}"),
                key_version=1,
                created_at=_NOW - timedelta(days=30),
                last_used_at=_NOW - timedelta(hours=6),
                revoked_at=revoked_at,
            )
        )


def _seed_recovery_codes(session: Session, profile: Profile) -> None:
    batch_id = _ac_uuid(f"recovery-batch:{profile.public_id}")
    if session.get(RecoveryCodeBatch, batch_id):
        return
    session.add(
        RecoveryCodeBatch(
            id=batch_id,
            profile_id=profile.id,
            created_at=_NOW - timedelta(days=14),
        )
    )
    session.flush()
    for index in range(10):
        used_at = _NOW - timedelta(days=1) if index == 0 else None
        code_id = _ac_uuid(f"recovery-code:{profile.public_id}:{index}")
        session.add(
            RecoveryCode(
                id=code_id,
                batch_id=batch_id,
                profile_id=profile.id,
                code_hash=_digest(f"recovery-code:{profile.public_id}:{index}"),
                key_version=1,
                used_at=used_at,
            )
        )


def _box_wkt(lon: float, lat: float, half: float = 0.0015) -> str:
    w, e = lon - half, lon + half
    s, n = lat - half, lat + half
    return (
        f"MULTIPOLYGON((("
        f"{w:.6f} {s:.6f},{e:.6f} {s:.6f},{e:.6f} {n:.6f},"
        f"{w:.6f} {n:.6f},{w:.6f} {s:.6f})))"
    )


def _line_wkt(points: list[tuple[float, float]]) -> str:
    return "LINESTRING(" + ",".join(f"{lon:.6f} {lat:.6f}" for lon, lat in points) + ")"


def _seed_protected_area(session: Session) -> ProtectedAreaDataset:
    dataset_id = _ac_uuid("protected-dataset")
    dataset = session.get(ProtectedAreaDataset, dataset_id)
    if dataset:
        return dataset
    dataset = ProtectedAreaDataset(
        id=dataset_id,
        source="DWNP Peninsular Malaysia Protected Areas",
        version="2025.09",
        updated_at=_NOW - timedelta(days=7),
        coverage_note="Kuala Lumpur and Selangor federal parks and forest reserves.",
        coverage_geometry=func.ST_GeogFromText(f"SRID=4326;{_box_wkt(101.6412, 3.1497, 0.02)}"),
        metadata_json={"licence": "CC-BY-4.0", "authority": "Department of Wildlife and National Parks"},
        active=True,
    )
    session.add(dataset)
    session.flush()
    session.add(
        ProtectedArea(
            id=_ac_uuid("protected-area"),
            dataset_id=dataset.id,
            source_feature_id="MY-KL-BK-01",
            name="Bukit Kiara Federal Park",
            metadata_json={"iucn_category": "V", "gazetted_year": 2021},
            geometry=func.ST_GeogFromText(f"SRID=4326;{_box_wkt(101.6412, 3.1497, 0.004)}"),
        )
    )
    return dataset


def _seed_waterway(session: Session) -> WaterwayDataset:
    dataset_id = _ac_uuid("waterway-dataset")
    dataset = session.get(WaterwayDataset, dataset_id)
    if dataset:
        return dataset
    dataset = WaterwayDataset(
        id=dataset_id,
        source="OpenStreetMap Malaysia (Geofabrik)",
        version="2026.09.14",
        source_timestamp=_NOW - timedelta(days=14),
        sha256=_digest("waterway-dataset"),
        metadata_json={"licence": "ODbL", "extract": "malaysia-singapore-brunei-latest"},
        active=True,
    )
    session.add(dataset)
    session.flush()
    edges = [
        (101.6410, 3.1490, 101.6420, 3.1500),
        (101.6420, 3.1500, 101.6430, 3.1510),
        (101.6430, 3.1510, 101.6440, 3.1520),
    ]
    for seq, (lon1, lat1, lon2, lat2) in enumerate(edges, start=1):
        session.add(
            WaterwayEdge(
                dataset_id=dataset.id,
                osm_way_id=900_000 + seq,
                sequence=seq,
                start_osm_node_id=800_000 + seq,
                end_osm_node_id=800_001 + seq,
                waterway_type="stream",
                geometry=func.ST_GeogFromText(
                    f"SRID=4326;{_line_wkt([(lon1, lat1), (lon2, lat2)])}"
                ),
                length_m=Decimal("120.00"),
                direction="osm_way_order",
            )
        )
    return dataset


def _seed_occurrences(session: Session) -> list[uuid.UUID]:
    species_ids = ["mikania-micrantha", "chromolaena-odorata", "eichhornia-crassipes"]
    coords = [
        (3.1497, 101.6412),
        (3.1505, 101.6420),
        (3.1512, 101.6430),
        (3.1489, 101.6398),
        (3.1523, 101.6440),
    ]
    ids: list[uuid.UUID] = []
    for index, (lat, lng) in enumerate(coords):
        record_id = _ac_uuid(f"occurrence:{index}")
        ids.append(record_id)
        if session.get(OccurrenceRecord, record_id):
            continue
        session.add(
            OccurrenceRecord(
                id=record_id,
                source="GBIF",
                source_occurrence_id=f"GBIF-MY-{4820_0000 + index + 1}",
                species_id=species_ids[index % len(species_ids)],
                latitude=Decimal(str(lat)),
                longitude=Decimal(str(lng)),
                coordinate_uncertainty_m=25,
                observed_year=2024,
                metadata_json={"basis_of_record": "HumanObservation", "recorded_by": "iNaturalist MY"},
                processed_data_version=_DATA_VERSION,
            )
        )
    return ids


def _seed_place_occurrence_evidence(
    session: Session, monitored_area_id: uuid.UUID, occurrence_ids: list[uuid.UUID]
) -> None:
    for index, occ_id in enumerate(occurrence_ids[:2]):
        row_id = _ac_uuid(f"place-occ-evidence:{index}")
        if session.get(PlaceOccurrenceWaterwayEvidence, row_id):
            continue
        session.add(
            PlaceOccurrenceWaterwayEvidence(
                id=row_id,
                place_type="park",
                place_id=monitored_area_id,
                occurrence_id=occ_id,
                waterway_network_id=f"osm-my-kl-waterway-{index + 1:03d}",
                upstream_distance_m=Decimal("450.00"),
                occurrence_snap_distance_m=Decimal("12.50"),
                place_snap_distance_m=Decimal("8.30"),
                occurrence_osm_way_id=900_001,
                place_osm_way_id=900_002,
                direction_source="OSM waterway network (Geofabrik 2026.09.14)",
                data_version=_DATA_VERSION,
            )
        )


def _seed_adopted_areas(
    session: Session, profile: Profile, area: MonitoredArea, trail: Trail
) -> None:
    for kind, place_type, place_id, geom in (
        ("area", "park", area.id, _box_wkt(101.6438, 3.1442, 0.0018)),
        ("trail", "trail", trail.id, _line_wkt([(101.6410, 3.1420), (101.6438, 3.1442)])),
    ):
        row_id = _ac_uuid(f"adopted:{profile.public_id}:{kind}")
        if session.get(AdoptedArea, row_id):
            continue
        session.add(
            AdoptedArea(
                id=row_id,
                profile_id=profile.id,
                place_type=place_type,
                place_id=place_id,
                geometry_version=_GEOMETRY_VERSION,
                geometry=func.ST_GeogFromText(f"SRID=4326;{geom}"),
                adopted_at=_NOW - timedelta(days=5),
            )
        )


# One report per legal ReportStatus so every screening path has coverage.
REPORT_SPECS = (
    # (status, species_id, outcome, capture_source, place_label, note)
    (
        "processing",
        "mikania-micrantha",
        "target",
        "camera",
        "Bukit Kiara · West Trail",
        "Fresh climbing vine wrapping a young dipterocarp near the trailhead.",
    ),
    (
        "screened",
        "mikania-micrantha",
        "target",
        "camera",
        "Bukit Kiara · Look-out",
        "Dense mat of Mile-a-minute smothering the roadside embankment.",
    ),
    (
        "merged",
        "mikania-micrantha",
        "target",
        "camera",
        "Bukit Kiara · Ridge Path",
        "Same patch as the earlier report - photographed from the ridge side.",
    ),
    (
        "needs_rescan",
        "chromolaena-odorata",
        "target",
        "camera",
        "Bukit Kiara · Picnic Area",
        "Photo was too close - please retake with the whole flower cluster in frame.",
    ),
    (
        "rejected",
        "eichhornia-crassipes",
        "target",
        "gallery",
        "Taman Tugu · Pond edge",
        "Photo appears to be from outside Peninsular Malaysia. Rejected on scope.",
    ),
    (
        "validation_unavailable",
        "mikania-micrantha",
        "target",
        "camera",
        "FRIM Kepong · Canopy walk",
        "Screening backend was offline when this was submitted. Will retry.",
    ),
)

# (kind, title, body)
NOTIFICATION_KINDS = (
    (
        "report_screened",
        "Report accepted",
        "Your Mile-a-minute sighting at Bukit Kiara has passed screening and is now visible on the community map.",
    ),
    (
        "report_rejected",
        "Report not accepted",
        "The Water hyacinth photo at Taman Tugu did not clear the location scope check. Reports must be inside Peninsular Malaysia.",
    ),
    (
        "report_needs_rescan",
        "Please retake the photo",
        "Your Siam weed report at Bukit Kiara needs a sharper photo of a single flower head. Open the app to try again.",
    ),
    (
        "report_merged",
        "Report merged with an existing sighting",
        "Your ridge-path report was recognised as the same patch reported earlier. It's linked to the existing sighting.",
    ),
    (
        "validation_unavailable",
        "Screening delayed",
        "The automated reviewer is briefly unavailable. Your report will be screened as soon as service resumes - no action needed.",
    ),
    (
        "sync_ok",
        "Reports synced",
        "All queued reports were sent to InvaTrace successfully.",
    ),
    (
        "system",
        "Selamat datang ke InvaTrace",
        "Get started with the field guide: how to photograph invasive plants and stay safe during removals.",
    ),
)


_REPORT_COORDS = {
    "Bukit Kiara · West Trail": (3.1497, 101.6412),
    "Bukit Kiara · Look-out": (3.1523, 101.6440),
    "Bukit Kiara · Ridge Path": (3.1516, 101.6371),
    "Bukit Kiara · Picnic Area": (3.1489, 101.6398),
    "Taman Tugu · Pond edge": (3.1502, 101.6688),
    "FRIM Kepong · Canopy walk": (3.2340, 101.6293),
    "Bukit Nanas Forest Reserve · Ridge path": (3.1521, 101.7020),
    "Bukit Gasing · North gate": (3.1044, 101.6538),
}


def _seed_reports_and_sightings(
    session: Session, detector: Profile, volunteer: Profile
) -> None:
    now = _NOW

    scan_ids: dict[str, uuid.UUID] = {}
    report_ids: dict[str, uuid.UUID] = {}

    # First pass: scans + reports (deterministic ids, upsert-friendly).
    for index, (status, species_id, outcome, capture_source, place_label, note) in enumerate(REPORT_SPECS):
        report_lat, report_lng = _REPORT_COORDS.get(place_label, (3.1497, 101.6412))
        scan_id = _ac_uuid(f"scan:{status}")
        report_id = _ac_uuid(f"report:{status}")
        capture_id = _ac_uuid(f"capture:{status}")
        scan_ids[status] = scan_id
        report_ids[status] = report_id

        if not session.get(Scan, scan_id):
            session.add(
                Scan(
                    id=scan_id,
                    profile_id=detector.id,
                    capture_id=capture_id,
                    predicted_species_id=species_id,
                    outcome=outcome,
                    confidence=Decimal("0.85000"),
                    model_version=_MODEL_VERSION,
                    image_sha256=_digest(f"scan-image:{status}"),
                    capture_source=capture_source,
                    created_at=now - timedelta(hours=index + 2),
                )
            )
            session.flush()

        photo_key = f"acceptance-demo/reports/{status}.jpg"
        if not session.get(Report, report_id):
            session.add(
                Report(
                    id=report_id,
                    profile_id=detector.id,
                    species_id=species_id,
                    status=status,
                    photo_key=photo_key,
                    outcome=outcome,
                    confidence=Decimal("0.85000"),
                    client_model_version=_MODEL_VERSION,
                    observed_at=now - timedelta(hours=index + 2),
                    capture_id=capture_id,
                    capture_source=capture_source,
                    scan_id=scan_id,
                    content_sha256=_digest(f"report-content:{status}"),
                    perceptual_hash=hashlib.sha1(status.encode()).hexdigest(),
                    latitude=Decimal(str(round(report_lat, 5))),
                    longitude=Decimal(str(round(report_lng, 5))),
                    location_accuracy_m=8,
                    extent="single",
                    notes=note,
                    consent_accurate=True,
                    consent_no_pii=True,
                    submitter_trust=detector.trust_level,
                    idempotency_key=f"acceptance-demo-{status}",
                    validation_reasons=[],
                    validation_policy_version=_POLICY_VERSION,
                    created_at=now - timedelta(hours=index + 1),
                    updated_at=now - timedelta(hours=index),
                )
            )
            session.flush()

        # Upload grant tied to this report.
        grant_id = _ac_uuid(f"upload-grant:{status}")
        if not session.get(UploadGrant, grant_id):
            session.add(
                UploadGrant(
                    id=grant_id,
                    profile_id=detector.id,
                    object_key=photo_key,
                    content_type="image/jpeg",
                    size_bytes=524_288,
                    created_at=now - timedelta(hours=index + 3),
                    expires_at=now + timedelta(days=1),
                    consumed_at=now - timedelta(hours=index + 1),
                    consumed_by_report_id=report_id,
                )
            )

        # AuditEvent trail for each report.
        event_id = _ac_uuid(f"audit:{status}:created")
        if not session.get(AuditEvent, event_id):
            session.add(
                AuditEvent(
                    id=event_id,
                    event_type="report.created",
                    acting_profile_id=detector.id,
                    subject_type="report",
                    subject_id=str(report_id),
                    metadata_json={"status": status, "seed": "acceptance-demo"},
                    created_at=now - timedelta(hours=index + 1),
                )
            )

        # Idempotency record replay cache.
        idem_id = _ac_uuid(f"idempotency:{status}")
        if not session.get(IdempotencyRecord, idem_id):
            session.add(
                IdempotencyRecord(
                    id=idem_id,
                    profile_id=detector.id,
                    scope="reports.create",
                    idempotency_key=f"acceptance-demo-{status}",
                    request_hash=_digest(f"idempotency:{status}"),
                    response_status=202,
                    response_json={"report_id": str(report_id), "status": status},
                    created_at=now - timedelta(hours=index + 1),
                    expires_at=now + timedelta(days=7),
                )
            )

    # Second pass: verification jobs + validation decisions.
    verification_statuses = {
        "processing": "pending",
        "screened": "completed",
        "merged": "completed",
        "needs_rescan": "completed",
        "rejected": "completed",
        "validation_unavailable": "unavailable",
    }
    for status, job_status in verification_statuses.items():
        job_id = _ac_uuid(f"verification-job:{status}")
        if session.get(VerificationJob, job_id):
            continue
        session.add(
            VerificationJob(
                id=job_id,
                report_id=report_ids[status],
                status=job_status,
                attempts=1 if job_status != "pending" else 0,
                available_at=now - timedelta(hours=1),
                locked_at=now - timedelta(minutes=30) if job_status == "running" else None,
                last_error_code="upstream_provider_unavailable"
                if status == "validation_unavailable"
                else None,
                created_at=now - timedelta(hours=1),
                updated_at=now - timedelta(minutes=15),
            )
        )

    # Sightings covering every status.
    sighting_specs = (
        # (key, status, species, source_profile, place_label, recommended_action)
        (
            "candidate",
            "candidate",
            "leucaena-leucocephala",
            volunteer,
            "Bukit Nanas Forest Reserve · Ridge path",
            "Waiting on volunteer review before publication.",
        ),
        (
            "screened",
            "screened",
            "mikania-micrantha",
            detector,
            "Bukit Kiara · Look-out",
            "Cut at ground level, bag all fragments, return in 2-3 weeks to check regrowth.",
        ),
        (
            "rejected",
            "rejected",
            "chromolaena-odorata",
            volunteer,
            "Bukit Gasing · North gate",
            "Rejected: photo does not match the reported species.",
        ),
        (
            "removed",
            "removed",
            "mikania-micrantha",
            detector,
            "Bukit Kiara · West Trail",
            "Removed by adopted-area steward. Recheck for regrowth in 2-3 weeks.",
        ),
    )
    sighting_ids: dict[str, uuid.UUID] = {}
    for index, (key, sighting_status, species_id, owner, place_label, action) in enumerate(sighting_specs):
        sighting_id = _ac_uuid(f"sighting:{key}")
        sighting_ids[key] = sighting_id
        if session.get(Sighting, sighting_id):
            continue
        s_lat, s_lng = _REPORT_COORDS.get(place_label, (3.1497, 101.6412))
        session.add(
            Sighting(
                id=sighting_id,
                species_id=species_id,
                source_profile_id=owner.id,
                status=sighting_status,
                risk="high",
                latitude=Decimal(str(round(s_lat, 5))),
                longitude=Decimal(str(round(s_lng, 5))),
                reporter_trust=owner.trust_level,
                recommended_action=action,
                place_label=place_label,
                created_at=now - timedelta(days=index + 1),
                updated_at=now - timedelta(hours=index + 1),
            )
        )
    session.flush()

    # Report-sighting active link for the screened report.
    link_id = _ac_uuid("report-sighting-link:screened")
    if not session.get(ReportSightingLink, link_id):
        session.add(
            ReportSightingLink(
                id=link_id,
                report_id=report_ids["screened"],
                sighting_id=sighting_ids["screened"],
                active=True,
                linked_at=now - timedelta(hours=1),
            )
        )

    # Merged report points at the retained report + the merged sighting target.
    merged_report = session.get(Report, report_ids["merged"])
    if merged_report and merged_report.merged_into_report_id is None:
        merged_report.merged_into_report_id = report_ids["screened"]

    # AutomatedValidationDecisions per non-processing report.
    decisions = (
        ("screened", "accept", "processing", "screened", [], None),
        (
            "merged",
            "merge",
            "processing",
            "merged",
            ["duplicate_near_recent"],
            sighting_ids["screened"],
        ),
        (
            "needs_rescan",
            "needs_rescan",
            "processing",
            "needs_rescan",
            ["duplicate_capture"],
            None,
        ),
        (
            "rejected",
            "reject",
            "processing",
            "rejected",
            ["geo_out_of_scope"],
            None,
        ),
        (
            "validation_unavailable",
            "unavailable",
            "processing",
            "validation_unavailable",
            ["upstream_provider_unavailable"],
            None,
        ),
    )
    for status, decision, previous, resulting, reasons, merge_target in decisions:
        row_id = _ac_uuid(f"validation-decision:{status}")
        if session.get(AutomatedValidationDecision, row_id):
            continue
        session.add(
            AutomatedValidationDecision(
                id=row_id,
                report_id=report_ids[status],
                decision=decision,
                previous_state=previous,
                resulting_state=resulting,
                policy_version=_POLICY_VERSION,
                reason_codes=reasons,
                checks_json={"seed": "acceptance-demo", "notes": f"decision for {status}"},
                merge_target_id=merge_target,
                created_at=now - timedelta(hours=1),
            )
        )

    # Removal event: uses the screened report as the removal report_id (any
    # non-processing report row works) and lands on the removed sighting.
    removal_id = _ac_uuid("sighting-status-event:removed")
    if not session.get(SightingStatusEvent, removal_id):
        session.add(
            SightingStatusEvent(
                id=removal_id,
                sighting_id=sighting_ids["removed"],
                report_id=report_ids["screened"],
                acting_profile_id=detector.id,
                event_type="removal_reported",
                latitude=Decimal("3.14990"),
                longitude=Decimal("101.64150"),
                accuracy_m=Decimal("8.500"),
                distance_m=Decimal("12.00"),
                created_at=now - timedelta(hours=2),
            )
        )

    return sighting_ids


def _seed_place_sighting_evidence(
    session: Session,
    sighting_ids: dict[str, uuid.UUID],
    monitored_area: MonitoredArea,
    trail: Trail,
) -> None:
    specs = (
        (
            "inside_boundary",
            sighting_ids["screened"],
            "mikania-micrantha",
            "park",
            monitored_area.id,
        ),
        (
            "nearby_buffer",
            sighting_ids["candidate"],
            "leucaena-leucocephala",
            "park",
            monitored_area.id,
        ),
        (
            "upstream_waterway",
            sighting_ids["removed"],
            "mikania-micrantha",
            "trail",
            trail.id,
        ),
    )
    for relation_type, sighting_id, species_id, place_type, place_id in specs:
        row_id = _ac_uuid(f"place-sighting-evidence:{relation_type}")
        if session.get(PlaceSightingEvidence, row_id):
            continue
        session.add(
            PlaceSightingEvidence(
                id=row_id,
                place_type=place_type,
                place_id=place_id,
                sighting_id=sighting_id,
                species_id=species_id,
                relation_type=relation_type,
                straight_line_distance_m=Decimal("18.50")
                if relation_type != "upstream_waterway"
                else None,
                upstream_distance_m=Decimal("380.00")
                if relation_type == "upstream_waterway"
                else None,
                occurrence_snap_distance_m=Decimal("6.75"),
                place_snap_distance_m=Decimal("4.20"),
                waterway_dataset_id=_ac_uuid("waterway-dataset")
                if relation_type == "upstream_waterway"
                else None,
                geometry_version=_GEOMETRY_VERSION,
                calculation_version=_DATA_VERSION,
            )
        )


def _seed_notifications(session: Session, detector: Profile) -> None:
    for index, (kind, title, body) in enumerate(NOTIFICATION_KINDS):
        row_id = _ac_uuid(f"notification:{kind}")
        if session.get(Notification, row_id):
            continue
        session.add(
            Notification(
                id=row_id,
                profile_id=detector.id,
                kind=kind,
                title=title,
                body=body,
                link_to="/inbox",
                created_at=_NOW - timedelta(hours=index + 1),
                read_at=_NOW - timedelta(minutes=15) if index % 2 else None,
            )
        )


def _seed_osm_import(session: Session) -> None:
    row_id = _ac_uuid("osm-import")
    if session.get(OsmImport, row_id):
        return
    session.add(
        OsmImport(
            id=row_id,
            source_name="OpenStreetMap Malaysia (Geofabrik)",
            source_date=_NOW - timedelta(days=30),
            sha256=_digest("osm-import"),
            area_count=18,
            trail_count=5,
            metadata_json={
                "licence": "ODbL",
                "extract": "malaysia-singapore-brunei-latest.osm.pbf",
                "region": "Kuala Lumpur and Selangor",
            },
            created_at=_NOW - timedelta(days=30),
        )
    )


def _seed_extra_area_and_trail(session: Session) -> tuple[MonitoredArea, Trail]:
    """Featured places seed covers the common area/trail names. Pick two that
    :func:`seed_featured_places` inserted for us so the demo fixtures always
    have a stable place to attach evidence to.
    """
    area_name = "Bukit Kiara Federal Park"
    trail_name = "Bukit Kiara Mountain Bike Trail"
    area = session.scalar(select(MonitoredArea).where(MonitoredArea.name == area_name))
    trail = session.scalar(select(Trail).where(Trail.name == trail_name))
    if area is None or trail is None:
        raise RuntimeError(
            "Featured places must be seeded before load_acceptance_demo_fixtures "
            f"(missing {area_name!r} or {trail_name!r})."
        )
    return area, trail


def load_acceptance_demo_fixtures(session: Session) -> None:
    """Populate demo rows covering every acceptance-criteria row.

    Order matters: featured places, protected areas and waterway dataset first
    (referenced by everything else), then profiles, then reports/sightings/
    evidence/notifications. Each helper is individually idempotent.
    """
    load_development_fixtures(session)
    seed_featured_places(session)
    _seed_protected_area(session)
    _seed_waterway(session)

    profiles = {
        public_id: _upsert_profile(
            session, public_id, display_name, role, trust, resolved, valid, failures
        )
        for public_id, display_name, role, trust, resolved, valid, failures in PROFILES
    }
    for profile in profiles.values():
        _seed_installations(session, profile)
    _seed_recovery_codes(session, profiles["siti-nurhaliza"])
    session.flush()

    area, trail = _seed_extra_area_and_trail(session)
    _seed_adopted_areas(session, profiles["hafiz-rahman"], area, trail)

    occurrence_ids = _seed_occurrences(session)
    session.flush()
    _seed_place_occurrence_evidence(session, area.id, occurrence_ids)

    sighting_ids = _seed_reports_and_sightings(
        session,
        detector=profiles["nurul-aisyah"],
        volunteer=profiles["hafiz-rahman"],
    )
    _seed_place_sighting_evidence(session, sighting_ids, area, trail)
    _seed_notifications(session, profiles["nurul-aisyah"])
    _seed_osm_import(session)

    fallback_name = "Bukit Kiara · Ridge Marker"
    if not session.scalar(
        select(MonitoredPlace.id).where(MonitoredPlace.name == fallback_name)
    ):
        session.add(
            MonitoredPlace(
                name=fallback_name,
                latitude=Decimal("3.14970"),
                longitude=Decimal("101.64120"),
            )
        )

    session.commit()
