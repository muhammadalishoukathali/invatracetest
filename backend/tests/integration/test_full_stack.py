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
    payload = {
        "photoKey": upload_photo(client, token, key, photo),
        "speciesId": "mikania-micrantha",
        "outcome": "target",
        "confidence": 0.91,
        "modelVersion": "oe_v4_31class_web_fp16",
        "observedAt": datetime.now(UTC).isoformat(),
        "captureId": str(uuid.uuid4()),
        "captureSource": "camera",
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
        # same JPEG bytes as report_one, submitted again from the restored
        # device - this should get caught by exact-hash replay detection
        # and rejected, not treated as a fresh sighting.
        assert resolved_two["status"] == "rejected"
        assert "exact_photo_replay" in resolved_two["validation"]["reasonCodes"]

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
        assert states[report_two["id"]] == "rejected"
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
