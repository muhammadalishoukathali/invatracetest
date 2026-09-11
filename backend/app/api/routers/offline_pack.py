"""Iteration 2 Phase 6 - Epic 5.3 offline catalogue pack endpoints.

Two routes:

* ``GET /api/v1/offline-pack/latest`` returns the pack manifest for the
  current ``catalogue_version``. Every file entry carries an inline
  ``download_url`` pointing at the second route so the client can fetch
  and SHA-256-verify each asset before overwriting the installed pack
  (AC 5.3.1, 5.3.4).
* ``GET /api/v1/offline-pack/{catalogue_version}/{path}`` streams one
  file's bytes deterministically from the DB. Serving assets through
  the API (instead of prebuilt object-storage URLs) keeps the prototype
  self-contained; when we later push packs to R2/MinIO this endpoint
  becomes the fallback path, not the primary one.

The manifest response is safe to cache client-side keyed on
``manifest_sha256``: identical content across generations produces
identical digests, so a client can skip re-download when the manifest
digest matches its currently installed pack.
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Response
from pydantic import Field
from sqlalchemy.orm import Session

from app.api.schemas import ApiModel
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.services.offline_pack import build_offline_pack


router = APIRouter(prefix="/api/v1/offline-pack", tags=["offline-pack"])


class OfflinePackFileEntry(ApiModel):
    path: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    byte_size: int = Field(ge=0)
    download_url: str


class OfflinePackManifest(ApiModel):
    catalogue_version: str
    reviewed_at: date
    total_species_count: int
    generated_at: datetime
    manifest_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    total_byte_size: int = Field(ge=0)
    files: list[OfflinePackFileEntry]


@router.get("/latest", response_model=OfflinePackManifest)
def latest_manifest(session: Session = Depends(get_session)) -> OfflinePackManifest:
    pack = build_offline_pack(session)
    return OfflinePackManifest(
        catalogue_version=pack.catalogue_version,
        reviewed_at=pack.reviewed_at,
        total_species_count=pack.total_species_count,
        generated_at=pack.generated_at,
        manifest_sha256=pack.manifest_sha256,
        total_byte_size=pack.total_byte_size,
        files=[
            OfflinePackFileEntry(
                path=f.path,
                sha256=f.sha256,
                byte_size=f.byte_size,
                download_url=(
                    f"/api/v1/offline-pack/{pack.catalogue_version}/{f.path}"
                ),
            )
            for f in pack.files
        ],
    )


@router.get("/{catalogue_version}/{file_path:path}")
def download_file(
    catalogue_version: str,
    file_path: str,
    session: Session = Depends(get_session),
) -> Response:
    pack = build_offline_pack(session)
    if pack.catalogue_version != catalogue_version:
        # The client had a stale manifest and is asking for a file from a
        # catalogue version that no longer exists. Fail closed so the
        # keep-last-valid path on the client can trigger a manifest
        # refresh instead of installing bytes from the wrong version.
        raise ApiProblem(404, "pack_version_mismatch", "Offline pack version not found")
    for entry in pack.files:
        if entry.path == file_path:
            return Response(
                content=entry.content,
                media_type=entry.content_type,
                headers={
                    # Per-file SHA-256 lets the client verify the response
                    # without re-parsing the manifest to look this file up.
                    "X-InvaTrace-File-SHA256": entry.sha256,
                    # Content addressed by (catalogue_version, sha256),
                    # so caches can hold it indefinitely - the version in
                    # the URL changes as soon as the digest could change.
                    "Cache-Control": "public, max-age=31536000, immutable",
                },
            )
    raise ApiProblem(404, "pack_file_not_found", "Offline pack file not found")
