"""Iteration 2 Phase 10 Wave 2b - direction-aware place association pack importer.

Reads the curated data pack (species registry, dispersal traits, cleaned GBIF
occurrences) produced by the offline data pipeline and upserts it into the
runtime database. Invoked by ``python -m app.cli import-place-association-data``.
"""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import GbifOccurrence, Species, SpeciesDispersalTrait

log = structlog.get_logger("invatrace.place_assoc_import")

SCHEMA_VERSION = "1.0.0"
APPROVED_SPECIES_COUNT = 32
CLEAN_OCCURRENCE_COUNT = 2089

# Rows with unknown or missing coordinate uncertainty are retained for the
# direct/nearby evidence bucket. Direction-eligible waterway upstream evidence
# requires <=1000 m per Phase 10 policy.
MAX_COORDINATE_UNCERTAINTY_M = Decimal("1000")


def _normalise_species_slug(raw: str) -> str:
    """The CSV pack uses underscore-separated slugs (``acacia_auriculiformis``)
    while the seeded ``species`` catalogue uses hyphens (``acacia-auriculiformis``).
    Normalise on the way in so the two agree."""
    return (raw or "").strip().replace("_", "-")


class PackValidationError(RuntimeError):
    """Raised when the data pack fails schema/checksum/registry validation."""


@dataclass
class ImportSummary:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    rejected: int = 0
    reject_reasons: dict[str, int] = field(default_factory=dict)
    manifest_ok: bool = False
    dry_run: bool = False

    def note_reject(self, reason: str) -> None:
        self.rejected += 1
        self.reject_reasons[reason] = self.reject_reasons.get(reason, 0) + 1


def _sha256_of_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_manifest(pack_path: Path) -> dict[str, Any]:
    manifest_path = pack_path / "generated" / "build_manifest.json"
    if not manifest_path.is_file():
        raise PackValidationError(f"missing build_manifest.json at {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise PackValidationError(
            f"unsupported schema_version {manifest.get('schema_version')!r}, "
            f"expected {SCHEMA_VERSION!r}"
        )
    if int(manifest.get("approved_species_count", -1)) != APPROVED_SPECIES_COUNT:
        raise PackValidationError(
            f"approved_species_count {manifest.get('approved_species_count')!r} "
            f"does not match expected {APPROVED_SPECIES_COUNT}"
        )
    if int(manifest.get("clean_occurrence_count", -1)) != CLEAN_OCCURRENCE_COUNT:
        raise PackValidationError(
            f"clean_occurrence_count {manifest.get('clean_occurrence_count')!r} "
            f"does not match expected {CLEAN_OCCURRENCE_COUNT}"
        )
    return manifest


def _verify_manifest_shas(pack_path: Path, manifest: dict[str, Any]) -> None:
    files = manifest.get("files", {})
    if not files:
        raise PackValidationError("manifest lacks a `files` section")
    for rel, meta in files.items():
        expected = meta.get("sha256")
        target = pack_path / "generated" / rel
        if not target.is_file():
            raise PackValidationError(f"manifest references missing file {rel}")
        actual = _sha256_of_file(target)
        if actual != expected:
            raise PackValidationError(
                f"sha256 mismatch for {rel}: expected {expected}, got {actual}"
            )


def _parse_bool(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"true", "1", "yes", "y", "t"}


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        # Handle date-only or ISO date-time
        if "T" in value:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_optional_decimal(value: str | None) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(value)
    except Exception:  # noqa: BLE001
        return None


def _validate_species_registry(session: Session, pack_path: Path) -> set[str]:
    registry_path = pack_path / "data" / "species_taxon_registry.csv"
    with registry_path.open() as fh:
        reader = csv.DictReader(fh)
        registry_ids = [_normalise_species_slug(row["species_id"]) for row in reader]
    if len(registry_ids) != APPROVED_SPECIES_COUNT:
        raise PackValidationError(
            f"species_taxon_registry.csv has {len(registry_ids)} rows, "
            f"expected {APPROVED_SPECIES_COUNT}"
        )
    existing = {
        s for s, in session.execute(select(Species.id).where(Species.id.in_(registry_ids)))
    }
    missing = sorted(set(registry_ids) - existing)
    if missing:
        raise PackValidationError(
            f"{len(missing)} species from registry missing in DB: {missing}"
        )
    return set(registry_ids)


def _upsert_dispersal_traits(
    session: Session,
    pack_path: Path,
    known_species: set[str],
    *,
    dry_run: bool,
) -> tuple[int, int]:
    traits_path = pack_path / "data" / "species_dispersal_traits.csv"
    inserted = 0
    updated = 0
    with traits_path.open() as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            species_id = _normalise_species_slug(row["species_id"])
            if species_id not in known_species:
                raise PackValidationError(
                    f"unknown species_id {species_id!r} in species_dispersal_traits.csv"
                )
            spread = [s for s in (row.get("spread_mechanisms") or "").split("|") if s]
            payload = {
                "species_id": species_id,
                "spread_mechanisms": spread,
                "primary_mechanism": row.get("primary_mechanism") or None,
                "waterway_direction_eligible": _parse_bool(
                    row.get("waterway_direction_eligible")
                ),
                "waterway_evidence_type": row.get("waterway_evidence_type") or None,
                "evidence_strength": row.get("evidence_strength") or None,
                "source_title": row.get("source_title") or None,
                "source_organisation": row.get("source_organisation") or None,
                "source_url": row.get("source_url") or None,
                "evidence_summary": row.get("evidence_summary") or None,
                "reviewed_at": _parse_date(row.get("reviewed_at")),
            }
            if dry_run:
                inserted += 1
                continue
            # The species_dispersal_traits.spread_mechanisms column is TEXT[]
            # on postgres but the ORM model uses JSON_TYPE (which the psycopg
            # dialect sends as JSONB). Bypass the ORM and use a parameterised
            # SQL upsert with an explicit ::text[] cast so the two agree.
            exists = session.execute(
                text(
                    "SELECT 1 FROM species_dispersal_traits WHERE species_id = :sid"
                ),
                {"sid": species_id},
            ).first()
            session.execute(
                text(
                    """
                    INSERT INTO species_dispersal_traits (
                        species_id, spread_mechanisms, primary_mechanism,
                        waterway_direction_eligible, waterway_evidence_type,
                        evidence_strength, source_title, source_organisation,
                        source_url, evidence_summary, reviewed_at,
                        created_at, updated_at
                    ) VALUES (
                        :species_id, CAST(:spread AS text[]), :primary_mechanism,
                        :waterway_direction_eligible, :waterway_evidence_type,
                        :evidence_strength, :source_title, :source_organisation,
                        :source_url, :evidence_summary, :reviewed_at,
                        NOW(), NOW()
                    )
                    ON CONFLICT (species_id) DO UPDATE SET
                        spread_mechanisms = EXCLUDED.spread_mechanisms,
                        primary_mechanism = EXCLUDED.primary_mechanism,
                        waterway_direction_eligible = EXCLUDED.waterway_direction_eligible,
                        waterway_evidence_type = EXCLUDED.waterway_evidence_type,
                        evidence_strength = EXCLUDED.evidence_strength,
                        source_title = EXCLUDED.source_title,
                        source_organisation = EXCLUDED.source_organisation,
                        source_url = EXCLUDED.source_url,
                        evidence_summary = EXCLUDED.evidence_summary,
                        reviewed_at = EXCLUDED.reviewed_at,
                        updated_at = NOW()
                    """
                ),
                {
                    **{k: v for k, v in payload.items() if k != "spread_mechanisms"},
                    "spread": payload["spread_mechanisms"],
                },
            )
            if exists:
                updated += 1
            else:
                inserted += 1
    # NOTE: commit deferred to import_place_association_pack() so trait +
    # occurrence upsert is a single atomic transaction. If the occurrence
    # phase raises, the trait writes must roll back with it.
    return inserted, updated


def _current_catalogue_version(session: Session) -> str:
    ver = session.scalar(
        select(Species.catalogue_version)
        .where(Species.catalogue_version.is_not(None))
        .limit(1)
    )
    return ver or "v2026-09-08"


def _import_occurrences(
    session: Session,
    pack_path: Path,
    known_species: set[str],
    manifest: dict[str, Any],
    *,
    dry_run: bool,
    summary: ImportSummary,
) -> None:
    occ_path = pack_path / "generated" / "occurrences_clean.csv"
    catalogue_version = _current_catalogue_version(session)
    generated_at = manifest.get("generated_at_utc", "")
    processed_data_version = generated_at.split("T")[0] if generated_at else "unknown"

    seen_record_uids: set[str] = set()
    payloads: list[dict[str, Any]] = []

    with occ_path.open() as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            record_uid = (row.get("record_uid") or "").strip()
            if not record_uid:
                summary.note_reject("missing_record_uid")
                continue
            if row.get("country_code") != "MY":
                summary.note_reject("country_code_not_MY")
                continue
            species_id = _normalise_species_slug(row.get("species_id") or "")
            if species_id not in known_species:
                summary.note_reject("unknown_species")
                continue
            coord_unc = _parse_optional_decimal(row.get("coordinate_uncertainty_m"))
            if coord_unc is not None and coord_unc > MAX_COORDINATE_UNCERTAINTY_M:
                summary.note_reject("coord_uncertainty_gt_1000m")
                continue
            if record_uid in seen_record_uids:
                summary.note_reject("duplicate_record_uid_in_file")
                continue
            seen_record_uids.add(record_uid)

            lat = _parse_optional_decimal(row.get("decimal_latitude"))
            lon = _parse_optional_decimal(row.get("decimal_longitude"))
            if lat is None or lon is None:
                summary.note_reject("missing_coordinates")
                continue

            payloads.append(
                {
                    "record_uid": record_uid,
                    "species_id": species_id,
                    "source": (row.get("source_name") or "gbif").lower(),
                    "source_occurrence_id": row.get("source_record_id") or record_uid,
                    "country_code": "MY",
                    "occurrence_status": "PRESENT",
                    "latitude": lat,
                    "longitude": lon,
                    "coordinate_uncertainty_m": coord_unc,
                    "event_year": int(row["year"]) if row.get("year") else None,
                    "event_date": _parse_date(row.get("event_date")),
                    "catalogue_version": catalogue_version,
                    "dataset_name": row.get("dataset_name") or None,
                    "dataset_key": row.get("dataset_key") or None,
                    "licence": row.get("licence") or None,
                    "source_url": row.get("source_url") or None,
                    "basis_of_record": row.get("basis_of_record") or None,
                    "state_province": row.get("state_province") or None,
                    "locality": row.get("locality") or None,
                    "eligible_for_waterway_direction": _parse_bool(
                        row.get("eligible_for_waterway_direction")
                    ),
                    "processed_data_version": processed_data_version,
                }
            )

    if dry_run:
        summary.inserted = len(payloads)
        return

    # Bulk upsert on record_uid. On postgres, use ON CONFLICT.
    table = GbifOccurrence.__table__
    BATCH = 500
    for i in range(0, len(payloads), BATCH):
        chunk = payloads[i : i + BATCH]
        stmt = pg_insert(table).values(chunk)
        update_cols = {
            c.name: stmt.excluded[c.name]
            for c in table.columns
            if c.name
            not in {"id", "location", "ingested_at", "record_uid"}
        }
        stmt = stmt.on_conflict_do_update(
            index_elements=["record_uid"], set_=update_cols
        )
        result = session.execute(stmt)
        # rowcount reflects inserted+updated. We can't easily distinguish
        # without an extra query per row - approximate as inserted for the
        # first run, updated otherwise, based on pre-existing count.
        if result.rowcount is not None:
            summary.inserted += result.rowcount
    # commit performed by import_place_association_pack() after both trait
    # + occurrence phases succeed (atomic pack import).


def import_place_association_pack(
    session: Session,
    pack_path: Path,
    *,
    dry_run: bool = False,
) -> ImportSummary:
    """Public entry point invoked by the CLI. Returns a summary suitable for
    printing."""
    summary = ImportSummary(dry_run=dry_run)
    manifest = _load_manifest(pack_path)
    _verify_manifest_shas(pack_path, manifest)
    summary.manifest_ok = True
    known_species = _validate_species_registry(session, pack_path)
    traits_inserted, traits_updated = _upsert_dispersal_traits(
        session, pack_path, known_species, dry_run=dry_run
    )
    log.info(
        "dispersal_traits_upserted",
        inserted=traits_inserted,
        updated=traits_updated,
        dry_run=dry_run,
    )
    try:
        _import_occurrences(
            session,
            pack_path,
            known_species,
            manifest,
            dry_run=dry_run,
            summary=summary,
        )
    except Exception:
        if not dry_run:
            session.rollback()
        raise
    if not dry_run:
        session.commit()
    log.info(
        "occurrence_import_summary",
        inserted=summary.inserted,
        rejected=summary.rejected,
        reject_reasons=summary.reject_reasons,
        dry_run=dry_run,
    )
    return summary
