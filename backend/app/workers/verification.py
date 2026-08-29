from __future__ import annotations

import hashlib
import io
import math
import multiprocessing
import queue
import time
import uuid
import warnings
from datetime import UTC, datetime, timedelta

import structlog
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.db.base import SessionLocal
from app.db.models import (
    AuditEvent,
    AutomatedValidationDecision,
    InferenceRecord,
    ModelVersion,
    Notification,
    Profile,
    Report,
    ReportSightingLink,
    Sighting,
    Species,
    VerificationJob,
)
from app.domain.action_guidance import action_summary
from app.domain.place_association import associate_place
from app.domain.validation import POLICY_VERSION, ValidationInput, evaluate
from app.ml.plant import get_plant_provider
from app.ml.plant.provider import (
    InvalidModelOutputError,
    ModelUnavailableError,
    validate_model_output,
)
from app.services.storage import storage

log = structlog.get_logger("invatrace.verification_worker")
MAX_IMAGE_PIXELS = 20_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class ModelTimeoutError(RuntimeError):
    """Inference exceeded the worker deadline and its process was terminated."""


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
    report.validation_model_version = None
    if first_unavailable:
        session.add(
            Notification(
                profile_id=report.profile_id,
                kind="validation_unavailable",
                title="Validation temporarily unavailable",
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
                    "Your report remains private because automated validation could not finish.",
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


def _run_provider(image: bytes):
    provider = get_plant_provider()
    return (
        provider.health(),
        provider.detect(image),
        provider.quality(image),
        provider.identify(image),
        provider.embed(image),
    )


def _provider_process(image: bytes, result_queue) -> None:
    try:
        result_queue.put(("ok", _run_provider(image)))
    except ModelUnavailableError as error:
        result_queue.put(("unavailable", str(error)))
    except Exception as error:
        result_queue.put(("error", f"{type(error).__name__}: {error}"))


def _run_provider_with_timeout(image: bytes, timeout_seconds: float):
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(target=_provider_process, args=(image, result_queue), daemon=True)
    process.start()
    process.join(timeout_seconds)
    if process.is_alive():
        process.terminate()
        process.join(5)
        result_queue.close()
        result_queue.join_thread()
        raise ModelTimeoutError("plant model inference timed out")
    try:
        status, payload = result_queue.get(timeout=1)
    except queue.Empty as error:
        raise RuntimeError("plant model process exited without a result") from error
    finally:
        result_queue.close()
        result_queue.join_thread()
    if status == "unavailable":
        raise ModelUnavailableError(payload)
    if status == "error":
        raise RuntimeError(payload)
    return payload


def _advisory_key(label: str) -> int:
    digest = hashlib.blake2b(label.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def _lock_validation_units(session, *labels: str) -> None:
    for key in sorted({_advisory_key(label) for label in labels}):
        session.execute(select(func.pg_advisory_xact_lock(key)))


def process_job(job_id: str) -> None:
    settings = get_settings()
    started = time.perf_counter()
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
            _lock_validation_units(
                session,
                f"content:{content_sha256.hex()}",
                f"capture:{report.capture_id}",
            )
            thumbnail_bytes = _make_thumbnail(image)
            health, detection, quality, identification, embedding = _run_provider_with_timeout(
                image, settings.plant_model_timeout_seconds
            )
            validate_model_output(detection, quality, identification, embedding)
            session.execute(
                insert(ModelVersion)
                .values(
                    provider=health.provider,
                    version=identification.model_version,
                    device=health.device,
                    fake=health.fake,
                    metadata_json={},
                )
                .on_conflict_do_nothing(index_elements=["provider", "version"])
            )
            model_version = session.scalar(
                select(ModelVersion).where(
                    ModelVersion.provider == health.provider,
                    ModelVersion.version == identification.model_version,
                )
            )
            inference = InferenceRecord(
                report_id=report.id,
                model_version_id=model_version.id,
                status="completed",
                quality_json={
                    "ok": quality.ok,
                    "reason": quality.reason,
                    "spoofProbability": quality.spoof_probability,
                    "oodProbability": quality.ood_probability,
                },
                detection_json={
                    "box": (
                        {
                            "x": detection.box.x,
                            "y": detection.box.y,
                            "w": detection.box.width,
                            "h": detection.box.height,
                        }
                        if detection.box
                        else None
                    )
                },
                identification_json={
                    "outcome": identification.outcome,
                    "speciesId": identification.species_id,
                    "confidence": identification.confidence,
                    "modelVersion": identification.model_version,
                },
                embedding_json=embedding,
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            session.add(inference)
            session.flush()

            server_species = (
                session.get(Species, identification.species_id)
                if identification.species_id
                else None
            )
            server_species_id = (
                server_species.id if server_species and server_species.reportable else None
            )
            if server_species_id:
                _lock_validation_units(session, f"species:{server_species_id}")
            exact_replay = (
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
            merge_target = None
            if server_species_id and not exact_replay:
                merge_target = _find_merge_target(
                    session,
                    report=report,
                    species_id=server_species_id,
                    embedding=embedding,
                )
            decision = evaluate(
                ValidationInput(
                    quality_ok=quality.ok,
                    plant_detected=detection.box is not None,
                    spoof_probability=quality.spoof_probability,
                    ood_probability=quality.ood_probability,
                    server_outcome=(identification.outcome if server_species_id else "uncertain"),
                    server_species_id=server_species_id,
                    server_confidence=identification.confidence,
                    client_outcome=report.outcome,
                    client_species_id=report.species_id,
                    submitter_trust=report.submitter_trust,
                    location_accuracy_m=report.location_accuracy_m,
                    exact_replay=exact_replay,
                    merge_target_id=str(merge_target.id) if merge_target else None,
                )
            )
            previous_state = report.status
            report.content_sha256 = content_sha256
            report.perceptual_hash = content_sha256.hex()[:32]
            report.status = decision.status
            report.validation_reasons = list(decision.reason_codes)
            report.validation_policy_version = POLICY_VERSION
            report.validation_model_version = identification.model_version
            published_sighting = _publish_decision(
                session,
                report=report,
                species=server_species,
                decision_status=decision.status,
                merge_target=merge_target,
                thumbnail_bytes=thumbnail_bytes,
            )
            session.add(
                AutomatedValidationDecision(
                    report_id=report.id,
                    decision=decision.status,
                    previous_state=previous_state,
                    resulting_state=decision.status,
                    policy_version=POLICY_VERSION,
                    model_version=identification.model_version,
                    reason_codes=list(decision.reason_codes),
                    checks_json={
                        "qualityOk": quality.ok,
                        "plantDetected": detection.box is not None,
                        "spoofProbability": quality.spoof_probability,
                        "oodProbability": quality.ood_probability,
                        "serverConfidence": identification.confidence,
                        "exactReplay": exact_replay,
                    },
                    merge_target_id=merge_target.id if merge_target else None,
                )
            )
            _notify_resolution(session, report)
            _update_trust(session, report, published_sighting)
            session.add(
                AuditEvent(
                    event_type="report.automated_validation_completed",
                    subject_type="report",
                    subject_id=str(report.id),
                    metadata_json={
                        "status": decision.status,
                        "reasonCodes": list(decision.reason_codes),
                        "sightingId": str(published_sighting.id) if published_sighting else None,
                        "policyVersion": POLICY_VERSION,
                    },
                )
            )
            job.status = "completed"
            job.last_error_code = None
        except ModelUnavailableError:
            session.add(
                InferenceRecord(
                    report_id=report.id,
                    status="unavailable",
                    error_code="model_unavailable",
                    duration_ms=round((time.perf_counter() - started) * 1000),
                )
            )
            job.status = (
                "failed" if job.attempts >= settings.worker_max_attempts else "unavailable"
            )
            job.last_error_code = "model_unavailable"
            if job.status == "unavailable":
                job.available_at = datetime.now(UTC) + timedelta(
                    seconds=min(300, 2**job.attempts)
                )
            _mark_report_unavailable(
                session,
                report,
                "server_validator_unavailable",
                "Your report is private and will not appear on the map until automated validation is available.",
            )
        except (
            UnidentifiedImageError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            OSError,
        ):
            previous_state = report.status
            report.status = "needs_rescan"
            report.validation_reasons = ["invalid_or_corrupt_image"]
            report.validation_policy_version = POLICY_VERSION
            report.validation_model_version = None
            session.add(
                InferenceRecord(
                    report_id=report.id,
                    status="invalid_input",
                    error_code="invalid_or_corrupt_image",
                    duration_ms=round((time.perf_counter() - started) * 1000),
                )
            )
            session.add(
                AutomatedValidationDecision(
                    report_id=report.id,
                    decision="needs_rescan",
                    previous_state=previous_state,
                    resulting_state="needs_rescan",
                    policy_version=POLICY_VERSION,
                    reason_codes=["invalid_or_corrupt_image"],
                    checks_json={"imageDecodable": False},
                )
            )
            _notify_resolution(session, report)
            _update_trust(session, report, None)
            job.status = "completed"
            job.last_error_code = "invalid_or_corrupt_image"
        except ModelTimeoutError:
            _schedule_failure(session, job, report, "model_timeout")
        except InvalidModelOutputError:
            session.add(
                InferenceRecord(
                    report_id=report.id,
                    status="error",
                    error_code="invalid_model_output",
                    duration_ms=round((time.perf_counter() - started) * 1000),
                )
            )
            _schedule_failure(session, job, report, "invalid_model_output")
        except Exception as error:
            log.exception(
                "verification.failed",
                job_id=str(job.id),
                report_id=str(job.report_id),
                error_type=type(error).__name__,
            )
            _schedule_failure(session, job, report, "verification_failed")
        session.commit()


def _cosine_similarity(first: list[float], second: list[float]) -> float:
    if not first or len(first) != len(second):
        return -1.0
    dot = sum(a * b for a, b in zip(first, second, strict=True))
    magnitude = math.sqrt(sum(a * a for a in first) * sum(b * b for b in second))
    return dot / magnitude if magnitude else -1.0


def _make_thumbnail(image: bytes) -> bytes:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(image)) as source:
            width, height = source.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise Image.DecompressionBombError("image dimensions exceed the validation limit")
            source.load()
            oriented = ImageOps.exif_transpose(source).convert("RGB")
            oriented.thumbnail((640, 640), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            oriented.save(output, format="JPEG", quality=82, optimize=True)
            return output.getvalue()


def _find_merge_target(
    session, *, report: Report, species_id: str, embedding: list[float]
) -> Sighting | None:
    radius_m = min(50, max(15, report.location_accuracy_m or 25))
    candidates = session.scalars(
        select(Sighting)
        .where(
            Sighting.species_id == species_id,
            Sighting.status == "confirmed",
            func.ST_DWithin(Sighting.location, report.location, radius_m),
        )
        .order_by(func.ST_Distance(Sighting.location, report.location))
        .limit(5)
    ).all()
    for candidate in candidates:
        previous_embedding = session.scalar(
            select(InferenceRecord.embedding_json)
            .join(ReportSightingLink, ReportSightingLink.report_id == InferenceRecord.report_id)
            .where(
                ReportSightingLink.sighting_id == candidate.id,
                ReportSightingLink.active.is_(True),
                InferenceRecord.status == "completed",
            )
            .order_by(InferenceRecord.created_at.desc())
            .limit(1)
        )
        if previous_embedding and _cosine_similarity(previous_embedding, embedding) >= 0.985:
            return candidate
    return None


def _publish_decision(
    session,
    *,
    report: Report,
    species: Species | None,
    decision_status: str,
    merge_target: Sighting | None,
    thumbnail_bytes: bytes,
) -> Sighting | None:
    if decision_status == "merged" and merge_target:
        session.add(
            ReportSightingLink(report_id=report.id, sighting_id=merge_target.id, active=True)
        )
        merge_target.updated_at = datetime.now(UTC)
        return merge_target
    if decision_status != "confirmed" or species is None:
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
        status="confirmed",
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


def _notify_resolution(session, report: Report) -> None:
    copy = {
        "confirmed": (
            "Report confirmed",
            "Automated checks passed. Your observation is now on the shared map.",
        ),
        "merged": (
            "Report matched an existing plant",
            "Your evidence was added to the existing map sighting.",
        ),
        "needs_rescan": (
            "A new scan is needed",
            "The automated checks could not validate this evidence. Retake it with the in-app camera.",
        ),
        "rejected": (
            "Report rejected",
            "Automated integrity checks rejected this evidence.",
        ),
    }[report.status]
    kind = {
        "confirmed": "report_confirmed",
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
                Report.status.in_(["confirmed", "merged"]),
                Report.observed_at >= report.observed_at - timedelta(days=30),
                ReportSightingLink.sighting_id == sighting.id,
                ReportSightingLink.active.is_(True),
            )
            .limit(1)
        )
        if recent_credit:
            return
    profile.resolved_reports += 1
    if report.status in {"confirmed", "merged"}:
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
            "Your report remains private because automated validation could not finish.",
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
        elif once:
            return
        else:
            time.sleep(settings.worker_poll_seconds)
