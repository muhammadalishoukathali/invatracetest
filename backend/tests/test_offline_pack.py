"""Iteration 2 Phase 6 - Epic 5.3 offline catalogue pack invariants.

Text + light dynamic checks against the pack builder and router. The
builder itself is exercised end-to-end against the seeded evidence
catalogue so a regression in canonical serialisation (which would break
the client's SHA-256 verify path) fails here rather than in production.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.services.offline_pack import build_offline_pack
from app.db.base import SessionLocal

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_offline_pack_router_registered_in_main() -> None:
    src = _read("app/main.py")
    assert "offline_pack" in src
    assert "offline_pack.router" in src


def test_offline_pack_router_exposes_manifest_and_download() -> None:
    src = _read("app/api/routers/offline_pack.py")
    assert '@router.get("/latest"' in src
    # AC 5.3.4 - the per-file endpoint must live under the versioned
    # prefix so a stale client cannot pick up bytes from a different
    # catalogue version through URL-guessing.
    assert '"/{catalogue_version}/{file_path:path}"' in src
    # AC 5.3.1 - manifest carries manifest_sha256 + per-file sha256.
    assert "manifest_sha256" in src
    assert "sha256" in src


def test_offline_pack_service_uses_canonical_json() -> None:
    src = _read("app/services/offline_pack.py")
    # AC 5.3.1 - digests only stay stable if we always serialise the
    # same content the same way. sort_keys + fixed separators is that
    # guarantee; a change here that drops either flag is a regression.
    assert "sort_keys=True" in src
    assert 'separators=(",", ":")' in src


def test_offline_pack_service_hashes_every_file() -> None:
    src = _read("app/services/offline_pack.py")
    # AC 5.3.4 - the client must be able to verify each asset before
    # overwriting an installed pack; that means one digest per file.
    assert "_sha256_hex(" in src
    assert "OfflinePackFile(" in src


def test_offline_pack_service_includes_severity_flags() -> None:
    src = _read("app/services/offline_pack.py")
    # AC 5.2.4 alignment - the offline detail file must expose the same
    # "not available" flags the online detail endpoint uses; otherwise
    # an offline reader could invent a severity assessment.
    assert "formal_severity_assessment_available" in src
    assert "beginner_safe_action_available" in src


def test_router_download_returns_per_file_header() -> None:
    src = _read("app/api/routers/offline_pack.py")
    # AC 5.3.4 - clients can verify a single response without having to
    # re-read the manifest to look up the file's expected digest.
    assert "X-InvaTrace-File-SHA256" in src


def test_router_rejects_wrong_version_download() -> None:
    src = _read("app/api/routers/offline_pack.py")
    # AC 5.3.4 - "keep last valid pack" only works if a stale client
    # asking for the wrong catalogue version is refused, not answered
    # with the current version's bytes.
    assert "pack_version_mismatch" in src


def test_pack_build_deterministic_and_hashes_match() -> None:
    with SessionLocal() as session:
        pack_a = build_offline_pack(session)
        pack_b = build_offline_pack(session)
    # Two back-to-back builds against the same DB snapshot must
    # produce identical file digests + manifest digest, otherwise the
    # client's "already installed" short-circuit is unreliable.
    digests_a = tuple((f.path, f.sha256) for f in pack_a.files)
    digests_b = tuple((f.path, f.sha256) for f in pack_b.files)
    assert digests_a == digests_b
    assert pack_a.manifest_sha256 == pack_b.manifest_sha256

    # Every file's declared digest must actually match the bytes it
    # carries - a bug where we hash the wrong payload would go
    # unnoticed without this cross-check.
    for f in pack_a.files:
        assert hashlib.sha256(f.content).hexdigest() == f.sha256
        assert f.byte_size == len(f.content)

    # catalogue.json is mandatory; every extra file must live under
    # species/. Guards against an accidental additional payload
    # entering the manifest without a matching client contract.
    paths = {f.path for f in pack_a.files}
    assert "catalogue.json" in paths
    assert all(p == "catalogue.json" or p.startswith("species/") for p in paths)


def test_pack_catalogue_file_matches_manifest_metadata() -> None:
    with SessionLocal() as session:
        pack = build_offline_pack(session)
    catalogue_file = next(f for f in pack.files if f.path == "catalogue.json")
    body = json.loads(catalogue_file.content)
    assert body["catalogue_version"] == pack.catalogue_version
    assert body["total_species_count"] == pack.total_species_count
    # The list body is exactly the same shape the online endpoint
    # returns, so an offline reader can reuse the online reader code.
    assert isinstance(body["items"], list) and body["items"]
    for entry in body["items"]:
        assert "species_id" in entry
        assert "scientific_name" in entry
