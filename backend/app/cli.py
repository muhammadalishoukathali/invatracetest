from __future__ import annotations

import argparse
import time
from datetime import datetime
from pathlib import Path

import structlog
from sqlalchemy import select

from app.config import get_settings
from app.db.base import SessionLocal
from app.db.models import AuditEvent, Profile
from app.osm_import import import_malaysia_pbf
from app.seed import seed_development_data
from app.services.upload_cleanup import remove_expired_uploads, remove_pending_objects
from app.workers.verification import run_worker

ROLES = ["Detector", "Volunteer", "Expert", "Admin"]
TRUST_LEVELS = ["New", "Trusted", "Steward"]
log = structlog.get_logger("invatrace.cli")


def cleanup_uploads_once(limit: int) -> int:
    with SessionLocal() as session:
        expired = remove_expired_uploads(session, limit=limit)
        deleted = remove_pending_objects(session, limit=limit)
        return expired + deleted


def set_profile_access(profile_id: str, role: str, trust: str) -> None:
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
    parser = argparse.ArgumentParser(prog="invatrace")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("seed", help="seed factual development species and public map data")
    worker = commands.add_parser("worker", help="run the deterministic report-screening worker")
    worker.add_argument("--once", action="store_true")
    access = commands.add_parser(
        "set-profile-access", help="set a server-authoritative role/trust pair"
    )
    access.add_argument("--profile-id", required=True)
    access.add_argument("--role", choices=ROLES, required=True)
    access.add_argument("--trust", choices=TRUST_LEVELS, required=True)
    osm = commands.add_parser(
        "import-osm", help="import named parks, forests, and trails from a Malaysia-clipped PBF"
    )
    osm.add_argument("path", type=Path)
    osm.add_argument("--source-date", type=datetime.fromisoformat, required=True)
    osm.add_argument(
        "--confirm-malaysia-clipped",
        action="store_true",
        help="required guard: confirm the extract is already clipped to Malaysia",
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
        with SessionLocal() as session:
            seed_development_data(session)
        print("Development data is ready.")
    elif args.command == "worker":
        run_worker(once=args.once)
    elif args.command == "set-profile-access":
        set_profile_access(args.profile_id, args.role, args.trust)
    elif args.command == "import-osm":
        if not args.confirm_malaysia_clipped:
            raise SystemExit("Refusing import without --confirm-malaysia-clipped.")
        with SessionLocal() as session:
            imported = import_malaysia_pbf(
                session, source_path=args.path.resolve(), source_date=args.source_date
            )
        print(
            f"Imported {imported.area_count} named areas and {imported.trail_count} named trails."
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
                log.exception("expired_upload_cleanup_failed")
                delay = min(60, interval)
            time.sleep(delay)


if __name__ == "__main__":
    main()
