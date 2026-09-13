"""End-to-end test against a real running stack (API + Postgres + Redis + MinIO).

Unlike the rest of the test suite this doesn't mock anything - it walks
through the whole user journey against docker-compose: start a profile,
upload a photo, submit reports, wait for the background screening worker
to resolve them, restore access on a new device with a recovery code, and
revoke the old one. It's slow and needs the Compose stack up, so it's
opt-in via RUN_INVATRACE_INTEGRATION and skipped otherwise (including in
normal CI unit test runs).
"""

from __future__ import annotations

import base64
import os
import random
import time
import uuid
from datetime import UTC, datetime
from io import BytesIO

import httpx
import pytest
from PIL import Image, ImageDraw

pytestmark = pytest.mark.integration

if os.getenv("RUN_INVATRACE_INTEGRATION") != "1":
    pytest.skip(
        "set RUN_INVATRACE_INTEGRATION=1 with the Compose stack running",
        allow_module_level=True,
    )

BASE_URL = os.getenv("INVATRACE_INTEGRATION_BASE_URL", "http://localhost:8000")


# randomising the seed/location per test run means repeated runs against
# a persistent Compose stack don't collide with leftover data (duplicate
# hashes, nearby-sighting merges) from a previous run.
RUN_IMAGE_SEED = uuid.uuid4().int
RUN_LATITUDE = 3.133 + (RUN_IMAGE_SEED % 10_000) / 1_000_000
RUN_LONGITUDE = 101.681 + ((RUN_IMAGE_SEED >> 16) % 10_000) / 1_000_000


def seeded_background(seed: int) -> Image.Image:
    rng = random.Random(seed)
    pixels = rng.randbytes(64 * 48 * 3)
    return Image.frombytes("RGB", (64, 48), pixels).resize((640, 480))


def make_test_jpeg() -> bytes:
    output = BytesIO()
    image = seeded_background(RUN_IMAGE_SEED)
    draw = ImageDraw.Draw(image)
    for index in range(0, 640, 24):
        draw.line((0, index, 640, max(0, index - 160)), fill=(210, 230, 120), width=8)
        draw.ellipse((index, 90, index + 70, 210), fill=(18, 65, 30))
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()


JPEG = make_test_jpeg()


# a visually distinct second photo (different seed, different pattern) so
# it hashes as a genuinely different image from JPEG above rather than a
# near-duplicate - used for the "merge into an existing sighting" case.
def alternate_jpeg(*, crop: bool = False) -> bytes:
    output = BytesIO()
    image = seeded_background(RUN_IMAGE_SEED ^ 0x5A17)
    draw = ImageDraw.Draw(image)
    for index in range(0, 640, 80):
        draw.rectangle((index, 0, index + 35, 480), fill=(180, 208, 90))
        draw.polygon(
            [(index, 400), (index + 75, 100), (index + 40, 30)],
            fill=(22, 58, 35),
        )
    if crop:
        image = image.crop((64, 48, 576, 432))
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()


ALTERNATE_JPEG = alternate_jpeg()
# a cropped version of ALTERNATE_JPEG, but cropped enough / far enough
# away that it should still register as a perceptual-hash replay rather
# than a legit new sighting - see report_four below.
ALTERNATE_CROP_JPEG = alternate_jpeg(crop=True)


def installation_token() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")


def auth(token: str, idempotency_key: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def assert_ok(response: httpx.Response) -> httpx.Response:
    assert response.is_success, response.text
    return response


def upload_photo(client: httpx.Client, token: str, key: str, photo: bytes) -> str:
    # presign is idempotent on the Idempotency-Key: replaying the exact
    # same request must return the same photoKey (e.g. the app retried
    # after a flaky connection), but replaying with a different body under
    # the same key is a conflict, not silently accepted.
    request_body = {"contentType": "image/jpeg", "sizeBytes": len(photo)}
    first = assert_ok(
        client.post(
            "/api/v1/uploads/presign",
            headers=auth(token, f"{key}:upload"),
            json=request_body,
        )
    ).json()
    replay = assert_ok(
        client.post(
            "/api/v1/uploads/presign",
            headers=auth(token, f"{key}:upload"),
            json=request_body,
        )
    ).json()
    assert replay["photoKey"] == first["photoKey"]
    conflict = client.post(
        "/api/v1/uploads/presign",
        headers=auth(token, f"{key}:upload"),
        json={"contentType": "image/jpeg", "sizeBytes": len(photo) + 1},
    )
    assert conflict.status_code == 409
    assert_ok(
        httpx.put(
            first["uploadUrl"],
            headers={"Content-Type": "image/jpeg"},
            content=photo,
            timeout=10,
        )
    )
    return first["photoKey"]


import hashlib


def create_scan(
    client: httpx.Client,
    token: str,
    *,
    capture_id: str,
    confidence: float,
    model_version: str,
    photo: bytes,
) -> None:
    """AC 2.2.1 - persist the on-device classifier result before the report
    submission so the FastAPI create_report path can enforce scan/report
    consistency."""
    scan_payload = {
        "captureId": capture_id,
        "predictedSpeciesId": "mikania-micrantha",
        "outcome": "target",
        "confidence": confidence,
        "modelVersion": model_version,
        "imageSha256Hex": hashlib.sha256(photo).hexdigest(),
        "captureSource": "camera",
    }
    response = client.post("/api/v1/scans", headers=auth(token), json=scan_payload)
    assert response.status_code == 201, response.text


def create_report(
    client: httpx.Client,
    token: str,
    *,
    key: str,
    lat: float,
    lng: float,
    photo: bytes = JPEG,
    verify_idempotency: bool = False,
) -> dict[str, object]:
    capture_id = str(uuid.uuid4())
    confidence = 0.91
    model_version = "oe_v4_31class_web_fp16"
    # AC 2.2.1 - reports without an owner-scoped scan for the capture are
    # rejected. Persist the scan first so this test walks the real path.
    create_scan(
        client, token,
        capture_id=capture_id,
        confidence=confidence,
        model_version=model_version,
        photo=photo,
    )
    payload = {
        "photoKey": upload_photo(client, token, key, photo),
        "speciesId": "mikania-micrantha",
        "outcome": "target",
        "confidence": confidence,
        "modelVersion": model_version,
        "observedAt": datetime.now(UTC).isoformat(),
        "captureId": capture_id,
        "captureSource": "camera",
        # AC 2.3.1 / release blocker - server re-hashes the uploaded bytes
        # and rejects a mismatch, so include the client-computed value.
        "imageSha256": hashlib.sha256(photo).hexdigest(),
        "location": {"lat": lat, "lng": lng},
        "locationAccuracyM": 12,
        "extent": "single",
        "notes": "Integration test evidence",
        "consent": {"accurate": True, "noPII": True},
    }
    first = client.post("/api/v1/reports", headers=auth(token, key), json=payload)
    assert first.status_code == 201, first.text
    if verify_idempotency:
        # same idempotency key + same payload must return the same report
        # id (not create a second report), but the same key with a
        # different payload should be flagged as a conflict rather than
        # silently overwriting the original submission.
        replay = client.post("/api/v1/reports", headers=auth(token, key), json=payload)
        assert replay.status_code == 201, replay.text
        assert replay.json()["id"] == first.json()["id"]
        changed = {**payload, "notes": "Different request"}
        conflict = client.post("/api/v1/reports", headers=auth(token, key), json=changed)
        assert conflict.status_code == 409
    return first.json()


def wait_for_resolution(client: httpx.Client, token: str, report_id: str) -> dict[str, object]:
    # reports start out "processing" and the screening worker resolves
    # them asynchronously in the background, so we poll instead of
    # expecting an immediate answer. 20s should be way more than the
    # worker needs locally; if it's still "processing" past that, treat
    # it as a real failure rather than hanging the test suite forever.
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        report = assert_ok(client.get(f"/api/v1/reports/{report_id}", headers=auth(token))).json()
        if report["status"] != "processing":
            return report
        time.sleep(0.25)
    raise AssertionError(f"report {report_id} did not resolve automatically")


def test_private_access_and_automated_validation_end_to_end() -> None:
    """The one big journey test: profile creation, four reports through the
    real screening worker (clean pass, exact replay, merge, perceptual
    replay), device restore via recovery code, and installation revocation.

    It's long on purpose - splitting it into separate tests would mean
    re-running the whole "start profile -> upload -> submit -> wait for
    worker" dance each time, which against a real Compose stack is slow.
    Keeping it as one flow also mirrors how a real user's session actually
    goes: everything here happens to the same profile in order.
    """
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        readiness = assert_ok(client.get("/health/ready")).json()
        assert readiness["database"] == "ok"
        assert readiness["redis"] == "ok"
        assert readiness["storage"] == "ok"
        assert readiness["screening"] == "ready"

        first_installation_token = installation_token()
        started_response = client.post(
            "/api/v1/profiles/start",
            json={"installationToken": first_installation_token},
        )
        assert started_response.status_code == 201, started_response.text
        assert "no-store" in started_response.headers["cache-control"]
        started = started_response.json()
        first_access_token = started["accessToken"]
        assert started["profile"]["role"] == "Detector"
        assert started["profile"]["trustLevel"] == "New"
        assert len(started["recoveryCodes"]) == 10

        # a fresh profile is nagged to acknowledge that they've saved their
        # recovery codes before bootstrap will stop flagging
        # recoverySetupRequired - simulating that acknowledgement here.
        assert_ok(
            client.post(
                "/api/v1/profiles/me/recovery-setup/acknowledge",
                headers=auth(first_access_token),
            )
        )
        bootstrapped = assert_ok(
            client.post(
                "/api/v1/profiles/bootstrap",
                json={"installationToken": first_installation_token},
            )
        ).json()
        assert bootstrapped["recoverySetupRequired"] is False
        first_access_token = bootstrapped["accessToken"]

        report_one = create_report(
            client,
            first_access_token,
            key=f"integration-{uuid.uuid4()}",
            lat=RUN_LATITUDE,
            lng=RUN_LONGITUDE,
            verify_idempotency=True,
        )
        assert report_one["status"] == "processing"
        # the old manual-review queue endpoint is gone now that screening
        # is fully automated - checking it 404s rather than just checking
        # it's absent from the OpenAPI schema, since a route could still
        # be mounted without being documented.
        assert (
            client.get("/api/v1/verify/queue", headers=auth(first_access_token)).status_code == 404
        )
        resolved_one = wait_for_resolution(client, first_access_token, report_one["id"])
        assert resolved_one["status"] == "screened", resolved_one
        assert resolved_one["validation"]["screeningMethod"] == "deterministic_rules"
        assert resolved_one["sightingId"]
        public_sightings = assert_ok(client.get("/api/v1/sightings?limit=100")).json()["items"]
        published = next(
            item for item in public_sightings if item["id"] == resolved_one["sightingId"]
        )
        assert published["place"]["displayName"]
        assert published["place"]["source"] in {"seed", "osm"}

        # now switch to a *new* installation restored via recovery code -
        # everything from here on exercises the "lost your phone, got a
        # new one" flow rather than the original device.
        restored_installation_token = installation_token()
        restored = assert_ok(
            client.post(
                "/api/v1/profiles/restore",
                json={
                    "profileId": started["profile"]["id"],
                    "recoveryCode": started["recoveryCodes"][0],
                    "installationToken": restored_installation_token,
                },
            )
        ).json()
        restored_access_token = restored["accessToken"]
        # recovery codes are single-use - trying the same code again
        # (even from a different installation token) must be rejected,
        # otherwise anyone who saw one used code could keep replaying it.
        reused = client.post(
            "/api/v1/profiles/restore",
            json={
                "profileId": started["profile"]["id"],
                "recoveryCode": started["recoveryCodes"][0],
                "installationToken": installation_token(),
            },
        )
        assert reused.status_code == 400

        report_two = create_report(
            client,
            restored_access_token,
            key=f"integration-{uuid.uuid4()}",
            lat=RUN_LATITUDE + 0.00005,
            lng=RUN_LONGITUDE + 0.00005,
        )
        resolved_two = wait_for_resolution(client, restored_access_token, report_two["id"])
        # AC 2.3.1 - same owner + same species + same SHA-256 must return
        # the existing sighting with `merged`, not create a new report or
        # public marker. (The earlier "rejected" behaviour applied only to
        # cross-owner exact replays, which are still caught by
        # `_is_exact_replay` and marked as spam.)
        assert resolved_two["status"] == "merged"
        assert resolved_two["sightingId"] == resolved_one["sightingId"]

        report_three = create_report(
            client,
            restored_access_token,
            key=f"integration-{uuid.uuid4()}",
            lat=RUN_LATITUDE + 0.00004,
            lng=RUN_LONGITUDE + 0.00004,
            photo=ALTERNATE_JPEG,
        )
        resolved_three = wait_for_resolution(client, restored_access_token, report_three["id"])
        # a genuinely different photo (ALTERNATE_JPEG), but close in space
        # and time to report_one and same species - this should merge into
        # the existing sighting rather than publishing a second pin a few
        # metres away from the first.
        assert resolved_three["status"] == "merged"
        assert "same_species_nearby_recent" in resolved_three["validation"]["reasonCodes"]
        assert resolved_three["sightingId"] == resolved_one["sightingId"]

        report_four = create_report(
            client,
            restored_access_token,
            key=f"integration-{uuid.uuid4()}",
            lat=RUN_LATITUDE + 0.006,
            lng=RUN_LONGITUDE + 0.006,
            photo=ALTERNATE_CROP_JPEG,
        )
        resolved_four = wait_for_resolution(client, restored_access_token, report_four["id"])
        # this one's a crop of ALTERNATE_JPEG, far enough away in space
        # that it can't merge - so it's testing the perceptual hash catches
        # a cropped duplicate on its own, separate from the merge logic.
        assert resolved_four["status"] == "rejected"
        assert "perceptual_photo_replay" in resolved_four["validation"]["reasonCodes"]

        mine = assert_ok(
            client.get("/api/v1/reports/mine", headers=auth(restored_access_token))
        ).json()["items"]
        states = {item["id"]: item["status"] for item in mine}
        assert states[report_one["id"]] == "screened"
        # AC 2.3.1 - same-owner exact-hash replay resolves as `merged`.
        assert states[report_two["id"]] == "merged"
        assert states[report_three["id"]] == "merged"
        assert states[report_four["id"]] == "rejected"

        notifications = assert_ok(
            client.get("/api/v1/notifications", headers=auth(restored_access_token))
        ).json()
        assert notifications["unread"] >= 1
        assert_ok(
            client.post(
                "/api/v1/notifications/read-all",
                headers=auth(restored_access_token),
            )
        )

        rotated = assert_ok(
            client.post(
                "/api/v1/profiles/me/recovery-codes/rotate",
                headers=auth(restored_access_token),
            )
        ).json()
        assert len(rotated["recoveryCodes"]) == 10
        # rotating recovery codes should invalidate the *whole* old batch,
        # not just the one code we already used - so an untouched old code
        # (index 1, never used above) must also stop working after rotation.
        old_unused = client.post(
            "/api/v1/profiles/restore",
            json={
                "profileId": started["profile"]["id"],
                "recoveryCode": started["recoveryCodes"][1],
                "installationToken": installation_token(),
            },
        )
        assert old_unused.status_code == 400

        access = assert_ok(
            client.get("/api/v1/profiles/me/access", headers=auth(restored_access_token))
        ).json()
        assert len(access["installations"]) == 2
        # revoke the original device from the restored one - this is the
        # "I lost my old phone, kill its access" scenario. After revoking,
        # the original installation's token must no longer be able to
        # bootstrap a session at all.
        assert_ok(
            client.post(
                f"/api/v1/profiles/me/installations/{started['installationId']}/revoke",
                headers=auth(restored_access_token),
            )
        )
        revoked = client.post(
            "/api/v1/profiles/bootstrap",
            json={"installationToken": first_installation_token},
        )
        assert revoked.status_code == 401


def test_scan_report_publish_sighting_end_to_end() -> None:
    """AC 2.2.1 + 4.1.4 + 4.2.1 + 4.2.2 + 4.3.1 + 4.3.2 - full published-report
    journey against the real stack. Persists an accepted scan, uploads and
    submits the report, waits for the screening worker to publish, then
    fetches the public sighting endpoint and asserts the AC-required fields
    are present on the response.

    Kept separate from the omnibus flow test above so the extended AC
    assertions are easy to read individually. Skipped without
    RUN_INVATRACE_INTEGRATION=1 like the rest of this module.
    """
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        started = assert_ok(
            client.post(
                "/api/v1/profiles/start",
                json={"installationToken": installation_token()},
            )
        ).json()
        token = started["accessToken"]

        # Unique-per-test JPEG (both bytes AND perceptual content) so this
        # run does not collide with an earlier test's photo on either the
        # exact-hash or perceptual-hash duplicate paths. Build the image
        # from a fresh random background and a unique geometric pattern.
        unique_seed = uuid.uuid4().int
        unique_image = seeded_background(unique_seed)
        draw = ImageDraw.Draw(unique_image)
        for index in range(0, 640, 32):
            draw.ellipse(
                (index, 40 + (unique_seed % 100), index + 60, 200 + (unique_seed % 100)),
                fill=((unique_seed >> 8) & 0xff, (unique_seed >> 16) & 0xff, 90),
            )
        buf = BytesIO()
        unique_image.save(buf, format="JPEG", quality=90)
        unique_photo = buf.getvalue()
        report = create_report(
            client,
            token,
            key=f"e2e-published-{uuid.uuid4().hex}",
            lat=RUN_LATITUDE + 0.0004,
            lng=RUN_LONGITUDE + 0.0004,
            photo=unique_photo,
        )

        # AC 4.1.4 - the report starts `processing` and only becomes
        # `screened` after the worker publishes it. Poll until then.
        resolved = wait_for_resolution(client, token, report["id"])
        assert resolved["status"] == "screened", resolved
        sighting_id = resolved["sightingId"]
        assert sighting_id, "screened report must expose its sightingId"

        # AC 4.2.1 - public list must include this sighting under status
        # screened; `removed` must never appear in Iteration 1 responses.
        listing = assert_ok(client.get("/api/v1/sightings")).json()
        ids = {item["id"] for item in listing["items"]}
        assert sighting_id in ids, "screened sighting missing from public feed"
        for item in listing["items"]:
            assert item["status"] == "screened", item

        # AC 4.2.2 + 4.3.1 - detail response carries the presigned
        # thumbnail, model confidence, and the server-stored nearest OSM
        # feature (or nulls if none within 5 km - AC 4.3.2 fallback).
        detail = assert_ok(client.get(f"/api/v1/sightings/{sighting_id}")).json()
        assert detail["thumbnailUrl"], "sighting detail must include a presigned thumbnailUrl"
        assert detail["confidence"] is not None
        assert 0.0 <= detail["confidence"] <= 1.0
        # Nearest fields may be null when nothing is within 5 km; when
        # populated they must be an allow-listed type.
        if detail["nearestFeatureType"] is not None:
            assert detail["nearestFeatureType"] in {
                "path", "footway", "track", "park", "forest", "wood",
            }
            assert detail["nearestFeatureName"]
            assert detail["nearestFeatureDistanceM"] is not None


def test_report_cannot_swap_species_or_confidence_from_scan() -> None:
    """AC 4.1.1 - the species / confidence / model version submitted with
    the report must match the scan the client already persisted. Any drift
    is a 422 with a field-specific error code; no report row, verification
    job or sighting is created for the rejected attempt.
    """
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        started = assert_ok(
            client.post(
                "/api/v1/profiles/start",
                json={"installationToken": installation_token()},
            )
        ).json()
        token = started["accessToken"]

        capture_id = str(uuid.uuid4())
        create_scan(
            client, token,
            capture_id=capture_id,
            confidence=0.91,
            model_version="oe_v4_31class_web_fp16",
            photo=JPEG,
        )
        key = f"e2e-immutable-{capture_id}"
        photo_key = upload_photo(client, token, key, JPEG)

        base_payload = {
            "photoKey": photo_key,
            "speciesId": "mikania-micrantha",
            "outcome": "target",
            "confidence": 0.91,
            "modelVersion": "oe_v4_31class_web_fp16",
            "observedAt": datetime.now(UTC).isoformat(),
            "captureId": capture_id,
            "captureSource": "camera",
            "imageSha256": hashlib.sha256(JPEG).hexdigest(),
            "location": {"lat": RUN_LATITUDE, "lng": RUN_LONGITUDE},
            "locationAccuracyM": 10,
            "extent": "single",
            "notes": "immutability check",
            "consent": {"accurate": True, "noPII": True},
        }

        # Species swap - the scan recorded mikania-micrantha; the report
        # cannot claim a different species without a fresh scan.
        swapped = {**base_payload, "speciesId": "chromolaena-odorata"}
        response = client.post(
            "/api/v1/reports",
            headers=auth(token, f"{key}:species-swap"),
            json=swapped,
        )
        assert response.status_code == 422
        assert response.json()["code"] == "scan_species_mismatch"

        # Confidence drift - even inside the target species, the reported
        # confidence must match the scan reading.
        drifted = {**base_payload, "confidence": 0.55}
        response = client.post(
            "/api/v1/reports",
            headers=auth(token, f"{key}:confidence-drift"),
            json=drifted,
        )
        assert response.status_code == 422
        assert response.json()["code"] == "scan_confidence_mismatch"

        # Model version swap - an unrecognised client model version must be
        # blocked so trust decisions stay tied to the version the scan used.
        version_swapped = {**base_payload, "modelVersion": "some-other-model"}
        response = client.post(
            "/api/v1/reports",
            headers=auth(token, f"{key}:version-swap"),
            json=version_swapped,
        )
        assert response.status_code == 422
        assert response.json()["code"] == "scan_model_version_mismatch"

        # Capture-source swap - the scan recorded camera capture; the report
        # cannot re-label it as an upload without a fresh scan.
        source_swapped = {**base_payload, "captureSource": "upload"}
        response = client.post(
            "/api/v1/reports",
            headers=auth(token, f"{key}:capture-source-swap"),
            json=source_swapped,
        )
        assert response.status_code == 422
        assert response.json()["code"] == "scan_capture_source_mismatch"

        # Image hash mismatch - the client-declared SHA-256 must match the
        # bytes the server actually persisted for the scan.
        wrong_hash = hashlib.sha256(b"not the same image").hexdigest()
        hash_swapped = {**base_payload, "imageSha256": wrong_hash}
        response = client.post(
            "/api/v1/reports",
            headers=auth(token, f"{key}:image-hash-swap"),
            json=hash_swapped,
        )
        assert response.status_code == 422
        assert response.json()["code"] in {
            "scan_image_hash_mismatch",
            "image_hash_mismatch",
        }

        # AC 4.1.3 - none of the rejected attempts must have left behind a
        # report row, so listing the profile's reports shows zero entries.
        listing = assert_ok(
            client.get("/api/v1/reports/mine", headers=auth(token))
        ).json()
        assert listing["items"] == []


def test_saved_installation_bootstraps_without_recovery_prompt() -> None:
    """AC 2.1.3 - a valid saved installation must restore the session
    without asking the user for a recovery code. The bootstrap response
    only clears ``recoverySetupRequired`` after the user has acknowledged
    saving their recovery kit, so this test walks that acknowledgement
    step and then confirms bootstrap no longer prompts."""
    installation = installation_token()
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        started = assert_ok(
            client.post(
                "/api/v1/profiles/start",
                json={"installationToken": installation},
            )
        ).json()
        profile_id = started["profile"]["id"]
        access_token = started["accessToken"]

        # User has saved the recovery kit - the app posts this before it
        # ever calls bootstrap in the wild.
        assert_ok(
            client.post(
                "/api/v1/profiles/me/recovery-setup/acknowledge",
                headers=auth(access_token),
            )
        )

        bootstrapped = assert_ok(
            client.post(
                "/api/v1/profiles/bootstrap",
                json={"installationToken": installation},
            )
        ).json()
        assert bootstrapped["profile"]["id"] == profile_id
        assert bootstrapped["recoverySetupRequired"] is False
        assert bootstrapped["accessToken"], "bootstrap must mint a new access token"
