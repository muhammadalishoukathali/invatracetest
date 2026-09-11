"""Iteration 2 Phase 5 - Epic 5.1 place-based plant discovery.

Given a MonitoredArea id, compute the ranked list of catalogue species
with occurrence-based evidence tying them to that place. Three evidence
buckets, ranked in this order:

  1. ``inside`` - occurrence point falls inside the place polygon.
     (Only for polygon-backed places - a ``trail`` place has no interior
     bucket; its evidence is drawn from a buffer around the line.)
  2. ``nearby`` - within ``DISCOVERY_PARK_BUFFER_M`` (park/forest) or
     ``DISCOVERY_TRAIL_BUFFER_M`` (trail) metres of the place boundary.
     Distance-weighted by exp(-d / DISCOVERY_DECAY_SCALE_M).
  3. ``upstream_waterway`` - only for water-dispersal species; along-line
     distance up a directed OSM waterway within
     ``WATERWAY_UPSTREAM_MAX_KM``. Undirected segments are skipped -
     never fall back to Euclidean distance (AC 5.1.4b).

All distance calculations run on ``geography`` types so ST_Distance and
ST_DWithin return geodesic metres, not degrees. The upstream bucket
snaps both the occurrence and the place onto the waterway line with
ST_LineLocatePoint and measures along-line length via ST_LineSubstring
on ``geography`` - never a Euclidean fallback.

Filtering: only occurrences whose ``catalogue_version`` matches the
current catalogue (dropped when a version bumps so we don't leak stale
rows). Coordinate uncertainty ceiling applied by the importer.

Kept separate from ``place_association.py`` (sighting labelling) so the
two features can evolve independently.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field

from geoalchemy2 import Geography, Geometry
from sqlalchemy import and_, cast, func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import GbifOccurrence, MonitoredArea, Species, Waterway


# Species habitat values from the catalogue JSON that count as
# "water-dispersal capable" for the upstream evidence bucket.
_WATER_DISPERSAL_HABITATS: frozenset[str] = frozenset(
    {"freshwater", "terrestrial_and_freshwater", "marine", "wetland"}
)

# Place types that are line-shaped and therefore never get the "inside"
# bucket - they draw evidence from a buffer around the line only.
_TRAIL_PLACE_TYPES: frozenset[str] = frozenset({"trail"})

# Tolerance for "these two things ride the same waterway". Both the
# occurrence and the place must intersect a buffer of the same segment.
_WATERWAY_SNAP_TOLERANCE_M: float = 250.0


@dataclass(frozen=True)
class PlaceRecord:
    id: uuid.UUID
    name: str
    place_type: str
    geometry_status: str
    geometry_version: str
    source: str


@dataclass(frozen=True)
class EvidenceComponent:
    kind: str  # 'inside' | 'nearby' | 'upstream_waterway'
    distance_m: float | None
    weight: float
    qualifying_records: int
    most_recent_year: int | None


@dataclass(frozen=True)
class RankingFormula:
    formula: str
    coefficients: dict[str, float]
    components: list[dict[str, object]]


@dataclass
class PlantAssociation:
    species_id: str
    scientific_name: str
    common_names: list[str]
    catalogue_link: str
    evidence: list[EvidenceComponent] = field(default_factory=list)
    total_score: float = 0.0
    qualifying_records: int = 0
    most_recent_year: int | None = None
    closest_distance_m: float | None = None
    inside_area: bool = False
    direction_aware_evidence: bool = False
    ranking_formula: RankingFormula | None = None


@dataclass(frozen=True)
class PlaceAssociationsResult:
    place: PlaceRecord
    associations: list[PlantAssociation]
    catalogue_version: str
    occurrence_data_updated_at: str | None
    disclaimer: str


_DISCLAIMER = (
    "Occurrence-based inference from public records - not a live census."
    " Absence of a plant from this list does not mean it is absent from the site."
)


# Scoring coefficients - kept in one place so the ranking_formula block
# on the response can quote them without going out of sync with the code.
_INSIDE_WEIGHT: float = 1.5
_NEARBY_WEIGHT: float = 1.0
_UPSTREAM_WEIGHT: float = 0.4


def load_place(session: Session, place_id: uuid.UUID) -> PlaceRecord | None:
    row = session.get(MonitoredArea, place_id)
    if row is None:
        return None
    metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
    source = metadata.get("source") if isinstance(metadata.get("source"), str) else "osm"
    return PlaceRecord(
        id=row.id,
        name=row.name,
        place_type=row.place_type,
        geometry_status=row.geometry_status,
        geometry_version=row.geometry_version,
        source=source,
    )


def compute_associations(
    session: Session,
    place_id: uuid.UUID,
) -> PlaceAssociationsResult | None:
    """Ranked plant-associations for a place. Returns ``None`` when the place
    does not exist. Places whose geometry is ``unsupported`` return an empty
    associations list but still surface metadata so the caller can decide
    how to communicate that (the router raises 422 - AC 5.1.1).
    """
    place = load_place(session, place_id)
    if place is None:
        return None
    settings = get_settings()
    catalogue_version = settings.catalogue_version

    if place.geometry_status == "unsupported":
        return PlaceAssociationsResult(
            place=place,
            associations=[],
            catalogue_version=catalogue_version,
            occurrence_data_updated_at=None,
            disclaimer=_DISCLAIMER,
        )

    area_geom = session.scalar(select(MonitoredArea.geometry).where(MonitoredArea.id == place.id))
    if area_geom is None:
        return PlaceAssociationsResult(
            place=place,
            associations=[],
            catalogue_version=catalogue_version,
            occurrence_data_updated_at=None,
            disclaimer=_DISCLAIMER,
        )

    is_trail = place.place_type in _TRAIL_PLACE_TYPES
    if is_trail:
        buffer_m = float(settings.discovery_trail_buffer_m)
    else:
        buffer_m = float(settings.discovery_park_buffer_m)
    decay_scale_m = float(settings.discovery_decay_scale_m)
    upstream_max_m = float(settings.waterway_upstream_max_km) * 1_000.0

    # ST_Distance / ST_DWithin on ``geography`` values compute geodesic
    # distances in metres. MonitoredArea.geometry and
    # GbifOccurrence.location are both ``geography(...,4326)`` (see
    # app/db/models.py) so no cast to Geometry is applied here - a cast
    # would silently downgrade to degrees (AC 5.1.3).
    distance_expr = func.ST_Distance(MonitoredArea.geometry, GbifOccurrence.location)
    # Trail places have no interior bucket - all evidence is drawn from
    # a buffer around the trail geometry, so ``is_inside`` is ignored for
    # trails when the buckets are rolled up further down.
    inside_expr = func.ST_Covers(MonitoredArea.geometry, GbifOccurrence.location)

    # Pull every occurrence for the current catalogue version within the
    # buffer once; group in Python since the ranking function is not
    # trivially expressible in a single aggregate query.
    rows = session.execute(
        select(
            GbifOccurrence.species_id,
            Species.name,
            Species.common_names,
            GbifOccurrence.event_year,
            distance_expr.label("distance_m"),
            inside_expr.label("is_inside"),
        )
        .join(Species, Species.id == GbifOccurrence.species_id)
        .where(
            GbifOccurrence.catalogue_version == catalogue_version,
            MonitoredArea.id == place.id,
            func.ST_DWithin(MonitoredArea.geometry, GbifOccurrence.location, buffer_m),
        )
    ).all()

    per_species: dict[str, PlantAssociation] = {}
    for row in rows:
        species_id: str = row.species_id
        record = per_species.get(species_id)
        if record is None:
            common_names = row.common_names if isinstance(row.common_names, list) else []
            record = PlantAssociation(
                species_id=species_id,
                scientific_name=row.name,
                common_names=[c for c in common_names if isinstance(c, str)][:6],
                catalogue_link=f"/plants/{species_id}",
            )
            per_species[species_id] = record
        distance_m = float(row.distance_m) if row.distance_m is not None else buffer_m
        # A trail place has no interior bucket even if a point happens to
        # sit within the (thin) polygon representation.
        is_inside = bool(row.is_inside) and not is_trail
        record.qualifying_records += 1
        year = int(row.event_year) if row.event_year is not None else None
        if year is not None and (record.most_recent_year is None or year > record.most_recent_year):
            record.most_recent_year = year
        if record.closest_distance_m is None or distance_m < record.closest_distance_m:
            record.closest_distance_m = 0.0 if is_inside else distance_m
        if is_inside:
            record.inside_area = True

    # Roll up buckets per species.
    for record in per_species.values():
        inside_count = 0
        nearby_count = 0
        for row in rows:
            if row.species_id != record.species_id:
                continue
            if bool(row.is_inside) and not is_trail:
                inside_count += 1
            else:
                nearby_count += 1
        if inside_count:
            record.evidence.append(
                EvidenceComponent(
                    kind="inside",
                    distance_m=0.0,
                    weight=1.0,
                    qualifying_records=inside_count,
                    most_recent_year=record.most_recent_year,
                )
            )
        if nearby_count:
            # Weight = mean exp(-d / decay) over qualifying nearby records.
            weight_sum = 0.0
            weight_n = 0
            for row in rows:
                if row.species_id != record.species_id:
                    continue
                if bool(row.is_inside) and not is_trail:
                    continue
                dist = float(row.distance_m) if row.distance_m is not None else buffer_m
                weight_sum += math.exp(-dist / decay_scale_m) if decay_scale_m > 0 else 0.0
                weight_n += 1
            weight = weight_sum / weight_n if weight_n else 0.0
            record.evidence.append(
                EvidenceComponent(
                    kind="nearby",
                    distance_m=record.closest_distance_m,
                    weight=weight,
                    qualifying_records=nearby_count,
                    most_recent_year=record.most_recent_year,
                )
            )

    # Upstream waterway bucket - AC 5.1.4.
    #
    # We compute a real along-line distance rather than a Euclidean one:
    #
    #   * ST_LineLocatePoint gives a fraction 0..1 along the line for
    #     each of the occurrence point and the place centroid.
    #   * OSM waterway geometries are stored in flow direction, so
    #     "upstream" means the occurrence sits at a SMALLER fraction
    #     than the place. If the reverse is true the occurrence is
    #     downstream and we drop it.
    #   * ST_LineSubstring cut between the two fractions, cast back to
    #     geography, then ST_Length gives the along-line distance in
    #     metres.
    #   * Both the occurrence and the place must sit within
    #     ``_WATERWAY_SNAP_TOLERANCE_M`` of the SAME waterway line so we
    #     know they actually ride the same segment.
    #   * Waterway.directed must be true - undirected segments are
    #     skipped entirely (AC 5.1.4b, never a Euclidean fallback).
    aquatic_species = _aquatic_species_ids(session)
    if aquatic_species:
        waterway_line_geom = cast(Waterway.line, Geometry)
        occ_point_geom = cast(GbifOccurrence.location, Geometry)
        place_geom_geom = cast(MonitoredArea.geometry, Geometry)
        place_centroid_geom = func.ST_Centroid(place_geom_geom)

        occ_frac = func.ST_LineLocatePoint(waterway_line_geom, occ_point_geom)
        place_frac = func.ST_LineLocatePoint(waterway_line_geom, place_centroid_geom)
        along_substring = func.ST_LineSubstring(
            waterway_line_geom,
            func.least(occ_frac, place_frac),
            func.greatest(occ_frac, place_frac),
        )
        along_dist_m = func.ST_Length(cast(along_substring, Geography))

        waterway_hits = session.execute(
            select(
                GbifOccurrence.species_id,
                func.min(along_dist_m).label("along_dist_m"),
                func.count(GbifOccurrence.id).label("qualifying"),
                func.max(GbifOccurrence.event_year).label("year"),
            )
            .join(Species, Species.id == GbifOccurrence.species_id)
            .join(
                Waterway,
                and_(
                    Waterway.directed.is_(True),
                    # Occurrence rides this waterway segment.
                    func.ST_DWithin(
                        Waterway.line,
                        GbifOccurrence.location,
                        _WATERWAY_SNAP_TOLERANCE_M,
                    ),
                ),
            )
            .where(
                GbifOccurrence.catalogue_version == catalogue_version,
                GbifOccurrence.species_id.in_(aquatic_species),
                # Place rides the SAME waterway segment.
                func.ST_DWithin(
                    MonitoredArea.geometry,
                    Waterway.line,
                    _WATERWAY_SNAP_TOLERANCE_M,
                ),
                MonitoredArea.id == place.id,
                # Occurrence must be upstream: at a smaller along-line
                # fraction than the place (OSM waterways are stored in
                # flow direction so smaller fraction = further upstream).
                occ_frac < place_frac,
                along_dist_m <= upstream_max_m,
                # Occurrence must be outside the place polygon itself; a
                # point inside the polygon is already covered by the
                # inside bucket and would double-count.
                or_(
                    func.ST_Covers(MonitoredArea.geometry, GbifOccurrence.location).is_(False),
                    func.ST_Covers(MonitoredArea.geometry, GbifOccurrence.location).is_(None),
                ),
            )
            .group_by(GbifOccurrence.species_id)
        ).all()
        for row in waterway_hits:
            record = per_species.setdefault(
                row.species_id,
                _bootstrap_association(session, row.species_id),
            )
            record.direction_aware_evidence = True
            distance_m = float(row.along_dist_m) if row.along_dist_m is not None else None
            weight = 1.0
            if distance_m is not None and decay_scale_m > 0:
                weight = math.exp(-distance_m / decay_scale_m)
            record.evidence.append(
                EvidenceComponent(
                    kind="upstream_waterway",
                    distance_m=distance_m,
                    weight=weight,
                    qualifying_records=int(row.qualifying),
                    most_recent_year=int(row.year) if row.year is not None else None,
                )
            )

    # Scoring: inside dominates, then nearby (decay-weighted), then upstream.
    ranked: list[PlantAssociation] = []
    for record in per_species.values():
        score = 0.0
        formula_components: list[dict[str, object]] = []
        for component in record.evidence:
            if component.kind == "inside":
                contribution = _INSIDE_WEIGHT * component.weight
            elif component.kind == "nearby":
                contribution = _NEARBY_WEIGHT * component.weight
            elif component.kind == "upstream_waterway":
                contribution = _UPSTREAM_WEIGHT * component.weight
            else:
                contribution = 0.0
            score += contribution
            formula_components.append(
                {
                    "kind": component.kind,
                    "distance_m": component.distance_m,
                    "weight": component.weight,
                    "contribution": contribution,
                    "qualifying_records": component.qualifying_records,
                }
            )
        record.total_score = score
        record.ranking_formula = RankingFormula(
            formula="weight = exp(-distance_m / decay_scale_m); "
            "total_score = inside_weight*inside + nearby_weight*sum(nearby_weights) "
            "+ upstream_weight*sum(upstream_weights)",
            coefficients={
                "inside_weight": _INSIDE_WEIGHT,
                "nearby_weight": _NEARBY_WEIGHT,
                "upstream_weight": _UPSTREAM_WEIGHT,
                "decay_scale_m": decay_scale_m,
            },
            components=formula_components,
        )
        ranked.append(record)

    ranked.sort(
        key=lambda r: (
            not r.inside_area,
            -r.total_score,
            -(r.most_recent_year or 0),
            r.scientific_name,
        )
    )

    latest_ingest = session.scalar(
        select(func.max(GbifOccurrence.ingested_at)).where(
            GbifOccurrence.catalogue_version == catalogue_version
        )
    )
    return PlaceAssociationsResult(
        place=place,
        associations=ranked,
        catalogue_version=catalogue_version,
        occurrence_data_updated_at=latest_ingest.isoformat().replace("+00:00", "Z")
        if latest_ingest is not None
        else None,
        disclaimer=_DISCLAIMER,
    )


def _aquatic_species_ids(session: Session) -> list[str]:
    """Species from the current catalogue whose habitat marks them as
    water-dispersal capable. Reads the habitat string on Species."""
    rows = session.execute(select(Species.id, Species.habitat)).all()
    return [
        species_id for species_id, habitat in rows
        if isinstance(habitat, str) and habitat in _WATER_DISPERSAL_HABITATS
    ]


def _bootstrap_association(session: Session, species_id: str) -> PlantAssociation:
    species = session.get(Species, species_id)
    if species is None:
        return PlantAssociation(
            species_id=species_id,
            scientific_name=species_id,
            common_names=[],
            catalogue_link=f"/plants/{species_id}",
        )
    common_names = species.common_names if isinstance(species.common_names, list) else []
    return PlantAssociation(
        species_id=species_id,
        scientific_name=species.name,
        common_names=[c for c in common_names if isinstance(c, str)][:6],
        catalogue_link=f"/plants/{species_id}",
    )
