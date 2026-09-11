"""Idempotent development/demo data seed.

Populates species records (merged with the PULIH classifier's 31-class
catalog), a handful of Kuala Lumpur monitored places, and a few sample
sightings so a fresh dev database isn't just empty. Run via `invatrace
seed` (see app/cli.py). Safe to run repeatedly - existing rows get
updated in place rather than duplicated, matched by id/name.
"""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CatalogueVersion,
    GbifOccurrence,
    MonitoredArea,
    MonitoredPlace,
    ProtectedArea,
    Report,
    Sighting,
    Species,
    Waterway,
)
from app.domain.catalogue import load_manifest, load_status_records
from app.domain.evidence_catalogue import load_evidence_catalogue

# Citation metadata attached to each species' guidance_metadata.sources - shown
# to the user so the "this plant is invasive" claim isn't just asserted, it's
# traceable back to GRIIS/MyBIS.
_MIKANIA_SOURCES = [
    {
        "id": "griis-malaysia-v1_3",
        "title": "GRIIS Malaysia v1.3",
        "publisher": "GBIF / IUCN SSC Invasive Species Specialist Group",
        "url": "https://cloud.gbif.org/griis/resource?r=griis-malaysia&v=1.3",
        "accessed": "2026-08-27",
    },
    {
        "id": "myias-2025",
        "title": "MyBIS Invasive Alien Species (MyIAS) 2025",
        "publisher": "Malaysia Biodiversity Information System",
        "url": "https://www.mybis.gov.my/ias/resources.php?menu=98",
        "accessed": "2026-08-27",
    },
]
_CHROMOLAENA_SOURCES = _MIKANIA_SOURCES
_EICHHORNIA_SOURCES = _MIKANIA_SOURCES

_REVIEW_DATE = datetime(2026, 8, 27, tzinfo=UTC)
_GUIDANCE_VERSION = "invatrace-plant-guidance-v1"

# Hand-written, fully fleshed-out entries for the four species we have proper
# field-guide content for (removal steps, look-alikes, etc). Everything else
# comes from the model catalog below and only gets bare-bones detail -
# _apply_model_catalog_to_species_seed() merges the two, keeping these entries
# where they already exist by id.
SPECIES = [
    {
        "id": "mikania-micrantha",
        "name": "Mikania micrantha",
        "latin_name": "Mikania micrantha",
        "common_names": ["Mile-a-minute weed", "Chinese creeper"],
        "is_invasive": True,
        "risk": "high",
        "malaysia_status": "invasive",
        "status_source": "GRIIS Malaysia v1.3",
        "status_reviewed_at": _REVIEW_DATE,
        "general_information": (
            "Fast-growing climbing vine that smothers native vegetation. Listed as invasive"
            " in Malaysia; small manual removal is safe when done with care."
        ),
        "action_eligible": True,
        "guidance_content_version": _GUIDANCE_VERSION,
        "guidance_last_reviewed": _REVIEW_DATE,
        "guidance_metadata": {
            "stop_conditions": [
                "You are on private, protected, or unfamiliar land without permission",
                "The vine has climbed above chest height or wraps mature trees",
                "Fragments would fall into flowing water",
            ],
            "spread_prevention": [
                "Bag every cut fragment before leaving the site",
                "Clean tools, gloves, and boots before moving to a new area",
                "Do not compost - even small pieces can re-root",
            ],
            "prohibited_actions": [
                "Do not burn plant material on-site",
                "Do not apply herbicide without a licensed operator",
            ],
            "sources": _MIKANIA_SOURCES,
        },
        "traits": [
            {"label": "Leaf shape", "value": "Heart-shaped, opposite, 5-13 cm"},
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
            {"order": 3, "action": "Bag all cut material - fragments can re-root", "safe": True},
            {"order": 4, "action": "Check back in 2-3 weeks for regrowth", "safe": True},
        ],
        "do_not_do": [
            "Do not compost - viable fragments will re-establish",
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
                        "action": "Bag all cut material - fragments can re-root",
                        "safe": True,
                    },
                    {"order": 4, "action": "Check back in 2-3 weeks for regrowth", "safe": True},
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
        "malaysia_status": "invasive",
        "status_source": "GRIIS Malaysia v1.3",
        "status_reviewed_at": _REVIEW_DATE,
        "general_information": (
            "Woody shrub or scrambler that spreads by wind-borne seeds. Do not disturb"
            " flowering or seed-bearing plants."
        ),
        "action_eligible": True,
        "guidance_content_version": _GUIDANCE_VERSION,
        "guidance_last_reviewed": _REVIEW_DATE,
        "guidance_metadata": {
            "stop_conditions": [
                "Flowers or seed heads are visible on the plant",
                "The site is a park or forest reserve without site-manager approval",
                "You cannot safely bag flowering parts before cutting",
            ],
            "spread_prevention": [
                "Bag flowering parts before you cut anything",
                "Brush seeds off clothing, gloves, and boots before leaving",
                "Do not drag cut plants across other vegetation",
            ],
            "prohibited_actions": [
                "Do not slash flowering or seed-bearing plants",
                "Do not burn on-site without a permit",
            ],
            "sources": _CHROMOLAENA_SOURCES,
        },
        "traits": [
            {"label": "Leaf shape", "value": "Opposite, ovate, 5-12 cm with serrated edges"},
            {"label": "Flower", "value": "Pale purple to white, in terminal clusters"},
            {"label": "Growth", "value": "Woody shrub or scrambler, 2-5 m"},
            {"label": "Stem", "value": "Soft-wooded, hairy, strong odour when crushed"},
        ],
        "native_twin": None,
        "removal_steps": [
            {"order": 1, "action": "Cut stems close to ground before flowering", "safe": True},
            {"order": 2, "action": "Remove root crown to prevent re-sprouting", "safe": True},
            {"order": 3, "action": "Bag and dispose of all flowering parts", "safe": True},
        ],
        "do_not_do": [
            "Do not slash during seed season - seeds spread by wind",
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
        "malaysia_status": "invasive",
        "status_source": "GRIIS Malaysia v1.3",
        "status_reviewed_at": _REVIEW_DATE,
        "general_information": (
            "Free-floating aquatic plant that forms dense mats. Do not enter water"
            " to remove; report the sighting instead."
        ),
        "action_eligible": False,
        "guidance_content_version": _GUIDANCE_VERSION,
        "guidance_last_reviewed": _REVIEW_DATE,
        "guidance_metadata": {
            "stop_conditions": [
                "The plant is in flowing or standing water",
                "You would need to wade or use a boat to reach it",
            ],
            "spread_prevention": [
                "Do not disturb the mat - fragments float and re-establish downstream",
                "Report the location for coordinated removal by trained crews",
            ],
            "prohibited_actions": [
                "Do not enter water to remove the plant",
                "Do not drag mats onto banks where they may re-root",
            ],
            "sources": _EICHHORNIA_SOURCES,
        },
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


_GENERIC_SOURCES = [
    {
        "id": "griis-malaysia-v1_3",
        "title": "GRIIS Malaysia v1.3",
        "publisher": "GBIF / IUCN SSC Invasive Species Specialist Group",
        "url": "https://cloud.gbif.org/griis/resource?r=griis-malaysia&v=1.3",
        "accessed": "2026-08-27",
    },
    {
        "id": "myias-2025",
        "title": "MyBIS Invasive Alien Species (MyIAS) 2025",
        "publisher": "Malaysia Biodiversity Information System",
        "url": "https://www.mybis.gov.my/ias/resources.php?menu=98",
        "accessed": "2026-08-27",
    },
]

_GENERIC_INVASIVE_GUIDANCE = {
    "stop_conditions": [
        "You do not have permission to work on this land",
        "The plant has climbed above chest height or wraps mature trees",
        "You are near flowing or standing water",
    ],
    "spread_prevention": [
        "Do not disturb the plant; report the sighting first",
        "Clean tools, gloves, and boots before moving to a new area",
        "Do not compost - many invasive species re-establish from fragments",
    ],
    "prohibited_actions": [
        "Do not burn plant material on-site",
        "Do not apply herbicide without a licensed operator",
    ],
    "sources": _GENERIC_SOURCES,
}


def _apply_shared_catalogue_to_species_seed() -> None:
    """Rebuilds the SPECIES list at import time from the shared catalogue
    JSON - that file is where the Malaysian status actually lives, so I
    don't want to hand-copy it here and then have the two drift apart.
    For the four species I actually wrote proper field-guide detail for,
    the hand-written entry above gets layered on top by id. Anything
    invasive that's still missing guidance gets a generic safe-removal
    block so the UI never shows an invasive result with nothing attached.
    """
    records = load_status_records()
    manifest = load_manifest()
    detailed_by_id = {item["id"]: item for item in SPECIES}
    model_species: list[dict[str, object]] = []

    for record in records:
        species_id = record.species_id
        invasive = record.is_invasive
        # Convert to timezone-aware datetime for the Species.status_reviewed_at
        # column (existing rows are all UTC-anchored).
        reviewed_at = datetime(
            record.status_reviewed_at.year,
            record.status_reviewed_at.month,
            record.status_reviewed_at.day,
            tzinfo=UTC,
        )
        detail = detailed_by_id.get(species_id, {
            "common_names": [],
            "traits": [],
            "native_twin": None,
            "removal_steps": [],
            "do_not_do": [],
            "detail_available": False,
            "action_guides": [],
        })
        catalog_source = record.status_source_ids[0] if record.status_source_ids else None
        # AC Iteration 1 - status columns always come from the catalogue,
        # never from hand-written seed detail, so a catalogue change flows
        # through to a re-seed without editing the seed file.
        detail["malaysia_status"] = record.ui_state
        detail["status_source"] = catalog_source
        detail["status_reviewed_at"] = reviewed_at
        detail.setdefault("action_eligible", False)
        detail.setdefault("guidance_metadata", {})
        # AC 1.2.2 - every invasive result must carry a general_information
        # paragraph so the invasive-result pathway shows a short description
        # plus its source. Catalogue text is the fallback when hand-written
        # detail is missing.
        if not detail.get("general_information"):
            detail["general_information"] = record.general_information
        if invasive and not detail.get("guidance_metadata"):
            detail["guidance_metadata"] = dict(_GENERIC_INVASIVE_GUIDANCE)
        elif invasive:
            merged = dict(_GENERIC_INVASIVE_GUIDANCE)
            merged.update(detail.get("guidance_metadata") or {})
            detail["guidance_metadata"] = merged
        detail.update({
            "id": species_id,
            "name": record.common_name or record.scientific_name,
            "latin_name": record.scientific_name,
            "is_invasive": invasive,
            "risk": "high" if invasive else None,
            "reportable": record.report_eligible,
        })
        model_species.append(detail)

    if len(model_species) != len(records):
        # If this ever fires the shared catalogue and this loop drifted apart -
        # better to fail loudly here than silently seed a mismatched list.
        raise ValueError(
            "Development species seed does not match the shared plant-status catalogue "
            f"({len(records)} catalogue records, {len(model_species)} seeded)."
        )
    # Recorded so callers can log which catalogue version the last seed used.
    global _LAST_SEED_CATALOGUE_VERSION
    _LAST_SEED_CATALOGUE_VERSION = manifest.catalogue_version
    SPECIES[:] = model_species


_LAST_SEED_CATALOGUE_VERSION: str | None = None


def last_seed_catalogue_version() -> str | None:
    return _LAST_SEED_CATALOGUE_VERSION


_apply_shared_catalogue_to_species_seed()

# Real coordinates around KL parks/reserves, used as the "home base" for the
# sample sightings below and as MonitoredPlace rows in their own right.
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

# (species, status, risk, radius-from-centre-in-degrees, angle-in-radians) -
# radius/angle just scatter the sample sightings around the Bukit Kiara centre
# point in seed_development_data() rather than stacking them on top of each other.
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


def load_reference_data(session: Session) -> None:
    """Loads the reference rows (species catalogue + hand-picked KL parks)
    that the app can't run without. Kept separate from the demo-sightings
    seed on purpose so I can safely re-run this in prod before a deploy
    without also dropping fake sightings into the map.

    Re-running it is fine - I look up rows by id/name and update in place
    rather than inserting new ones, so nothing gets duplicated.
    """
    for values in SPECIES:
        existing = session.get(Species, values["id"])
        if existing:
            for key, value in values.items():
                setattr(existing, key, value)
        else:
            session.add(Species(**values))
    session.flush()
    _load_evidence_catalogue_v2026_09(session)
    session.flush()
    _load_protected_areas_seed(session)
    session.flush()
    _load_discovery_seed(session)
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
    session.flush()
    # Retire species ids that used to be in the catalogue. Only drop them if
    # no user data references them, so a production catalogue refresh never
    # deletes anything a real report or sighting depends on.
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


def seed_demo_data(session: Session) -> None:
    """Drops a handful of fake sightings scattered around Bukit Kiara so
    the map isn't empty on a fresh dev DB - makes screenshots and pilot
    testing way easier. The CLI refuses to run this in production so we
    can't accidentally pollute the real data. Assumes load_reference_data
    has already run so the species rows exist to link to.
    """
    centre_lat, centre_lng = 3.1497, 101.6412
    actions = {
        "screened": "Rule-screened report. Follow the reviewed guidance for this species.",
        "removed": "Removal recorded. Recheck for regrowth in 2-3 weeks.",
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
    session.commit()


# Iteration 2 Phase 3 - Small hand-authored set of KL-area protected
# boundaries used by tests and the local dev stack. In prod this table is
# populated from a real dataset import (Federal Dept of Forestry / DWNP
# gazettes); the seed only exists so the location-context endpoint has
# something to intersect against on a fresh DB.
_PROTECTED_AREAS_SEED_VERSION = "dev-seed-2026-09-11"
_PROTECTED_AREAS_SEED: tuple[tuple[str, str, str], ...] = (
    (
        "Bukit Kiara Federal Park",
        "Federal Dept of Forestry Peninsular Malaysia",
        # Rectangle roughly around 3.1497,101.6412 (~500m half-side) covering
        # the demo-sighting cluster centre.
        "MULTIPOLYGON((("
        "101.6362 3.1452,"
        "101.6462 3.1452,"
        "101.6462 3.1542,"
        "101.6362 3.1542,"
        "101.6362 3.1452"
        ")))",
    ),
    (
        "Taman Tugu Forest Reserve",
        "Federal Dept of Forestry Peninsular Malaysia",
        # Small rectangle around 3.1462,101.6820 (Taman Tugu urban forest).
        "MULTIPOLYGON((("
        "101.6790 3.1442,"
        "101.6850 3.1442,"
        "101.6850 3.1482,"
        "101.6790 3.1482,"
        "101.6790 3.1442"
        ")))",
    ),
)


def _load_protected_areas_seed(session: Session) -> None:
    """Idempotent upsert of dev protected-area polygons. Matched by name so
    re-running the seed just refreshes the geometry / dataset_version
    without duplicating rows.
    """
    for name, source, wkt in _PROTECTED_AREAS_SEED:
        existing = session.scalar(
            select(ProtectedArea).where(ProtectedArea.name == name)
        )
        geometry_expr = func.ST_Multi(func.ST_GeomFromText(wkt, 4326))
        if existing is None:
            session.add(
                ProtectedArea(
                    name=name,
                    source=source,
                    dataset_version=_PROTECTED_AREAS_SEED_VERSION,
                    geometry=geometry_expr,
                )
            )
        else:
            existing.source = source
            existing.dataset_version = _PROTECTED_AREAS_SEED_VERSION
            existing.geometry = geometry_expr


def _load_evidence_catalogue_v2026_09(session: Session) -> None:
    """Iteration 2 Phase 2 - upsert the 32 evidence-confirmed species and
    stamp their ``catalogue_version`` so the /api/v1/catalogue endpoint can
    filter to just this snapshot. Rows for species not previously seeded get
    created with minimal Iteration-1-shaped defaults (``is_invasive=True``,
    empty guidance/removal steps) so the existing ``Species`` NOT NULL
    columns are satisfied without pretending we have reviewed removal steps.
    """
    catalogue = load_evidence_catalogue()
    version_row = session.get(CatalogueVersion, catalogue.catalogue_version)
    reviewed_date = catalogue.reviewed_at
    reviewed_dt = datetime(
        reviewed_date.year, reviewed_date.month, reviewed_date.day, tzinfo=UTC
    )
    if version_row is None:
        session.add(
            CatalogueVersion(
                version=catalogue.catalogue_version,
                reviewed_at=reviewed_date,
                total_species_count=catalogue.total_species_count,
                notes=catalogue.notes or None,
            )
        )
    else:
        version_row.reviewed_at = reviewed_date
        version_row.total_species_count = catalogue.total_species_count
        version_row.notes = catalogue.notes or None

    for record in catalogue.records:
        species = session.get(Species, record.species_id)
        common = list(record.common_names)
        display_name = common[0] if common else record.scientific_name
        if species is None:
            species = Species(
                id=record.species_id,
                name=display_name,
                latin_name=record.scientific_name,
                common_names=common,
                is_invasive=True,
                risk="watch",
                traits=[],
                native_twin=None,
                removal_steps=[],
                do_not_do=[],
                detail_available=False,
                reportable=False,
                action_guides=[],
                malaysia_status="invasive",
                action_eligible=False,
                guidance_metadata={},
            )
            session.add(species)
        else:
            # Preserve any hand-authored copy on species already seeded by the
            # Iteration 1 SPECIES table; only overwrite name+common_names when
            # they are still at defaults.
            if not species.common_names:
                species.common_names = common
            if not species.name:
                species.name = display_name
        species.catalogue_version = catalogue.catalogue_version
        species.evidence_codes = list(record.evidence_codes)
        species.evidence_sources = list(record.evidence_sources)
        species.malaysian_states = list(record.malaysian_states)
        species.habitat = record.habitat
        species.accepted_name_usage = record.accepted_name_usage
        species.last_reviewed_at = reviewed_dt
        # AC 5.2.5 - structured sources rendered by the bestiary drawer.
        species.sources = [
            {
                "title": s.title,
                "url_or_id": s.url_or_id,
                "image_creator": s.image_creator,
                "licence": s.licence,
                "review_date": s.review_date,
            }
            for s in record.sources
        ]


# --- Iteration 2 Phase 5 - discovery dev seed --------------------------------

# A single named park polygon covering ~1 km around Bukit Kiara so /places
# has a place_id to hit end-to-end. Bounded by the same rough envelope the
# protected-area seed uses so an occurrence generator hitting the inside/
# outside branches is trivial to compose.
_DISCOVERY_PLACE_NAME = "Bukit Kiara Discovery Park"
_DISCOVERY_PLACE_WKT = (
    "MULTIPOLYGON((("
    "101.6355 3.1450,"
    "101.6470 3.1450,"
    "101.6470 3.1548,"
    "101.6355 3.1548,"
    "101.6355 3.1450"
    ")))"
)

# One directed waterway skirting the eastern boundary of the park so a
# freshwater species with an occurrence a few hundred metres upstream can
# be picked up by the upstream_waterway bucket (AC 5.1.4). Directed=True
# is required for the discovery domain to accept the line.
_DISCOVERY_WATERWAY = {
    "name": "Sungai Kiara (seed)",
    "source": "dev-seed",
    "source_id": "sungai-kiara-1",
    "directed": True,
    "wkt": "LINESTRING(101.6485 3.1500, 101.6488 3.1520, 101.6492 3.1552)",
}

# GBIF-shaped rows. Each tuple: (species_id, source_occurrence_id, lat, lon,
# coord_uncertainty_m, event_year). Points inside the park polygon feed the
# inside bucket; points just outside (within 1 km) feed the nearby bucket;
# a freshwater point along the waterway feeds the upstream bucket.
_DISCOVERY_OCCURRENCES: tuple[tuple[str, str, float, float, float, int], ...] = (
    # Inside Bukit Kiara Discovery Park.
    ("mikania-micrantha", "gbif-seed-mm-1", 3.1490, 101.6410, 25.0, 2024),
    ("mikania-micrantha", "gbif-seed-mm-2", 3.1502, 101.6435, 50.0, 2025),
    ("chromolaena-odorata", "gbif-seed-co-1", 3.1480, 101.6420, 100.0, 2023),
    ("lantana-camara", "gbif-seed-lc-1", 3.1515, 101.6455, 15.0, 2024),
    # Nearby (within the 1 km park buffer, outside the polygon).
    ("lantana-camara", "gbif-seed-lc-2", 3.1400, 101.6500, 80.0, 2022),
    ("bidens-pilosa", "gbif-seed-bp-1", 3.1600, 101.6300, 200.0, 2025),
    # Upstream aquatic - Eichhornia crassipes along Sungai Kiara.
    ("eichhornia-crassipes", "gbif-seed-ec-1", 3.1555, 101.6493, 30.0, 2024),
)


def _load_discovery_seed(session: Session) -> None:
    """Idempotent upsert of the dev discovery fixtures: one MonitoredArea,
    one directed waterway, a handful of GBIF-shaped occurrences. Matched by
    name / source_occurrence_id so re-running never duplicates rows.
    Skipped if any of the target species have not been catalogued (e.g.
    running against an older schema).
    """
    place_geom = func.ST_Multi(func.ST_GeomFromText(_DISCOVERY_PLACE_WKT, 4326))
    place = session.scalar(
        select(MonitoredArea).where(MonitoredArea.name == _DISCOVERY_PLACE_NAME)
    )
    if place is None:
        session.add(
            MonitoredArea(
                name=_DISCOVERY_PLACE_NAME,
                geometry=place_geom,
                metadata_json={"tags": {"leisure": "park"}},
                place_type="park",
                geometry_status="authoritative",
                geometry_version="seed-2026-09",
            )
        )
    else:
        place.geometry = place_geom
        place.place_type = "park"
        place.geometry_status = "authoritative"
        place.geometry_version = "seed-2026-09"

    waterway = session.scalar(
        select(Waterway).where(
            Waterway.source == _DISCOVERY_WATERWAY["source"],
            Waterway.source_id == _DISCOVERY_WATERWAY["source_id"],
        )
    )
    line_geom = func.ST_GeomFromText(_DISCOVERY_WATERWAY["wkt"], 4326)
    if waterway is None:
        session.add(
            Waterway(
                name=_DISCOVERY_WATERWAY["name"],
                source=_DISCOVERY_WATERWAY["source"],
                source_id=_DISCOVERY_WATERWAY["source_id"],
                directed=bool(_DISCOVERY_WATERWAY["directed"]),
                line=line_geom,
            )
        )
    else:
        waterway.line = line_geom
        waterway.directed = bool(_DISCOVERY_WATERWAY["directed"])

    catalogue = load_evidence_catalogue()
    catalogue_version = catalogue.catalogue_version
    for species_id, occ_id, lat, lon, uncertainty_m, year in _DISCOVERY_OCCURRENCES:
        if session.get(Species, species_id) is None:
            # Occurrence table has a FK to species; skip if catalogue swap
            # has not yet inserted the species row.
            continue
        row = session.scalar(
            select(GbifOccurrence).where(
                GbifOccurrence.source == "gbif",
                GbifOccurrence.source_occurrence_id == occ_id,
            )
        )
        if row is None:
            session.add(
                GbifOccurrence(
                    species_id=species_id,
                    source="gbif",
                    source_occurrence_id=occ_id,
                    country_code="MY",
                    occurrence_status="PRESENT",
                    latitude=Decimal(str(lat)),
                    longitude=Decimal(str(lon)),
                    coordinate_uncertainty_m=Decimal(str(uncertainty_m)),
                    event_year=year,
                    catalogue_version=catalogue_version,
                )
            )
        else:
            row.species_id = species_id
            row.latitude = Decimal(str(lat))
            row.longitude = Decimal(str(lon))
            row.coordinate_uncertainty_m = Decimal(str(uncertainty_m))
            row.event_year = year
            row.catalogue_version = catalogue_version


def seed_development_data(session: Session) -> None:
    """Old entry point that just runs both seeds one after the other. I
    kept it around so the existing tests and the old `invatrace seed`
    command don't break, but for prod we call load_reference_data on its
    own - the CLI blocks this one from running in production anyway.
    """
    load_reference_data(session)
    seed_demo_data(session)
