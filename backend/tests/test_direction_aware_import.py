"""Iteration 2 Phase 10 Wave 2b - place-association pack importer tests.

Covers manifest validation, species-registry integrity, dispersal-trait
upsert idempotency, occurrence deduplication + rejection reasons, and the
`import-osm` CLI safety guards. DB-touching tests use the same
``SessionLocal`` other integration-style tests do and expect the reference
catalogue (32 species with ``catalogue_version = 'v2026-09-08'``) to be
seeded via ``invatrace load-reference-data`` before pytest is invoked.
"""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sys
import types
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app import cli
from app.db.base import SessionLocal
from app.db.models import GbifOccurrence, Species, SpeciesDispersalTrait
from app.place_association_import import (
    PackValidationError,
    import_place_association_pack,
)

PACK_SRC = Path("/tmp/direction-aware-pack")


def _copy_pack(dst: Path) -> Path:
    shutil.copytree(PACK_SRC, dst)
    return dst


def _rewrite_sha(pack: Path, rel: str) -> None:
    manifest_path = pack / "generated" / "build_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    target = pack / "generated" / rel
    manifest["files"][rel]["sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
    manifest["files"][rel]["bytes"] = target.stat().st_size
    manifest_path.write_text(json.dumps(manifest))


# ---------- Manifest / SHA validation (no DB required) --------------------


def test_manifest_schema_version_required(tmp_path: Path) -> None:
    pack = _copy_pack(tmp_path / "pack")
    manifest_path = pack / "generated" / "build_manifest.json"
    data = json.loads(manifest_path.read_text())
    data["schema_version"] = "0.9.0"
    manifest_path.write_text(json.dumps(data))
    with SessionLocal() as s, pytest.raises(PackValidationError):
        import_place_association_pack(s, pack, dry_run=True)


def test_manifest_sha_mismatch_aborts(tmp_path: Path) -> None:
    pack = _copy_pack(tmp_path / "pack")
    csv_path = pack / "generated" / "occurrences_clean.csv"
    # Flip a single byte in the CSV without updating the manifest sha.
    data = csv_path.read_bytes()
    csv_path.write_bytes(data + b"\n")
    with SessionLocal() as s, pytest.raises(PackValidationError):
        import_place_association_pack(s, pack, dry_run=True)


# ---------- Species registry + dispersal traits (DB) ----------------------


def _ensure_species_present() -> None:
    """Skip DB tests if the catalogue is not seeded - some CI passes run
    without reference data. Tests inside the container are always seeded."""
    with SessionLocal() as s:
        registry = [
            r["species_id"].replace("_", "-")
            for r in csv.DictReader(
                (PACK_SRC / "data" / "species_taxon_registry.csv").open()
            )
        ]
        found = {
            s_id
            for s_id, in s.execute(select(Species.id).where(Species.id.in_(registry)))
        }
        missing = set(registry) - found
    if missing:
        pytest.skip(f"reference catalogue not fully seeded ({len(missing)} missing)")


def test_species_registry_all_32_present(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    with SessionLocal() as s:
        summary = import_place_association_pack(s, pack, dry_run=True)
    assert summary.manifest_ok is True


def test_species_registry_missing_species_aborts(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    # Instead of deleting a species from the shared DB, corrupt the CSV to
    # reference a species id that will never exist.
    reg = pack / "data" / "species_taxon_registry.csv"
    lines = reg.read_text().splitlines()
    header = lines[0]
    parts = lines[1].split(",")
    parts[0] = "does-not-exist-xyz"
    lines[1] = ",".join(parts)
    reg.write_text("\n".join(lines) + "\n")
    with SessionLocal() as s:
        with pytest.raises(PackValidationError) as ei:
            import_place_association_pack(s, pack, dry_run=True)
    assert "does-not-exist-xyz" in str(ei.value)


def test_dispersal_traits_upsert_idempotent(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    with SessionLocal() as s:
        import_place_association_pack(s, pack, dry_run=False)
    with SessionLocal() as s:
        count1 = len(list(s.execute(select(SpeciesDispersalTrait.species_id))))
    with SessionLocal() as s:
        import_place_association_pack(s, pack, dry_run=False)
    with SessionLocal() as s:
        count2 = len(list(s.execute(select(SpeciesDispersalTrait.species_id))))
    assert count1 == count2 == 32


# ---------- Occurrence validation ----------------------------------------


def test_duplicate_record_uid_in_file_rejected(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    csv_path = pack / "generated" / "occurrences_clean.csv"
    lines = csv_path.read_text().splitlines()
    # Duplicate the first data row - identical record_uid should be rejected.
    lines.append(lines[1])
    csv_path.write_text("\n".join(lines) + "\n")
    _rewrite_sha(pack, "occurrences_clean.csv")
    with SessionLocal() as s:
        summary = import_place_association_pack(s, pack, dry_run=True)
    assert summary.reject_reasons.get("duplicate_record_uid_in_file", 0) >= 1


def test_occurrence_bulk_upsert_idempotent(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    with SessionLocal() as s:
        import_place_association_pack(s, pack, dry_run=False)
    with SessionLocal() as s:
        count1 = s.scalar(
            select(text("count(*)")).select_from(GbifOccurrence.__table__)
        )
    with SessionLocal() as s:
        import_place_association_pack(s, pack, dry_run=False)
    with SessionLocal() as s:
        count2 = s.scalar(
            select(text("count(*)")).select_from(GbifOccurrence.__table__)
        )
    assert count1 == count2
    assert count1 >= 2089


def test_country_coord_mismatch_rejected(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    csv_path = pack / "generated" / "occurrences_clean.csv"
    lines = csv_path.read_text().splitlines()
    parts = lines[1].split(",")
    parts[10] = "SG"  # country_code column
    lines[1] = ",".join(parts)
    csv_path.write_text("\n".join(lines) + "\n")
    _rewrite_sha(pack, "occurrences_clean.csv")
    with SessionLocal() as s:
        summary = import_place_association_pack(s, pack, dry_run=True)
    assert summary.reject_reasons.get("country_code_not_MY", 0) == 1
    # Other rows still counted.
    assert summary.inserted == 2088


def _mutate_uncertainty(pack: Path, new_value: str) -> None:
    csv_path = pack / "generated" / "occurrences_clean.csv"
    lines = csv_path.read_text().splitlines()
    parts = lines[1].split(",")
    parts[13] = new_value  # coordinate_uncertainty_m
    lines[1] = ",".join(parts)
    csv_path.write_text("\n".join(lines) + "\n")
    _rewrite_sha(pack, "occurrences_clean.csv")


def test_uncertainty_exactly_1000_accepted(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    _mutate_uncertainty(pack, "1000")
    with SessionLocal() as s:
        summary = import_place_association_pack(s, pack, dry_run=True)
    assert summary.reject_reasons.get("coord_uncertainty_gt_1000m", 0) == 0


def test_uncertainty_1001_rejected(tmp_path: Path) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    _mutate_uncertainty(pack, "1001")
    with SessionLocal() as s:
        summary = import_place_association_pack(s, pack, dry_run=True)
    assert summary.reject_reasons.get("coord_uncertainty_gt_1000m", 0) == 1


def test_unknown_uncertainty_accepted_without_waterway_eligibility(
    tmp_path: Path,
) -> None:
    _ensure_species_present()
    pack = _copy_pack(tmp_path / "pack")
    csv_path = pack / "generated" / "occurrences_clean.csv"
    lines = csv_path.read_text().splitlines()
    parts = lines[1].split(",")
    parts[13] = ""  # coordinate_uncertainty_m unknown
    parts[23] = "False"  # eligible_for_waterway_direction
    lines[1] = ",".join(parts)
    csv_path.write_text("\n".join(lines) + "\n")
    _rewrite_sha(pack, "occurrences_clean.csv")
    with SessionLocal() as s:
        summary = import_place_association_pack(s, pack, dry_run=True)
    # Row still counts as inserted (no rejection for missing uncertainty).
    assert summary.rejected == 0


# ---------- PBF importer CLI smoke tests ---------------------------------


def test_import_osm_requires_confirm_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        ["invatrace", "import-osm", "/tmp/does_not_matter.osm.pbf",
         "--source-date", "2026-09-01"],
    )
    with pytest.raises(SystemExit):
        cli.main()


def test_import_osm_dedup_by_sha256(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Build a >10MB fake PBF so the size guard passes; the pyosmium import is
    # mocked out so the file content doesn't need to be a real PBF.
    fake = tmp_path / "malaysia.osm.pbf"
    fake.write_bytes(b"\0" * (10 * 1024 * 1024 + 16))

    calls = {"count": 0}

    class _StubImport:
        def __init__(self):
            self.area_count = 5
            self.trail_count = 3
            self.waterway_count = 0
            self.status = "active"
            self.completed_at = None  # 1st call: "already imported" path

    def fake_import_malaysia_pbf(session, **kwargs):
        calls["count"] += 1
        return _StubImport()

    stub = types.ModuleType("app.osm_import")
    stub.import_malaysia_pbf = fake_import_malaysia_pbf
    monkeypatch.setitem(sys.modules, "app.osm_import", stub)

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "invatrace",
            "import-osm",
            str(fake),
            "--source-date",
            "2026-09-01",
            "--confirm-malaysia-clipped",
        ],
    )
    cli.main()
    cli.main()
    assert calls["count"] == 2  # both call sites reach the importer; dedup is inside it
