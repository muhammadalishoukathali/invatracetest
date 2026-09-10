"""Bridge between the Iteration 1 31-class classifier and the Iteration 2
32-species evidence catalogue.

The classifier's label space is frozen (the on-device ONNX model was trained
against it); the evidence catalogue is curated independently. The two lists
only overlap on 13 species. When a scan produces a classifier label:

- If the label maps to a ``species_id`` in the evidence catalogue, the
  bestiary / place-discovery / action-guidance UI treats the sighting as a
  first-class catalogue plant.
- Otherwise the scan is still recorded (Iteration 1 flow stays intact) but
  Iteration 2 surfaces mark it ``unsupported_for_catalogue=True`` so we
  never advertise reviewed guidance or evidence for a species we have not
  reviewed.

Isolating the map here means the eventual model swap only needs to update
this file (plus the shared classifier catalogue) to keep the app consistent.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.evidence_catalogue import load_evidence_catalogue

# Classifier model labels (lowercased scientific name, matching the shared
# ``plant-status.json`` ``model_label`` field) → evidence catalogue
# ``species_id``. Only the 13 species present in both lists appear here.
MODEL_LABEL_TO_SPECIES_ID: dict[str, str] = {
    "asclepias curassavica": "asclepias-curassavica",
    "bidens pilosa": "bidens-pilosa",
    "chromolaena odorata": "chromolaena-odorata",
    "eichhornia crassipes": "eichhornia-crassipes",
    "leucaena leucocephala": "leucaena-leucocephala",
    "megathyrsus maximus": "megathyrsus-maximus",
    "mikania micrantha": "mikania-micrantha",
    "mimosa diplotricha": "mimosa-diplotricha",
    "mimosa pigra": "mimosa-pigra",
    "oxalis corniculata": "oxalis-corniculata",
    "parthenium hysterophorus": "parthenium-hysterophorus",
    "psidium guajava": "psidium-guajava",
    "sida acuta": "sida-acuta",
}


@dataclass(frozen=True)
class CatalogueBridgeResult:
    model_label: str
    species_id: str | None
    unsupported_for_catalogue: bool


def resolve_model_label(model_label: str) -> CatalogueBridgeResult:
    """Return the evidence-catalogue mapping for a classifier label."""
    normalized = model_label.strip().lower()
    species_id = MODEL_LABEL_TO_SPECIES_ID.get(normalized)
    if species_id is None:
        return CatalogueBridgeResult(
            model_label=normalized,
            species_id=None,
            unsupported_for_catalogue=True,
        )
    # Guard the map against drift: if someone edits the JSON and drops a
    # species, we want the mismatch to be loud, not silently unsupported.
    catalogue_ids = {r.species_id for r in load_evidence_catalogue().records}
    if species_id not in catalogue_ids:
        raise RuntimeError(
            f"model_to_catalogue map references missing species_id={species_id!r}"
        )
    return CatalogueBridgeResult(
        model_label=normalized,
        species_id=species_id,
        unsupported_for_catalogue=False,
    )
