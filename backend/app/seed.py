from __future__ import annotations

import json
import math
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MonitoredPlace, Report, Sighting, Species

SPECIES = [
    {
        "id": "mikania-micrantha",
        "name": "Mikania micrantha",
        "latin_name": "Mikania micrantha",
        "common_names": ["Mile-a-minute weed", "Chinese creeper"],
        "is_invasive": True,
        "risk": "high",
        "traits": [
            {"label": "Leaf shape", "value": "Heart-shaped, opposite, 5–13 cm"},
            {"label": "Flower", "value": "Small white heads in dense clusters"},
            {"label": "Growth", "value": "Climbing vine, up to 27 mm per day"},
            {"label": "Stem", "value": "Ridged, green to brown, hairy at nodes"},
        ],
        "native_twin": {
            "id": "dicranopteris-linearis",
            "name": "Resam fern",
            "latinName": "Dicranopteris linearis",
            "distinguishingTraits": [
                "Resam is a fern with forked fronds, not a vine",
                "No heart-shaped leaves",
                "Does not climb or smother other plants",
            ],
        },
        "removal_steps": [
            {"order": 1, "action": "Cut the vine at ground level", "safe": True},
            {"order": 2, "action": "Pull roots carefully if soil is moist", "safe": True},
            {"order": 3, "action": "Bag all cut material — fragments can re-root", "safe": True},
            {"order": 4, "action": "Check back in 2–3 weeks for regrowth", "safe": True},
        ],
        "do_not_do": [
            "Do not compost — viable fragments will re-establish",
            "Do not leave cut material on soil",
        ],
        "detail_available": True,
        "reportable": True,
        "action_guides": [
            {
                "actionMode": "remove",
                "title": "Cut, bag, and prevent re-rooting",
                "summary": "Cut at ground level, remove roots only when safe, and bag every fragment.",
                "validMonths": list(range(1, 13)),
                "steps": [
                    {"order": 1, "action": "Cut the vine at ground level", "safe": True},
                    {"order": 2, "action": "Pull roots carefully if soil is moist", "safe": True},
                    {
                        "order": 3,
                        "action": "Bag all cut material — fragments can re-root",
                        "safe": True,
                    },
                    {"order": 4, "action": "Check back in 2–3 weeks for regrowth", "safe": True},
                ],
                "doNotDo": [
                    "Do not compost or leave cut fragments on soil",
                    "Do not pull above unstable ground or steep edges",
                ],
                "ppe": ["Gloves", "Covered footwear", "Long sleeves"],
                "decontamination": ["Remove plant fragments from tools and boots before leaving"],
                "revision": "field-guide-2026-08-automated-v1",
            }
        ],
    },
    {
        "id": "chromolaena-odorata",
        "name": "Siam weed",
        "latin_name": "Chromolaena odorata",
        "common_names": ["Siam weed", "Devil weed"],
        "is_invasive": True,
        "risk": "high",
        "traits": [
            {"label": "Leaf shape", "value": "Opposite, ovate, 5–12 cm with serrated edges"},
            {"label": "Flower", "value": "Pale purple to white, in terminal clusters"},
            {"label": "Growth", "value": "Woody shrub or scrambler, 2–5 m"},
            {"label": "Stem", "value": "Soft-wooded, hairy, strong odour when crushed"},
        ],
        "native_twin": None,
        "removal_steps": [
            {"order": 1, "action": "Cut stems close to ground before flowering", "safe": True},
            {"order": 2, "action": "Remove root crown to prevent re-sprouting", "safe": True},
            {"order": 3, "action": "Bag and dispose of all flowering parts", "safe": True},
        ],
        "do_not_do": [
            "Do not slash during seed season — seeds spread by wind",
            "Do not burn on-site without permit",
        ],
        "detail_available": True,
        "reportable": False,
        "action_guides": [
            {
                "actionMode": "contain",
                "title": "Contain only when no seed can spread",
                "summary": "Do not slash flowering or seed-bearing plants. Bag flowering material and remove the root crown only when conditions are safe.",
                "validMonths": list(range(1, 13)),
                "steps": [
                    {
                        "order": 1,
                        "action": "Check carefully for flowers or seed heads",
                        "safe": True,
                    },
                    {"order": 2, "action": "Bag flowering parts before cutting", "safe": True},
                    {
                        "order": 3,
                        "action": "Remove the root crown to prevent re-sprouting",
                        "safe": True,
                    },
                ],
                "doNotDo": [
                    "Do not slash flowering or seed-bearing plants",
                    "Do not burn on-site without a permit",
                ],
                "ppe": ["Gloves", "Covered footwear", "Long sleeves"],
                "decontamination": [
                    "Clean seeds and plant fragments from tools, clothing, and boots"
                ],
                "revision": "field-guide-2026-08-automated-v1",
            }
        ],
    },
    {
        "id": "eichhornia-crassipes",
        "name": "Water hyacinth",
        "latin_name": "Eichhornia crassipes",
        "common_names": [],
        "is_invasive": True,
        "risk": "high",
        "traits": [],
        "native_twin": None,
        "removal_steps": [],
        "do_not_do": [],
        "detail_available": False,
        "reportable": False,
        "action_guides": [],
    },
    {
        "id": "dicranopteris-linearis",
        "name": "Resam fern",
        "latin_name": "Dicranopteris linearis",
        "common_names": [],
        "is_invasive": False,
        "risk": None,
        "traits": [],
        "native_twin": None,
        "removal_steps": [],
        "do_not_do": [],
        "detail_available": False,
        "reportable": False,
        "action_guides": [],
    },
]


def _apply_model_catalog_to_species_seed() -> None:
    catalog_path = Path(__file__).with_name("data") / "pulih_model1_species_31.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    detailed_by_id = {item["id"]: item for item in SPECIES}
    model_species: list[dict[str, object]] = []

    for model_class in catalog["classes"]:
        species_id = model_class["machine_label"].replace("_", "-")
        invasive = model_class["malaysia_status"] == "invasive"
        detail = detailed_by_id.get(species_id, {
            "common_names": [],
            "traits": [],
            "native_twin": None,
            "removal_steps": [],
            "do_not_do": [],
            "detail_available": False,
            "action_guides": [],
        })
        reportable = bool(detail.get("reportable", False)) and invasive
        detail.update({
            "id": species_id,
            "name": model_class["display_name"],
            "latin_name": model_class["scientific_name"],
            "is_invasive": invasive,
            "risk": "high" if invasive else None,
            "reportable": reportable,
        })
        model_species.append(detail)

    if len(model_species) != catalog["class_count"]:
        raise ValueError("Development species seed does not match the PULIH model catalogue.")
    SPECIES[:] = model_species


_apply_model_catalog_to_species_seed()

PLACES = [
    ("Bukit Kiara · West Trail", 3.1497, 101.6412),
    ("Bukit Kiara · Look-out", 3.1523, 101.6440),
    ("Bukit Kiara · Picnic Area", 3.1489, 101.6398),
    ("Bukit Kiara · Ridge Path", 3.1516, 101.6371),
    ("Taman Tugu · Pond edge", 3.1502, 101.6688),
    ("Bukit Nanas · Reserve entrance", 3.1521, 101.7020),
    ("FRIM Kepong · Canopy walk", 3.2340, 101.6293),
    ("KLCC Park · East pond", 3.1570, 101.7145),
    ("Kota Damansara Community Forest", 3.1691, 101.5900),
    ("Bukit Gasing · North gate", 3.1044, 101.6538),
]

SIGHTING_SEED = [
    ("mikania-micrantha", "screened", "high", 0.0032, 0.2),
    ("mikania-micrantha", "screened", "high", 0.0025, 1.1),
    ("mikania-micrantha", "screened", "high", 0.0041, 2.4),
    ("chromolaena-odorata", "screened", "high", 0.0018, 3.6),
    ("chromolaena-odorata", "screened", "high", 0.0037, 4.7),
    ("eichhornia-crassipes", "screened", "high", 0.0028, 5.9),
    ("eichhornia-crassipes", "screened", "high", 0.0045, 0.9),
    ("lantana-camara", "screened", "high", 0.0022, 2.0),
    ("lantana-camara", "screened", "high", 0.0033, 3.1),
    ("mikania-micrantha", "removed", "high", 0.0016, 4.2),
]

LEGACY_SEED_SPECIES_IDS = {"clidemia-hirta"}


def seed_development_data(session: Session) -> None:
    for values in SPECIES:
        existing = session.get(Species, values["id"])
        if existing:
            for key, value in values.items():
                setattr(existing, key, value)
        else:
            session.add(Species(**values))
    session.flush()
    for name, latitude, longitude in PLACES:
        if not session.scalar(select(MonitoredPlace.id).where(MonitoredPlace.name == name)):
            session.add(
                MonitoredPlace(
                    name=name,
                    latitude=Decimal(str(latitude)),
                    longitude=Decimal(str(longitude)),
                )
            )
    centre_lat, centre_lng = 3.1497, 101.6412
    actions = {
        "screened": "Rule-screened report. Follow the reviewed guidance for this species.",
        "removed": "Removal recorded. Recheck for regrowth in 2–3 weeks.",
    }
    for index, (species_id, status, risk, radius, angle) in enumerate(SIGHTING_SEED):
        sighting_id = uuid.uuid5(uuid.NAMESPACE_URL, f"invatrace-seed-sighting-{index + 1}")
        values = {
            "species_id": species_id,
            "status": status,
            "risk": risk,
            "latitude": Decimal(str(round(centre_lat + math.sin(angle) * radius, 5))),
            "longitude": Decimal(str(round(centre_lng + math.cos(angle) * radius, 5))),
            "reporter_trust": "Trusted",
            "recommended_action": actions[status],
            "place_label": PLACES[index][0],
        }
        existing = session.get(Sighting, sighting_id)
        if existing:
            for key, value in values.items():
                setattr(existing, key, value)
        else:
            session.add(Sighting(
                id=sighting_id,
                created_at=datetime.now(UTC) - timedelta(hours=index + 1),
                **values,
            ))
    session.flush()
    for species_id in LEGACY_SEED_SPECIES_IDS:
        species = session.get(Species, species_id)
        has_sighting = session.scalar(
            select(Sighting.id).where(Sighting.species_id == species_id).limit(1)
        )
        has_report = session.scalar(
            select(Report.id).where(Report.species_id == species_id).limit(1)
        )
        if species and not has_sighting and not has_report:
            session.delete(species)
    session.commit()
