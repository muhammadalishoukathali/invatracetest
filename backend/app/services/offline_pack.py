"""Iteration 2 Phase 6 - Epic 5.3 offline catalogue pack builder.

Assembles a deterministic content-addressed pack from the current
``catalogue_version`` so the frontend can install the bestiary for
offline use. The pack is generated on demand from the live DB rather
than prebuilt onto object storage; that keeps the API self-contained
for the prototype and avoids a separate R2/MinIO upload step, while
still meeting AC 5.3:

- Every file in the manifest carries its own SHA-256 so the client can
  verify each asset before overwriting the previously installed pack.
- The manifest itself carries a ``sha256_manifest`` computed over the
  sorted list of file digests, giving the client one fingerprint to
  compare against the currently installed pack.
- File contents are serialised deterministically (sorted keys, stable
  separators, ASCII-safe) so the same catalogue snapshot always yields
  the same digests - a repeat call must be idempotent for the client's
  "already installed" short-circuit to work.

The pack currently ships two kinds of files:

- ``catalogue.json`` - the same list body the online ``/api/v1/catalogue``
  endpoint returns, so an offline reader can render the bestiary index
  with no network.
- ``species/<species_id>.json`` - one file per species matching the
  ``/api/v1/catalogue/{species_id}`` shape so plant-detail deep-links
  still resolve while offline.

Reference images (AC 5.3.2): the pipeline walks every species with a
populated ``reference_image_url`` and, when ``_resolve_image_bytes``
returns bytes for the URL, packs them under ``images/{species_id}.{ext}``
with the same per-file SHA-256 + manifest fingerprint pattern the JSON
files use. The resolver reads bytes off the filesystem at
``settings.reference_image_root`` (baked in prod, volume-mounted in
dev). URLs pointing outside ``/reference-images/`` are rejected so the
resolver never serves arbitrary files.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import CatalogueVersion, Species
from app.domain.evidence_catalogue import load_evidence_catalogue


@dataclass(frozen=True)
class OfflinePackFile:
    path: str
    sha256: str
    byte_size: int
    content: bytes
    # Content-Type for the download endpoint. Defaults to application/json
    # because the catalogue + per-species files are JSON; the image
    # pipeline (AC 5.3.2) sets this per-extension so the client hands
    # correct bytes back to <img>.
    content_type: str = "application/json"


@dataclass(frozen=True)
class OfflinePack:
    catalogue_version: str
    reviewed_at: date
    total_species_count: int
    generated_at: datetime
    files: tuple[OfflinePackFile, ...]
    manifest_sha256: str
    total_byte_size: int


def _canonical_json(payload: object) -> bytes:
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def _sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


_IMAGE_CONTENT_TYPES: dict[str, str] = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
    "avif": "image/avif",
}


def _image_extension(url: str) -> str:
    """Best-effort extension from a reference_image_url. Falls back to
    ``jpg`` when the URL carries no extension so the packed file always
    ends up with SOME extension the client can content-type."""
    tail = url.rsplit("/", 1)[-1]
    if "." in tail:
        ext = tail.rsplit(".", 1)[-1].split("?", 1)[0].split("#", 1)[0].lower()
        if ext in _IMAGE_CONTENT_TYPES:
            return ext
    return "jpg"


_REFERENCE_URL_PREFIX = "/reference-images/"


def _resolve_image_bytes(species_id: str, url: str) -> bytes | None:
    """AC 5.3.2 filesystem resolver.

    Reads bytes for a ``reference_image_url`` off the local filesystem
    under ``settings.reference_image_root``. The seed shapes URLs like
    ``/reference-images/<species_id_underscored>.jpg`` (see
    ``app/seed.py``); anything not matching that prefix is rejected so
    this resolver can never be tricked into reading arbitrary files.

    Returns ``None`` on any resolution or read failure so the pack
    builder can skip the entry and still emit a valid manifest -
    matching AC 5.3.4's "keep the last valid pack" contract.
    """
    _ = species_id
    if not url:
        return None
    path = urlsplit(url).path or url
    if not path.startswith(_REFERENCE_URL_PREFIX):
        return None
    tail = path[len(_REFERENCE_URL_PREFIX):]
    if not tail or "/" in tail or ".." in tail:
        return None
    root = Path(get_settings().reference_image_root).resolve()
    candidate = (root / tail).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    try:
        return candidate.read_bytes()
    except (FileNotFoundError, IsADirectoryError, PermissionError, OSError):
        return None


def _species_summary(item: Species) -> dict:
    return {
        "species_id": item.id,
        "scientific_name": item.latin_name,
        "accepted_name_usage": item.accepted_name_usage,
        "common_names": list(item.common_names or []),
        "evidence_codes": list(item.evidence_codes or []),
        "evidence_sources": list(item.evidence_sources or []),
        "malaysian_states": list(item.malaysian_states or []),
        "habitat": item.habitat,
        "reference_image_url": item.reference_image_url,
    }


def _species_detail(item: Species) -> dict:
    return {
        **_species_summary(item),
        "identifying_characteristics": item.identifying_characteristics,
        "typical_habitat": item.typical_habitat,
        "documented_impacts": item.documented_impacts,
        "image_attribution": item.image_attribution,
        # AC 5.2.4 - the offline pack must expose the same "not available"
        # flags the online endpoint uses; a client rendering the bestiary
        # offline should never invent a severity assessment either.
        "formal_severity_assessment_available": bool(item.severity_assessment_available),
        "beginner_safe_action_available": bool(item.beginner_safe_action_available),
        "last_reviewed_at": (
            item.last_reviewed_at.date().isoformat() if item.last_reviewed_at else None
        ),
    }


def build_offline_pack(session: Session) -> OfflinePack:
    """Assemble the offline pack for the current catalogue version.

    Rebuilt from the live DB on every call. Contents are serialised
    deterministically so calling this twice yields byte-identical files
    (and therefore identical SHA-256 digests) for the same catalogue
    snapshot - the client uses that stability to skip a redundant
    reinstall.
    """
    manifest = load_evidence_catalogue()
    version_row = session.get(CatalogueVersion, manifest.catalogue_version)
    reviewed_at = version_row.reviewed_at if version_row else manifest.reviewed_at
    total = version_row.total_species_count if version_row else manifest.total_species_count

    species_rows = session.scalars(
        select(Species)
        .where(Species.catalogue_version == manifest.catalogue_version)
        .order_by(Species.id)
    ).all()

    files: list[OfflinePackFile] = []

    # catalogue.json mirrors the online list response so an offline reader
    # can reuse the same rendering code path.
    catalogue_body = {
        "catalogue_version": manifest.catalogue_version,
        "reviewed_at": reviewed_at.isoformat(),
        "total_species_count": total,
        "items": [_species_summary(s) for s in species_rows],
    }
    catalogue_bytes = _canonical_json(catalogue_body)
    files.append(
        OfflinePackFile(
            path="catalogue.json",
            sha256=_sha256_hex(catalogue_bytes),
            byte_size=len(catalogue_bytes),
            content=catalogue_bytes,
        )
    )

    for item in species_rows:
        detail_bytes = _canonical_json(_species_detail(item))
        files.append(
            OfflinePackFile(
                path=f"species/{item.id}.json",
                sha256=_sha256_hex(detail_bytes),
                byte_size=len(detail_bytes),
                content=detail_bytes,
            )
        )

    # AC 5.3.2 - pack reference images alongside the JSON so the bestiary
    # detail card still renders offline. The resolver is a placeholder
    # today (returns None for every URL), which means today's pack ships
    # 0 image files even though the pipeline is wired end-to-end. Any
    # species with a populated ``reference_image_url`` whose bytes we can
    # resolve becomes an ``images/{species_id}.{ext}`` entry with its own
    # SHA-256; the client verifies + caches it the same way as JSON.
    for item in species_rows:
        url = item.reference_image_url
        if not url:
            continue
        image_bytes = _resolve_image_bytes(item.id, url)
        if image_bytes is None:
            continue
        ext = _image_extension(url)
        files.append(
            OfflinePackFile(
                path=f"images/{item.id}.{ext}",
                sha256=_sha256_hex(image_bytes),
                byte_size=len(image_bytes),
                content=image_bytes,
                content_type=_IMAGE_CONTENT_TYPES.get(ext, "application/octet-stream"),
            )
        )

    # Manifest fingerprint is the SHA-256 of the sorted "path\tsha256"
    # lines. The client verifies each file individually against its own
    # digest, so this outer digest is really an "already installed"
    # short-circuit key - one string comparison lets the client skip
    # every per-file fetch when the pack hasn't changed.
    fingerprint_lines = "\n".join(
        f"{f.path}\t{f.sha256}" for f in sorted(files, key=lambda f: f.path)
    ).encode("utf-8")
    manifest_sha = _sha256_hex(fingerprint_lines)
    total_byte_size = sum(f.byte_size for f in files)

    return OfflinePack(
        catalogue_version=manifest.catalogue_version,
        reviewed_at=reviewed_at,
        total_species_count=total,
        # generated_at is stamped for the client's UI, not for the digest
        # (which stays over content only so the pack remains stable
        # across generation times).
        generated_at=datetime.now(timezone.utc),
        files=tuple(files),
        manifest_sha256=manifest_sha,
        total_byte_size=total_byte_size,
    )
