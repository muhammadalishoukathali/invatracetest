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

Reference images are intentionally out of scope for now: the seed data
does not carry image bytes, and the AC treats optional image bundling
as a follow-up once the catalogue's ``reference_image_url`` field is
populated. When that changes, add an ``images/`` prefix here with the
same per-file SHA + manifest-of-manifests pattern.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CatalogueVersion, Species
from app.domain.evidence_catalogue import load_evidence_catalogue


@dataclass(frozen=True)
class OfflinePackFile:
    path: str
    sha256: str
    byte_size: int
    content: bytes


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
