from __future__ import annotations

import hashlib
import io
import time
import uuid
import warnings
from datetime import UTC, datetime, timedelta

import structlog
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, or_, select

from app.config import get_settings
from app.db.base import SessionLocal
from app.db.models import (
    AuditEvent,
    AutomatedValidationDecision,
    Notification,
    Profile,
    Report,
    ReportSightingLink,
    Sighting,
    Species,
    VerificationJob,
)
from app.domain.action_guidance import action_summary
from app.domain.evidence_screening import (
    ImageScreeningResult,
    perceptual_distance,
    screen_image,
)
from app.domain.place_association import associate_place
from app.domain.validation import POLICY_VERSION, ValidationDecision, ValidationInput, evaluate
from app.services.storage import storage

log = structlog.get_logger("invatrace.screening_worker")


def _mark_report_unavailable(
    session,
    report: Report,
    reason: str,
    notification_body: str,
) -> None:
    first_unavailable = report.status != "validation_unavailable"
    report.status = "validation_unavailable"
    report.validation_reasons = [reason]
    report.validation_policy_version = POLICY_VERSION
    if first_unavailable:
        session.add(
            Notification(
                profile_id=report.profile_id,
                kind="validation_unavailable",
                title="Automated screening temporarily unavailable",
                body=notification_body,
                link_to=f"/reports/{report.id}",
            )
        )


def claim_job() -> str | None:
    with SessionLocal() as session:
        settings = get_settings()
        now = datetime.now(UTC)
        stale_before = now - timedelta(seconds=settings.worker_job_lease_seconds)
        terminal_jobs = session.scalars(
            select(VerificationJob)
            .where(
                VerificationJob.status == "running",
                VerificationJob.locked_at < stale_before,
                VerificationJob.attempts >= settings.worker_max_attempts,
            )
            .with_for_update(skip_locked=True)
        ).all()
        for terminal_job in terminal_jobs:
            terminal_job.status = "failed"
            terminal_job.last_error_code = "worker_lease_expired"
            report = session.get(Report, terminal_job.report_id)
            if report and report.status in {"processing", "validation_unavailable"}:
                _mark_report_unavailable(
                    session,
                    report,
                    "worker_lease_expired",
                    "Your report remains private because automated screening could not finish.",
                )
        job = session.scalar(
            select(VerificationJob)
            .where(
                VerificationJob.attempts < settings.worker_max_attempts,
                or_(
                    (
                        VerificationJob.status.in_(["pending", "retry", "unavailable"])
                        & (VerificationJob.available_at <= now)
                    ),
                    (
                        (VerificationJob.status == "running")
                        & (VerificationJob.locked_at < stale_before)
                    ),
                ),
            )
            .order_by(VerificationJob.available_at, VerificationJob.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not job:
            session.commit()
            return None
        job.status = "running"
        job.attempts += 1
        job.locked_at = now
        session.commit()
        return str(job.id)


def _advisory_key(label: str) -> int:
    digest = hashlib.blake2b(label.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def _lock_screening_units(session, *labels: str) -> None:
    for key in sorted({_advisory_key(label) for label in labels if label}):
        session.execute(select(func.pg_advisory_xact_lock(key)))


def process_job(job_id: str) -> None:
    settings = get_settings()
    started = time.perf_counter()
    content_sha256: bytes | None = None
    with SessionLocal() as session:
        job = session.get(VerificationJob, uuid.UUID(job_id))
        if not job or job.status != "running":
            return
        report = session.get(Report, job.report_id)
        if not report:
            job.status = "failed"
            job.last_error_code = "report_missing"
            session.commit()
            return
        try:
            image = storage.get_bytes(report.photo_key)
            content_sha256 = hashlib.sha256(image).digest()
            lock_labels = [
                f"content:{content_sha256.hex()}",
                f"capture:{report.capture_id}",
            ]
            if report.species_id:
                lock_labels.append(f"species:{report.species_id}")
            _lock_screening_units(session, *lock_labels)

            exact_replay = _is_exact_replay(
                session,
                report=report,
                content_sha256=content_sha256,
            )
            screening: ImageScreeningResult | None = None
            perceptual_match_id: str | None = None
            perceptual_match_distance: int | None = None
            if not exact_replay:
                screening = screen_image(
                    image,
                    minimum_dimension=settings.screening_minimum_image_dimension,
                )
                if not screening.failure_reasons and report.species_id:
                    # Serialize the bounded perceptual comparison so concurrent
                    # submissions cannot both pass before either fingerprint is
                    # committed. The comparison is intentionally cross-species:
                    # relabelling the same photo must not evade replay checks.
                    _lock_screening_units(session, "perceptual-screening")
                    perceptual_match_id, perceptual_match_distance = _find_perceptual_replay(
                        session,
                        report=report,
                        serialized_hashes=screening.serialized_hashes,
                        threshold=settings.screening_perceptual_hamming_threshold,
                    )

            species = session.get(Species, report.species_id) if report.species_id else None
            if species is not None and not species.reportable:
                species = None
            reportable_species_id = species.id if species is not None else None
            client_model_supported = report.client_model_version in settings.e1_model_versions
            base_decision = evaluate(
                ValidationInput(
                    image_failure_reasons=(
                        screening.failure_reasons if screening is not None else ()
                    ),
                    client_outcome=report.outcome,
                    client_species_id=reportable_species_id,
                    client_model_supported=client_model_supported,
                    location_accuracy_m=report.location_accuracy_m,
                    exact_replay=exact_replay,
                    perceptual_replay=perceptual_match_id is not None,
                )
            )

            merge_target = None
            merge_distance_m = None
            if base_decision.status == "screened" and reportable_species_id:
                merge_target, merge_distance_m = _find_merge_target(
                    session,
                    report=report,
                    species_id=reportable_species_id,
                )
            decision = (
                evaluate(
                    ValidationInput(
                        image_failure_reasons=(),
                        client_outcome=report.outcome,
                        client_species_id=reportable_species_id,
                        client_model_supported=client_model_supported,
                        location_accuracy_m=report.location_accuracy_m,
                        merge_target_id=str(merge_target.id) if merge_target else None,
                    )
                )
                if merge_target
                else base_decision
            )

            previous_state = report.status
            report.content_sha256 = content_sha256
            report.perceptual_hash = screening.serialized_hashes if screening else None
            report.status = decision.status
            report.validation_reasons = list(decision.reason_codes)
            report.validation_policy_version = POLICY_VERSION

            thumbnail_bytes = _make_thumbnail(image) if decision.status == "screened" else None
            published_sighting = _publish_decision(
                session,
                report=report,
                species=species,
                decision_status=decision.status,
                merge_target=merge_target,
                thumbnail_bytes=thumbnail_bytes,
            )
            checks = _checks_json(
                report=report,
                screening=screening,
                exact_replay=exact_replay,
                perceptual_match_id=perceptual_match_id,
                perceptual_match_distance=perceptual_match_distance,
                client_model_supported=client_model_supported,
                merge_distance_m=merge_distance_m,
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            _record_decision(
                session,
                report=report,
                decision=decision,
                previous_state=previous_state,
                checks=checks,
                merge_target=merge_target,
                published_sighting=published_sighting,
            )
            _notify_resolution(session, report)
            _update_trust(session, report, published_sighting)
            job.status = "completed"
            job.last_error_code = None
        except (
            UnidentifiedImageError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            OSError,
        ):
            previous_state = report.status
            decision = ValidationDecision("needs_rescan", ("invalid_or_corrupt_image",), True)
            report.status = decision.status
            report.validation_reasons = list(decision.reason_codes)
            report.validation_policy_version = POLICY_VERSION
            report.content_sha256 = content_sha256
            _record_decision(
                session,
                report=report,
                decision=decision,
                previous_state=previous_state,
                checks={
                    "imageDecodable": False,
                    "durationMs": round((time.perf_counter() - started) * 1000),
                },
                merge_target=None,
                published_sighting=None,
            )
            _notify_resolution(session, report)
            _update_trust(session, report, None)
            job.status = "completed"
            job.last_error_code = "invalid_or_corrupt_image"
        except Exception as error:
            log.exception(
                "screening.failed",
                job_id=str(job.id),
                report_id=str(job.report_id),
                error_type=type(error).__name__,
            )
            _schedule_failure(session, job, report, "screening_failed")
        session.commit()


def _is_exact_replay(session, *, report: Report, content_sha256: bytes) -> bool:
    return (
        session.scalar(
            select(Report.id)
            .where(
                Report.id != report.id,
                or_(
                    Report.content_sha256 == content_sha256,
                    Report.capture_id == report.capture_id,
                ),
            )
            .limit(1)
        )
        is not None
    )


def _find_perceptual_replay(
    session,
    *,
    report: Report,
    serialized_hashes: str,
    threshold: int,
) -> tuple[str | None, int | None]:
    candidates = session.scalars(
        select(Report)
        .where(
            Report.id != report.id,
            Report.status.in_(["screened", "merged"]),
            Report.perceptual_hash.is_not(None),
            Report.observed_at >= report.observed_at - timedelta(days=30),
        )
        .order_by(Report.observed_at.desc())
        .limit(500)
    ).all()
    best_id = None
    best_distance = None
    for candidate in candidates:
        distance = perceptual_distance(serialized_hashes, candidate.perceptual_hash or "")
        if distance is None or (best_distance is not None and distance >= best_distance):
            continue
        best_id = str(candidate.id)
        best_distance = distance
    if best_distance is not None and best_distance <= threshold:
        return best_id, best_distance
    return None, best_distance


def _make_thumbnail(image: bytes) -> bytes:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(image)) as source:
            source.load()
            oriented = ImageOps.exif_transpose(source).convert("RGB")
            oriented.thumbnail((640, 640), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            oriented.save(output, format="JPEG", quality=82, optimize=True)
            return output.getvalue()


def _find_merge_target(
    session,
    *,
    report: Report,
    species_id: str,
) -> tuple[Sighting | None, float | None]:
    settings = get_settings()
    radius_m = min(
        settings.screening_duplicate_radius_max_m,
        max(15, report.location_accuracy_m or 25),
    )
    observed_after = report.observed_at - timedelta(hours=settings.screening_duplicate_window_hours)
    observed_before = report.observed_at + timedelta(
        hours=settings.screening_duplicate_window_hours
    )
    candidate = session.scalar(
        select(Sighting)
        .where(
            Sighting.species_id == species_id,
            Sighting.status == "screened",
            func.ST_DWithin(Sighting.location, report.location, radius_m),
            select(ReportSightingLink.id)
            .join(Report, Report.id == ReportSightingLink.report_id)
            .where(
                ReportSightingLink.sighting_id == Sighting.id,
                ReportSightingLink.active.is_(True),
                Report.id != report.id,
                Report.species_id == species_id,
                Report.status.in_(["screened", "merged"]),
                Report.observed_at.between(observed_after, observed_before),
            )
            .exists(),
        )
        .order_by(func.ST_Distance(Sighting.location, report.location))
        .limit(1)
    )
    if candidate is None:
        return None, None
    distance = session.scalar(select(func.ST_Distance(candidate.location, report.location)))
    return candidate, round(float(distance), 3) if distance is not None else None


def _publish_decision(
    session,
    *,
    report: Report,
    species: Species | None,
    decision_status: str,
    merge_target: Sighting | None,
    thumbnail_bytes: bytes | None,
) -> Sighting | None:
    if decision_status == "merged" and merge_target:
        session.add(
            ReportSightingLink(report_id=report.id, sighting_id=merge_target.id, active=True)
        )
        merge_target.updated_at = datetime.now(UTC)
        return merge_target
    if decision_status != "screened" or species is None or thumbnail_bytes is None:
        return None
    place = associate_place(
        session,
        latitude=float(report.latitude),
        longitude=float(report.longitude),
        accuracy_m=report.location_accuracy_m,
    )
    sighting = Sighting(
        species_id=species.id,
        source_profile_id=report.profile_id,
        status="screened",
        risk=species.risk or "watch",
        latitude=report.latitude,
        longitude=report.longitude,
        reporter_trust=report.submitter_trust,
        recommended_action=action_summary(species, observed_at=report.observed_at),
        area_id=place.area_id,
        trail_id=place.trail_id,
        place_label=place.display_name,
    )
    session.add(sighting)
    session.flush()
    sighting.thumbnail_key = f"thumbnails/{sighting.id}.jpg"
    storage.put_bytes(sighting.thumbnail_key, thumbnail_bytes, "image/jpeg")
    session.add(ReportSightingLink(report_id=report.id, sighting_id=sighting.id, active=True))
    return sighting


def _checks_json(
    *,
    report: Report,
    screening: ImageScreeningResult | None,
    exact_replay: bool,
    perceptual_match_id: str | None,
    perceptual_match_distance: int | None,
    client_model_supported: bool,
    merge_distance_m: float | None,
    duration_ms: int,
) -> dict[str, object]:
    return {
        "screeningMethod": "deterministic_rules",
        "exactReplay": exact_replay,
        "perceptualReplayReportId": perceptual_match_id,
        "perceptualHashDistance": perceptual_match_distance,
        "clientModelVersion": report.client_model_version,
        "clientModelSupported": client_model_supported,
        "clientConfidence": float(report.confidence),
        "locationAccuracyM": report.location_accuracy_m,
        "sameSpeciesMergeDistanceM": merge_distance_m,
        "image": (
            {
                "width": screening.width,
                "height": screening.height,
                "brightnessMean": screening.brightness_mean,
                "contrastStddev": screening.contrast_stddev,
                "edgeVariance": screening.edge_variance,
                "failureReasons": list(screening.failure_reasons),
            }
            if screening
            else None
        ),
        "durationMs": duration_ms,
    }


def _record_decision(
    session,
    *,
    report: Report,
    decision: ValidationDecision,
    previous_state: str,
    checks: dict[str, object],
    merge_target: Sighting | None,
    published_sighting: Sighting | None,
) -> None:
    session.add(
        AutomatedValidationDecision(
            report_id=report.id,
            decision=decision.status,
            previous_state=previous_state,
            resulting_state=decision.status,
            policy_version=POLICY_VERSION,
            reason_codes=list(decision.reason_codes),
            checks_json=checks,
            merge_target_id=merge_target.id if merge_target else None,
        )
    )
    session.add(
        AuditEvent(
            event_type="report.automated_screening_completed",
            subject_type="report",
            subject_id=str(report.id),
            metadata_json={
                "status": decision.status,
                "reasonCodes": list(decision.reason_codes),
                "sightingId": str(published_sighting.id) if published_sighting else None,
                "policyVersion": POLICY_VERSION,
                "screeningMethod": "deterministic_rules",
            },
        )
    )


def _notify_resolution(session, report: Report) -> None:
    copy = {
        "screened": (
            "Report rule-screened",
            "Automated rules passed. The observation is now on the shared map.",
        ),
        "merged": (
            "Report matched a recent nearby plant",
            "Your evidence was added to an existing same-species map sighting.",
        ),
        "needs_rescan": (
            "A new scan is needed",
            "Automated rules could not accept this evidence. Retake it with the in-app camera.",
        ),
        "rejected": (
            "Duplicate evidence rejected",
            "Automated duplicate checks rejected this evidence.",
        ),
    }[report.status]
    kind = {
        "screened": "report_screened",
        "merged": "report_merged",
        "needs_rescan": "report_needs_rescan",
        "rejected": "report_rejected",
    }[report.status]
    session.add(
        Notification(
            profile_id=report.profile_id,
            kind=kind,
            title=copy[0],
            body=copy[1],
            link_to=f"/reports/{report.id}",
        )
    )


def _update_trust(session, report: Report, sighting: Sighting | None) -> None:
    profile = session.get(Profile, report.profile_id)
    if not profile:
        return
    if report.status == "merged" and sighting is not None:
        recent_credit = session.scalar(
            select(Report.id)
            .join(ReportSightingLink, ReportSightingLink.report_id == Report.id)
            .where(
                Report.id != report.id,
                Report.profile_id == report.profile_id,
                Report.status.in_(["screened", "merged"]),
                Report.observed_at >= report.observed_at - timedelta(days=30),
                ReportSightingLink.sighting_id == sighting.id,
                ReportSightingLink.active.is_(True),
            )
            .limit(1)
        )
        if recent_credit:
            return
    profile.resolved_reports += 1
    if report.status in {"screened", "merged"}:
        profile.valid_reports += 1
    if report.status == "rejected":
        profile.hard_failures += 1
    validity = profile.valid_reports / profile.resolved_reports
    if profile.resolved_reports >= 20 and validity >= 0.95 and profile.hard_failures == 0:
        profile.trust_level = "Steward"
    elif profile.resolved_reports >= 5 and validity >= 0.85:
        profile.trust_level = "Trusted"


def _schedule_failure(session, job: VerificationJob, report: Report, code: str) -> None:
    settings = get_settings()
    job.last_error_code = code
    if job.attempts >= settings.worker_max_attempts:
        job.status = "failed"
        _mark_report_unavailable(
            session,
            report,
            code,
            "Your report remains private because automated screening could not finish.",
        )
        return
    job.status = "retry"
    job.available_at = datetime.now(UTC) + timedelta(seconds=min(300, 2**job.attempts))


def run_worker(*, once: bool = False) -> None:
    settings = get_settings()
    while True:
        job_id = claim_job()
        if job_id:
            process_job(job_id)
            if once:
                return
        elif once:
            return
        else:
            time.sleep(settings.worker_poll_seconds)
