"""Command-line entry point for InvaTrace's operational commands.

Everything you'd run by hand or from a cron/systemd unit lives behind
this one `invatrace` CLI: seeding dev data, running the screening
worker, running the upload-cleanup sweep, importing OSM places, and
granting a profile a role/trust level. There's no in-process
scheduler - each subcommand is its own process, restarted by whatever
process manager you use (see the "worker" and "cleanup-worker"
commands, which just loop forever until killed).
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import structlog
from sqlalchemy import select

from app.config import get_settings
from app.db.base import SessionLocal
from app.db.models import AuditEvent, Profile
from app.acceptance_demo_seed import load_acceptance_demo_fixtures
from app.seed import (
    load_development_fixtures,
    load_reference_data,
    seed_demo_data,
    seed_development_data,
)
from app.services.upload_cleanup import remove_expired_uploads, remove_pending_objects
from app.workers.verification import run_worker

ROLES = ["Detector", "Volunteer", "Expert", "Admin"]
TRUST_LEVELS = ["New", "Trusted", "Steward"]
log = structlog.get_logger("invatrace.cli")


def cleanup_uploads_once(limit: int) -> int:
    """One pass of the upload-cleanup sweep: expired staged uploads that were
    never submitted, plus anything queued for deletion (old evidence/thumbnail
    keys from deleted reports/sightings). Shared by both the `cleanup-uploads`
    one-shot command and the `cleanup-worker` loop below."""
    with SessionLocal() as session:
        expired = remove_expired_uploads(session, limit=limit)
        deleted = remove_pending_objects(session, limit=limit)
        return expired + deleted


def set_profile_access(profile_id: str, role: str, trust: str) -> None:
    """Admin-only escape hatch for granting a profile a role/trust level -
    there's no self-service way to become an Admin/Expert or jump trust
    tiers, on purpose. Locks the row and writes an AuditEvent so every
    privilege change is traceable after the fact."""
    with SessionLocal() as session:
        profile = session.scalar(
            select(Profile).where(Profile.public_id == profile_id).with_for_update()
        )
        if not profile:
            raise SystemExit(f"Profile {profile_id!r} was not found.")
        before = {"role": profile.role, "trustLevel": profile.trust_level}
        profile.role = role
        profile.trust_level = trust
        session.add(
            AuditEvent(
                event_type="profile.access_changed",
                subject_type="profile",
                subject_id=profile.public_id,
                metadata_json={"before": before, "after": {"role": role, "trustLevel": trust}},
            )
        )
        session.commit()
        print(f"Updated {profile.public_id} to {role}/{trust}.")


def main() -> None:
    """argparse wiring for the `invatrace` CLI - see the module docstring
    for what each subcommand does. Kept as one flat main() since there
    are only a handful of commands; not worth splitting into subcommand
    modules yet."""
    parser = argparse.ArgumentParser(prog="invatrace")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "seed", help="deprecated: run load-reference-data + seed-demo-data (development only)"
    )
    commands.add_parser(
        "load-reference-data",
        help="idempotently load the approved 32-species catalogue (prod-safe)",
    )
    commands.add_parser(
        "production-data-status",
        help="print machine-readable production geospatial data readiness",
    )
    commands.add_parser(
        "seed-demo-data",
        help="insert sample sightings for local development (never runs in production)",
    )
    commands.add_parser(
        "load-development-fixtures",
        help="insert demonstration places and sightings (never runs in production)",
    )
    commands.add_parser(
        "seed-acceptance-demo",
        help=(
            "insert an acceptance-criteria demo dataset (profiles, reports across "
            "every status, sightings, notifications, adopted areas, recovery codes, "
            "place-sighting evidence) - never runs in production"
        ),
    )
    worker = commands.add_parser("worker", help="run the deterministic report-screening worker")
    worker.add_argument("--once", action="store_true")
    access = commands.add_parser(
        "set-profile-access", help="set a server-authoritative role/trust pair"
    )
    access.add_argument("--profile-id", required=True)
    access.add_argument("--role", choices=ROLES, required=True)
    access.add_argument("--trust", choices=TRUST_LEVELS, required=True)
    osm = commands.add_parser(
        "import-osm", help="import Malaysian parks, forests, and trails from a regional OSM PBF"
    )
    osm.add_argument("path", type=Path)
    osm.add_argument("--source-date", type=datetime.fromisoformat, required=True)
    osm.add_argument(
        "--release-manifest",
        type=Path,
        required=True,
        help="auditable source, licence, timestamp and SHA-256 metadata for the PBF",
    )
    osm.add_argument(
        "--country-boundary",
        type=Path,
        required=True,
        help="reviewed Malaysia Polygon/MultiPolygon GeoJSON used for spatial filtering",
    )
    osm.add_argument(
        "--country-boundary-manifest",
        type=Path,
        required=True,
        help="auditable metadata and SHA-256 for the Malaysia boundary",
    )
    occurrences = commands.add_parser(
        "import-occurrences",
        help="validate and import versioned Malaysian historical occurrence JSON",
    )
    occurrences.add_argument("path", type=Path)
    occurrences.add_argument("--source", required=True)
    occurrences.add_argument("--processed-data-version", required=True)
    occurrences.add_argument(
        "--release-manifest",
        type=Path,
        required=True,
        help="auditable source query, retrieval date, licence policy and SHA-256 metadata",
    )
    occurrences.add_argument(
        "--country-boundary",
        type=Path,
        required=True,
        help="reviewed Malaysia Polygon/MultiPolygon GeoJSON used to reject coordinate mismatch",
    )
    occurrences.add_argument(
        "--country-boundary-manifest",
        type=Path,
        required=True,
        help="auditable release metadata and SHA-256 for the Malaysia boundary",
    )
    waterways = commands.add_parser(
        "import-waterway-evidence",
        help="import place-specific evidence from directed OSM waterway preprocessing",
    )
    waterways.add_argument("path", type=Path)
    waterways.add_argument("--data-version", required=True)
    waterways.add_argument("--release-manifest", type=Path, required=True)
    waterway_preprocess = commands.add_parser(
        "preprocess-osm-waterways",
        help="build a directed Malaysian OSM waterway graph and derived upstream evidence",
    )
    waterway_preprocess.add_argument("path", type=Path)
    waterway_preprocess.add_argument("--release-manifest", type=Path, required=True)
    waterway_preprocess.add_argument("--country-boundary", type=Path, required=True)
    waterway_preprocess.add_argument("--country-boundary-manifest", type=Path, required=True)
    waterway_preprocess.add_argument("--evidence-output", type=Path, required=True)
    protected_extract = commands.add_parser(
        "extract-osm-protected-areas",
        help="derive explicit Malaysia-only mapped protected areas from a fixed OSM PBF",
    )
    protected_extract.add_argument("path", type=Path)
    protected_extract.add_argument("--output", type=Path, required=True)
    protected_extract.add_argument("--release-manifest", type=Path, required=True)
    protected_extract.add_argument("--country-boundary", type=Path, required=True)
    protected_extract.add_argument("--country-boundary-manifest", type=Path, required=True)
    boundaries = commands.add_parser(
        "import-protected-areas",
        help="validate and activate a versioned protected-area GeoJSON release",
    )
    boundaries.add_argument("path", type=Path)
    boundaries.add_argument("--source", required=True)
    boundaries.add_argument("--version", required=True)
    boundaries.add_argument("--updated-at", type=datetime.fromisoformat, required=True)
    boundaries.add_argument("--coverage-note", required=True)
    boundaries.add_argument("--coverage-geojson", type=Path, required=True)
    boundaries.add_argument(
        "--release-manifest",
        type=Path,
        required=True,
        help="auditable source, licence, version, retrieval date and SHA-256 metadata",
    )
    boundaries.add_argument(
        "--coverage-release-manifest",
        type=Path,
        required=True,
        help="auditable source, licence, version, retrieval date and SHA-256 for coverage",
    )
    place_pack = commands.add_parser(
        "import-place-association-data",
        help=(
            "load the bundled Direction-Aware Place Association data pack "
            "(GBIF + iNaturalist Malaysian occurrences); idempotent"
        ),
    )
    place_pack.add_argument(
        "pack",
        type=Path,
        nargs="?",
        default=Path(__file__).resolve().parent.parent / "data" / "direction-aware-place-association-v1",
        help="path to the data pack directory (defaults to backend/data/direction-aware-place-association-v1)",
    )
    place_pack.add_argument(
        "--country-boundary",
        type=Path,
        required=True,
        help="reviewed Malaysia Polygon/MultiPolygon GeoJSON used to reject coordinate mismatch",
    )
    place_pack.add_argument(
        "--country-boundary-manifest",
        type=Path,
        required=True,
        help="auditable release metadata and SHA-256 for the Malaysia boundary",
    )

    commands.add_parser(
        "seed-featured-places",
        help=(
            "insert a curated set of real KL/Selangor parks, forests, "
            "woodlands and trails so the map is not empty before OSM PBF import; "
            "idempotent by name"
        ),
    )

    cleanup = commands.add_parser(
        "cleanup-uploads", help="delete expired, unsubmitted photo uploads"
    )
    cleanup.add_argument("--limit", type=int, default=500)
    cleanup_worker = commands.add_parser(
        "cleanup-worker", help="run expired-upload cleanup on a fixed interval"
    )
    cleanup_worker.add_argument("--limit", type=int, default=500)
    cleanup_worker.add_argument("--interval-seconds", type=int)
    args = parser.parse_args()
    if args.command == "seed":
        # Legacy dev entry point - rejects prod so a stray call cannot inject
        # demo sightings into a live database (AC Phase 5 deployment split).
        if get_settings().app_env == "production":
            raise SystemExit(
                "`invatrace seed` is development-only. "
                "Run `invatrace load-reference-data` in production instead."
            )
        with SessionLocal() as session:
            seed_development_data(session)
        print("Development data is ready.")
    elif args.command == "load-reference-data":
        with SessionLocal() as session:
            load_reference_data(session)
        print("Reference data loaded.")
    elif args.command == "production-data-status":
        from app.production_data import production_data_snapshot

        with SessionLocal() as session:
            snapshot = production_data_snapshot(session, include_versions=True)
        print(json.dumps(snapshot, ensure_ascii=False, sort_keys=True))
        if snapshot["status"] != "ok":
            raise SystemExit(1)
    elif args.command in {"seed-demo-data", "load-development-fixtures"}:
        if get_settings().app_env == "production":
            raise SystemExit(
                "Refusing to seed demo data in production. "
                "Use `invatrace load-reference-data` for prod reference rows."
            )
        with SessionLocal() as session:
            if args.command == "seed-demo-data":
                seed_demo_data(session)
            else:
                load_development_fixtures(session)
        print("Demo data seeded.")
    elif args.command == "seed-acceptance-demo":
        if get_settings().app_env == "production":
            raise SystemExit(
                "Refusing to seed acceptance-demo data in production. "
                "Use `invatrace load-reference-data` for prod reference rows."
            )
        with SessionLocal() as session:
            load_acceptance_demo_fixtures(session)
        print("Acceptance-criteria demo data seeded.")
    elif args.command == "worker":
        run_worker(once=args.once)
    elif args.command == "set-profile-access":
        set_profile_access(args.profile_id, args.role, args.trust)
    elif args.command == "import-osm":
        # Lazy import so the rest of the CLI (worker, seed, cleanup) does not
        # pull in the pyosmium native extension, which the API/worker images
        # do not need at runtime.
        from app.osm_import import import_malaysia_pbf

        with SessionLocal() as session:
            imported = import_malaysia_pbf(
                session,
                source_path=args.path.resolve(),
                source_date=args.source_date,
                release_manifest_path=args.release_manifest.resolve(),
                country_boundary_path=args.country_boundary.resolve(),
                country_boundary_manifest_path=args.country_boundary_manifest.resolve(),
            )
        print(
            f"Imported {imported.area_count} named areas and {imported.trail_count} named trails."
        )
    elif args.command == "import-occurrences":
        from app.occurrence_import import import_occurrence_json

        with SessionLocal() as session:
            result = import_occurrence_json(
                session,
                source_path=args.path.resolve(),
                source=args.source,
                processed_data_version=args.processed_data_version,
                country_boundary_path=args.country_boundary.resolve(),
                country_boundary_manifest_path=args.country_boundary_manifest.resolve(),
                release_manifest_path=args.release_manifest.resolve(),
            )
        print(
            f"Imported {result.accepted} records; excluded {result.excluded}. "
            f"Version: {result.processed_data_version}. Reasons: {result.exclusion_reasons}"
        )
    elif args.command == "import-protected-areas":
        from app.protected_area_import import import_protected_area_geojson

        with SessionLocal() as session:
            result = import_protected_area_geojson(
                session,
                source_path=args.path.resolve(),
                source=args.source,
                version=args.version,
                updated_at=args.updated_at,
                coverage_note=args.coverage_note,
                coverage_path=args.coverage_geojson.resolve(),
                release_manifest_path=args.release_manifest.resolve(),
                coverage_release_manifest_path=args.coverage_release_manifest.resolve(),
            )
        print(
            f"Protected-area release {result.source}/{result.version} is active with "
            f"{result.feature_count} features. Existing: {result.already_present}."
        )
    elif args.command == "import-waterway-evidence":
        from app.waterway_import import import_waterway_evidence_json

        with SessionLocal() as session:
            result = import_waterway_evidence_json(
                session,
                source_path=args.path.resolve(),
                data_version=args.data_version,
                release_manifest_path=args.release_manifest.resolve(),
            )
        print(
            f"Imported {result.accepted} waterway evidence rows; excluded {result.excluded}. "
            f"Version: {result.data_version}. Reasons: {result.exclusion_reasons}"
        )
    elif args.command == "import-place-association-data":
        # Convenience wrapper for the bundled Direction-Aware Place Association
        # data pack. Reads build_manifest.json for the processed-data version
        # and hands each per-source occurrence JSON to import_occurrence_json,
        # which is already idempotent by (source, source_occurrence_id). The
        # per-file `.release.json` sidecars carry the SHA-256 gate the
        # importer requires so a corrupted pack is refused before it reaches
        # the database.
        from app.occurrence_import import import_occurrence_json

        pack_root = args.pack.resolve()
        build_manifest_path = pack_root / "build_manifest.json"
        if not build_manifest_path.exists():
            raise SystemExit(f"missing build_manifest.json in {pack_root}")
        build_manifest = json.loads(build_manifest_path.read_text(encoding="utf-8"))
        processed_version = (
            f"direction-aware-place-association-v{build_manifest.get('schema_version', '1.0.0')}"
            f"-{build_manifest.get('generated_at_utc', 'unknown')}"
        )
        sources: list[tuple[str, str, str]] = [
            (
                "occurrences.gbif.json",
                "occurrences.gbif.json.release.json",
                "GBIF",
            ),
            (
                "occurrences.inaturalist.json",
                "occurrences.inaturalist.json.release.json",
                "iNaturalist",
            ),
        ]
        totals = {"accepted": 0, "excluded": 0}
        aggregated_reasons: dict[str, int] = {}
        for data_name, release_name, source_label in sources:
            data_path = pack_root / data_name
            release_path = pack_root / release_name
            if not data_path.exists() or not release_path.exists():
                print(f"skipping {data_name}: file not found in pack")
                continue
            with SessionLocal() as session:
                # import_occurrence_json's release_manifest gate is GBIF-only.
                # For iNaturalist we still validate the sidecar SHA-256 manually
                # so a corrupted pack is refused, but do not hand the manifest
                # to the importer or it will reject the non-GBIF dataset_id.
                if source_label.casefold() == "gbif":
                    forwarded_release = release_path
                else:
                    from app.data_release import validate_data_release as _vdr
                    _vdr(release_path, data_path)
                    forwarded_release = None
                result = import_occurrence_json(
                    session,
                    source_path=data_path,
                    source=source_label,
                    processed_data_version=processed_version,
                    country_boundary_path=args.country_boundary.resolve(),
                    country_boundary_manifest_path=args.country_boundary_manifest.resolve(),
                    release_manifest_path=forwarded_release,
                )
            totals["accepted"] += result.accepted
            totals["excluded"] += result.excluded
            for key, value in result.exclusion_reasons.items():
                aggregated_reasons[key] = aggregated_reasons.get(key, 0) + value
            print(
                f"{source_label}: accepted {result.accepted}, excluded {result.excluded}, "
                f"version={result.processed_data_version}"
            )
        print(
            f"Total accepted {totals['accepted']}, excluded {totals['excluded']}. "
            f"Reasons: {aggregated_reasons}"
        )
    elif args.command == "seed-featured-places":
        from app.featured_places_seed import seed_featured_places

        with SessionLocal() as session:
            areas_added, trails_added = seed_featured_places(session)
        print(
            f"Featured places seeded: {areas_added} new area(s), {trails_added} new trail(s)."
        )
    elif args.command == "preprocess-osm-waterways":
        from app.osm_waterway_graph import preprocess_osm_waterways

        with SessionLocal() as session:
            result = preprocess_osm_waterways(
                session,
                source_path=args.path.resolve(),
                release_manifest_path=args.release_manifest.resolve(),
                country_boundary_path=args.country_boundary.resolve(),
                country_boundary_manifest_path=args.country_boundary_manifest.resolve(),
                evidence_output_path=args.evidence_output.resolve(),
            )
        print(
            f"Waterway dataset {result.data_version} has "
            f"{result.graph_qa.directed_edges} directed edges; imported "
            f"{result.evidence_accepted} upstream evidence rows and excluded "
            f"{result.evidence_excluded}. Existing: {result.already_present}."
        )
    elif args.command == "extract-osm-protected-areas":
        from app.osm_protected_area import extract_osm_protected_areas

        result = extract_osm_protected_areas(
            source_path=args.path.resolve(),
            output_path=args.output.resolve(),
            release_manifest_path=args.release_manifest.resolve(),
            country_boundary_path=args.country_boundary.resolve(),
            country_boundary_manifest_path=args.country_boundary_manifest.resolve(),
        )
        print(
            f"Extracted {result.accepted} mapped protected areas "
            f"({result.named} named, {result.unnamed} unnamed); excluded "
            f"{result.excluded}. Reasons: {result.exclusion_reasons}"
        )
    elif args.command in {"cleanup-uploads", "cleanup-worker"}:
        if args.limit < 1 or args.limit > 10_000:
            raise SystemExit("--limit must be between 1 and 10000.")
        if args.command == "cleanup-uploads":
            removed = cleanup_uploads_once(args.limit)
            print(f"Removed {removed} expired uploads.")
            return
        interval = args.interval_seconds or get_settings().upload_cleanup_interval_seconds
        if interval < 60 or interval > 86_400:
            raise SystemExit("--interval-seconds must be between 60 and 86400.")
        while True:
            delay = interval
            try:
                removed = cleanup_uploads_once(args.limit)
                log.info("expired_upload_cleanup_completed", removed=removed)
            except Exception:
                # Don't let one bad pass kill the loop - log it and retry sooner
                # than the normal interval so a transient storage/DB blip doesn't
                # leave expired uploads sitting around for a full hour.
                log.exception("expired_upload_cleanup_failed")
                delay = min(60, interval)
            time.sleep(delay)


if __name__ == "__main__":
    main()
