from __future__ import annotations

import base64
import os
import time
import uuid
from datetime import UTC, datetime
from io import BytesIO

import httpx
import pytest
from PIL import Image

pytestmark = pytest.mark.integration

if os.getenv("RUN_INVATRACE_INTEGRATION") != "1":
    pytest.skip(
        "set RUN_INVATRACE_INTEGRATION=1 with the Compose stack running",
        allow_module_level=True,
    )

BASE_URL = os.getenv("INVATRACE_INTEGRATION_BASE_URL", "http://localhost:8000")


def test_jpeg() -> bytes:
    output = BytesIO()
    Image.new("RGB", (640, 480), color=(20, 122, 80)).save(output, format="JPEG")
    return output.getvalue()


JPEG = test_jpeg()


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


def upload_photo(client: httpx.Client, token: str, key: str) -> str:
    request_body = {"contentType": "image/jpeg", "sizeBytes": len(JPEG)}
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
        json={"contentType": "image/jpeg", "sizeBytes": len(JPEG) + 1},
    )
    assert conflict.status_code == 409
    assert_ok(
        httpx.put(
            first["uploadUrl"],
            headers={"Content-Type": "image/jpeg"},
            content=JPEG,
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
) -> dict[str, object]:
    payload = {
        "photoKey": upload_photo(client, token, key),
        "speciesId": "mikania-micrantha",
        "outcome": "target",
        "confidence": 0.91,
        "modelVersion": "integration-client-v1",
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
    replay = client.post("/api/v1/reports", headers=auth(token, key), json=payload)
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == first.json()["id"]
    changed = {**payload, "notes": "Different request"}
    conflict = client.post("/api/v1/reports", headers=auth(token, key), json=changed)
    assert conflict.status_code == 409
    return first.json()


def wait_for_resolution(client: httpx.Client, token: str, report_id: str) -> dict[str, object]:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        report = assert_ok(client.get(f"/api/v1/reports/{report_id}", headers=auth(token))).json()
        if report["status"] != "processing":
            return report
        time.sleep(0.25)
    raise AssertionError(f"report {report_id} did not resolve automatically")


def test_private_access_and_automated_validation_end_to_end() -> None:
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        readiness = assert_ok(client.get("/health/ready")).json()
        assert readiness["database"] == "ok"
        assert readiness["redis"] == "ok"
        assert readiness["storage"] == "ok"
        assert readiness["model"] == "ready"

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
            lat=3.13900,
            lng=101.68690,
        )
        assert report_one["status"] == "processing"
        assert (
            client.get("/api/v1/verify/queue", headers=auth(first_access_token)).status_code == 404
        )
        resolved_one = wait_for_resolution(client, first_access_token, report_one["id"])
        assert resolved_one["status"] == "confirmed"
        assert resolved_one["sightingId"]
        public_sightings = assert_ok(client.get("/api/v1/sightings?limit=100")).json()["items"]
        published = next(
            item for item in public_sightings if item["id"] == resolved_one["sightingId"]
        )
        assert published["place"]["displayName"].startswith("Bukit Kiara")
        assert published["place"]["source"] in {"seed", "osm"}

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
            lat=3.13905,
            lng=101.68695,
        )
        resolved_two = wait_for_resolution(client, restored_access_token, report_two["id"])
        assert resolved_two["status"] == "rejected"
        assert "exact_photo_replay" in resolved_two["validation"]["reasonCodes"]

        mine = assert_ok(
            client.get("/api/v1/reports/mine", headers=auth(restored_access_token))
        ).json()["items"]
        states = {item["id"]: item["status"] for item in mine}
        assert states[report_one["id"]] == "confirmed"
        assert states[report_two["id"]] == "rejected"

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
