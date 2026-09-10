"""Loader for the Iteration 2 evidence-confirmed 32-species catalogue.

Kept separate from ``app.domain.catalogue`` (which speaks to the Iteration 1
31-class model catalogue under ``shared/catalogue/``) so the two never bleed
into each other. Consumers:

- ``app.seed`` upserts every record into ``species`` on boot so the new
  ``/api/v1/catalogue`` endpoint has something to return.
- ``app.api.routers.catalogue`` reads the manifest fields (version, reviewed
  date, count) to surface alongside the species list.
- ``app.domain.model_to_catalogue`` maps a 31-class classifier label to a
  ``species_id`` in this list, or flags it as unsupported for the evidence
  catalogue when the classifier's label is not in the evidence 32.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "invasive_plants_my_v2026_09.json"


@dataclass(frozen=True)
class EvidenceRecord:
    species_id: str
    scientific_name: str
    common_names: tuple[str, ...]
    evidence_codes: tuple[str, ...]
    evidence_sources: tuple[str, ...]
    malaysian_states: tuple[str, ...]
    habitat: str
    accepted_name_usage: str | None


@dataclass(frozen=True)
class EvidenceCatalogue:
    catalogue_version: str
    reviewed_at: date
    total_species_count: int
    notes: str
    records: tuple[EvidenceRecord, ...]


class EvidenceCatalogueError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_evidence_catalogue() -> EvidenceCatalogue:
    if not DATA_PATH.is_file():
        raise EvidenceCatalogueError(f"Missing evidence catalogue: {DATA_PATH}")
    raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    records = tuple(
        EvidenceRecord(
            species_id=r["species_id"],
            scientific_name=r["scientific_name"],
            common_names=tuple(r.get("common_names", ())),
            evidence_codes=tuple(r.get("evidence_codes", ())),
            evidence_sources=tuple(r.get("evidence_sources", ())),
            malaysian_states=tuple(r.get("malaysian_states", ())),
            habitat=r.get("habitat", "terrestrial"),
            accepted_name_usage=r.get("accepted_name_usage"),
        )
        for r in raw["records"]
    )
    declared = int(raw["total_species_count"])
    if declared != len(records):
        raise EvidenceCatalogueError(
            f"total_species_count={declared} does not match {len(records)} records"
        )
    ids = [r.species_id for r in records]
    if len(set(ids)) != len(ids):
        raise EvidenceCatalogueError("duplicate species_id in evidence catalogue")
    return EvidenceCatalogue(
        catalogue_version=raw["catalogue_version"],
        reviewed_at=date.fromisoformat(raw["reviewed_at"]),
        total_species_count=declared,
        notes=raw.get("notes", ""),
        records=records,
    )
