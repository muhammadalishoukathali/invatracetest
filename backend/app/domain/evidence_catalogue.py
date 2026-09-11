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
class EvidenceSource:
    """AC 5.2.5 - structured source entry rendered by the bestiary drawer.

    ``url_or_id`` is either an absolute URL or the original
    ``evidence_sources`` slug (e.g. ``griis-malaysia-v1_3#91528``). Image
    credit fields (creator / licence) are only populated when the record
    carries an ``image_attribution`` block; otherwise they stay ``None``.
    """

    title: str
    url_or_id: str
    image_creator: str | None
    licence: str | None
    review_date: str | None


@dataclass(frozen=True)
class EvidenceRecord:
    species_id: str
    scientific_name: str
    common_names: tuple[str, ...]
    evidence_codes: tuple[str, ...]
    evidence_sources: tuple[str, ...]
    sources: tuple[EvidenceSource, ...]
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
    # Build an index of the top-level sources block so each per-species
    # evidence_source slug can be resolved into a titled structured entry
    # for AC 5.2.5. Prefer explicit publisher name when the entry has no
    # ``url`` field so the drawer always has something human to render.
    reviewed_at = raw["reviewed_at"]
    source_index: dict[str, dict[str, str | None]] = {}
    for entry in raw.get("sources", []):
        if not isinstance(entry, dict):
            continue
        sid = entry.get("id")
        if not isinstance(sid, str):
            continue
        source_index[sid] = {
            "title": entry.get("title") or entry.get("publisher") or sid,
            "url": entry.get("url"),
            "publisher": entry.get("publisher"),
        }

    def _structured_sources(record: dict) -> tuple[EvidenceSource, ...]:
        # Prefer an explicitly authored per-species ``sources`` block if
        # present (schema-forward compatibility), else derive from the
        # opaque evidence_sources slug list using the top-level index.
        explicit = record.get("sources")
        if isinstance(explicit, list) and explicit:
            out: list[EvidenceSource] = []
            for e in explicit:
                if not isinstance(e, dict):
                    continue
                out.append(
                    EvidenceSource(
                        title=str(e.get("title") or e.get("url_or_id") or ""),
                        url_or_id=str(e.get("url_or_id") or ""),
                        image_creator=e.get("image_creator"),
                        licence=e.get("licence"),
                        review_date=e.get("review_date") or reviewed_at,
                    )
                )
            return tuple(out)
        img_attr = record.get("image_attribution") or {}
        image_creator = (
            img_attr.get("creator") if isinstance(img_attr, dict) else None
        )
        licence = img_attr.get("licence") if isinstance(img_attr, dict) else None
        derived: list[EvidenceSource] = []
        for slug in record.get("evidence_sources", []):
            base = slug.split("#", 1)[0] if isinstance(slug, str) else ""
            meta = source_index.get(base, {})
            derived.append(
                EvidenceSource(
                    title=str(meta.get("title") or base or slug),
                    url_or_id=str(meta.get("url") or slug),
                    image_creator=image_creator,
                    licence=licence,
                    # Species-level last_reviewed_at is not in the JSON per
                    # record today; fall back to the catalogue-wide review
                    # date so the drawer always has one.
                    review_date=record.get("last_reviewed_at") or reviewed_at,
                )
            )
        return tuple(derived)

    records = tuple(
        EvidenceRecord(
            species_id=r["species_id"],
            scientific_name=r["scientific_name"],
            common_names=tuple(r.get("common_names", ())),
            evidence_codes=tuple(r.get("evidence_codes", ())),
            evidence_sources=tuple(r.get("evidence_sources", ())),
            sources=_structured_sources(r),
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
