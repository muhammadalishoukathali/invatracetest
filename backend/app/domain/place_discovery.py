"""Iteration 2 Phase 5 / Phase 10 Wave 2a - place-based plant discovery.

Wave 2a rewrite: direction-aware upstream evidence is computed via a
node-level Dijkstra walk over the ``waterway_ways`` graph, replacing the
old single-way ``ST_LineLocatePoint``/``ST_LineSubstring`` implementation
that could only ride one waterway line at a time.

Buckets (ranked in this order):

  1. ``inside`` - occurrence point falls inside the place polygon
     (park/forest places only; a trail/line has no interior bucket).
  2. ``nearby`` - within ``DISCOVERY_PARK_BUFFER_M`` (park/forest) or
     ``DISCOVERY_TRAIL_BUFFER_M`` (trail/line) metres of the place
     boundary. Distance-weighted by ``exp(-d / DISCOVERY_DECAY_SCALE_M)``.
  3. ``upstream_waterway`` - species must have a curated
     ``species_dispersal_traits.waterway_direction_eligible = TRUE`` row
     AND the occurrence row itself must have
     ``eligible_for_waterway_direction = TRUE``. Habitat-string matching
     is explicitly forbidden as a substitute (AC 5.1.4).

Distance calculations run on ``geography`` types so ST_Distance and
ST_DWithin return geodesic metres, not degrees.

The upstream bucket:

  * Fetches every ``waterway_ways`` row within
    ``waterway_fetch_radius_km`` of the place geography (GiST-backed).
  * Decomposes each way into consecutive directed segments in memory
    using the stored ``node_ids`` array. Length per segment is the way's
    total length divided by ``len(node_ids) - 1`` (equal share, per
    handover iteration 1 note).
  * Snaps each eligible candidate occurrence and the place onto the
    nearest way (must be within ``waterway_snap_tolerance_m``).
  * Same-way case: walks segment indices in stored order (occurrence
    strictly upstream of place along the flow).
  * Cross-way case: Dijkstra on the directed segment graph keyed on
    ``from_node_id``. Halts when cumulative distance exceeds
    ``waterway_upstream_max_km * 1000`` or after 10_000 pops.
"""

from __future__ import annotations

import heapq
import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Mapping

from geoalchemy2 import Geography, Geometry
from sqlalchemy import and_, case, cast, func, literal, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import (
    GbifOccurrence,
    MonitoredArea,
    OsmImport,
    Species,
    SpeciesDispersalTrait,
    WaterwayWay,
)


# Line-shaped place types get the trail buffer and skip the ``inside``
# bucket entirely. AC 5.1.3.
_TRAIL_PLACE_TYPES: frozenset[str] = frozenset({"trail", "line"})

# Scoring coefficients kept in one place so the ranking_formula block on
# the response can quote them without going out of sync with the code.
_INSIDE_WEIGHT: float = 1.5
_NEARBY_WEIGHT: float = 1.0
_UPSTREAM_WEIGHT: float = 0.4

# Hard cap on Dijkstra pops per query - a pathological over-connected
# waterway graph must not blow up runtime.
_MAX_DIJKSTRA_POPS: int = 10_000

_DISCLAIMER = (
    "Occurrence-based inference from public records - not a live census."
    " Absence of a plant from this list does not mean it is absent from the site."
)


# ---------------------------------------------------------------------------
# Response-shape dataclasses (unchanged public API for the router).
# ---------------------------------------------------------------------------


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
    kind: str  # 'inside' | 'nearby' | 'trail_buffer' | 'upstream_waterway'
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
    reference_image_url: str | None = None
    evidence_codes: list[str] = field(default_factory=list)
    malaysian_states: list[str] = field(default_factory=list)
    evidence: list[EvidenceComponent] = field(default_factory=list)
    total_score: float = 0.0
    qualifying_records: int = 0
    most_recent_year: int | None = None
    closest_distance_m: float | None = None
    closest_network_m: float | None = None
    inside_area: bool = False
    direction_aware_evidence: bool = False
    tier: int = 0  # 3=inside, 2=nearby|trail_buffer, 1=upstream-only
    ranking_formula: RankingFormula | None = None


@dataclass(frozen=True)
class PlaceAssociationsResult:
    place: PlaceRecord
    associations: list[PlantAssociation]
    catalogue_version: str
    occurrence_data_updated_at: str | None
    disclaimer: str
    processed_data_version: str | None = None
    osm_source_version: str | None = None


# ---------------------------------------------------------------------------
# Pure-python types for the upstream Dijkstra layer (unit-testable).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Segment:
    """One directed segment between two consecutive nodes on a waterway."""

    way_id: uuid.UUID
    osm_way_id: int
    waterway_type: str
    from_node_id: int
    to_node_id: int
    segment_index: int
    n_segments: int
    length_m: float
    way_frac_start: float
    way_frac_end: float


@dataclass(frozen=True)
class SnapPoint:
    """Occurrence or place snapped onto a way."""

    way_id: uuid.UUID
    segment_index: int
    local_frac: float
    distance_to_way_m: float


@dataclass(frozen=True)
class OccurrenceCandidate:
    record_uid: str
    species_id: str
    event_year: int | None
    longitude: float
    latitude: float


@dataclass(frozen=True)
class UpstreamEvidence:
    record_uid: str
    species_id: str
    network_distance_m: float
    osm_way_id_snapped: int
    event_year: int | None = None


# ---------------------------------------------------------------------------
# Pure-python graph helpers (exercised by unit tests without a DB).
# ---------------------------------------------------------------------------


def segments_from_way(
    way_id: uuid.UUID,
    osm_way_id: int,
    waterway_type: str,
    node_ids: list[int],
    length_m: float,
) -> list[Segment]:
    """Decompose one waterway way into consecutive directed segments.

    Segment length is an equal share of the way's total length (per
    handover doc 2, acceptable for iteration 1). ``node_ids`` must be
    at least two entries long.
    """
    if len(node_ids) < 2:
        return []
    n = len(node_ids) - 1
    seg_len = float(length_m) / n if n > 0 else 0.0
    segments: list[Segment] = []
    for i in range(n):
        segments.append(
            Segment(
                way_id=way_id,
                osm_way_id=osm_way_id,
                waterway_type=waterway_type,
                from_node_id=int(node_ids[i]),
                to_node_id=int(node_ids[i + 1]),
                segment_index=i,
                n_segments=n,
                length_m=seg_len,
                way_frac_start=i / n,
                way_frac_end=(i + 1) / n,
            )
        )
    return segments


def build_adjacency(segments: Iterable[Segment]) -> dict[int, list[Segment]]:
    """Adjacency map keyed on ``from_node_id`` for outbound Dijkstra."""
    adj: dict[int, list[Segment]] = defaultdict(list)
    for seg in segments:
        adj[seg.from_node_id].append(seg)
    return adj


def dijkstra_upstream_distance(
    occ_snap: SnapPoint,
    place_snap: SnapPoint,
    way_segments: Mapping[uuid.UUID, list[Segment]],
    adjacency: Mapping[int, list[Segment]],
    max_upstream_m: float,
    max_pops: int = _MAX_DIJKSTRA_POPS,
) -> float | None:
    """Network distance from ``occ_snap`` UPSTREAM to ``place_snap``.

    Returns the along-network distance in metres, or ``None`` when the
    occurrence is not upstream of the place (either downstream, or no
    path within ``max_upstream_m``).

    Semantics: OSM way node order encodes flow direction. An occurrence
    at a smaller stored fraction than the place is upstream of it. In
    the cross-way case we start at the end of the occurrence's segment
    (``to_node``) and walk forward until we reach the start of the
    place's segment (``from_node``).
    """
    occ_segments = way_segments.get(occ_snap.way_id, [])
    place_segments = way_segments.get(place_snap.way_id, [])
    if not occ_segments or not place_segments:
        return None
    if occ_snap.segment_index >= len(occ_segments):
        return None
    if place_snap.segment_index >= len(place_segments):
        return None
    occ_seg = occ_segments[occ_snap.segment_index]
    place_seg = place_segments[place_snap.segment_index]

    # ---- Same-way case -------------------------------------------------
    if occ_snap.way_id == place_snap.way_id:
        if occ_snap.segment_index == place_snap.segment_index:
            if occ_snap.local_frac > place_snap.local_frac:
                return None  # strictly downstream
            # Coincident (equal fraction) is a zero-metre upstream hit, not
            # a miss. Handover treats an occurrence touching the place-snap
            # point as maximally upstream.
            return (place_snap.local_frac - occ_snap.local_frac) * occ_seg.length_m
        if occ_snap.segment_index > place_snap.segment_index:
            return None  # downstream
        # Different segments, occurrence strictly earlier in stored order.
        remaining = (1.0 - occ_snap.local_frac) * occ_seg.length_m
        for i in range(occ_snap.segment_index + 1, place_snap.segment_index):
            remaining += occ_segments[i].length_m
        remaining += place_snap.local_frac * place_seg.length_m
        if remaining > max_upstream_m:
            return None
        return remaining

    # ---- Cross-way case (Dijkstra) ------------------------------------
    start_remaining = (1.0 - occ_snap.local_frac) * occ_seg.length_m
    target_node = place_seg.from_node_id
    place_tail = place_snap.local_frac * place_seg.length_m

    heap: list[tuple[float, int]] = []
    heapq.heappush(heap, (start_remaining, occ_seg.to_node_id))
    # Special-case: occurrence segment already ends at the place seg's
    # from_node - a direct hop, no further edges needed.
    if occ_seg.to_node_id == target_node:
        total = start_remaining + place_tail
        return total if total <= max_upstream_m else None

    best: dict[int, float] = {occ_seg.to_node_id: start_remaining}
    pops = 0
    while heap:
        pops += 1
        if pops > max_pops:
            return None
        dist, node = heapq.heappop(heap)
        if dist > max_upstream_m:
            return None
        if dist > best.get(node, math.inf):
            continue
        if node == target_node:
            total = dist + place_tail
            return total if total <= max_upstream_m else None
        for seg in adjacency.get(node, ()):
            nd = dist + seg.length_m
            if nd > max_upstream_m:
                continue
            if nd < best.get(seg.to_node_id, math.inf):
                best[seg.to_node_id] = nd
                heapq.heappush(heap, (nd, seg.to_node_id))
    return None


# ---------------------------------------------------------------------------
# Place loader (unchanged shape).
# ---------------------------------------------------------------------------


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


@dataclass(frozen=True)
class PlaceListItem:
    """Row shape for ``GET /api/v1/places`` map-layer list. Carries a
    ``geometry_simplified`` GeoJSON dict so the frontend can render the
    place layer without a second per-place fetch.
    """

    id: uuid.UUID
    name: str
    place_type: str
    source_feature_id: str | None
    geometry_status: str
    geometry_version: str
    source: str
    geometry_simplified: dict


def list_places(
    session: Session,
    *,
    q: str | None = None,
    place_type: str | None = None,
    bbox: tuple[float, float, float, float] | None = None,
    limit: int = 100,
) -> list[PlaceListItem]:
    """Simplified places list for the map layer.

    Query is intentionally simple: match ``name`` ILIKE and/or ``place_type``
    equality and/or bbox intersection. Geometry is simplified server-side
    (``ST_SimplifyPreserveTopology`` on the geometry cast, then re-cast to
    geography for shape consistency) to shrink the payload.
    """
    # ~11 m tolerance in polygon degrees would over-simplify a narrow
    # trail LINESTRING (a slightly wiggly footpath collapses to a chord).
    # Use a tighter tolerance for line-shaped places.
    simplify_tolerance = case(
        (MonitoredArea.place_type.in_(list(_TRAIL_PLACE_TYPES)), literal(0.00002)),
        else_=literal(0.0001),
    )
    simplified = func.ST_AsGeoJSON(
        func.ST_SimplifyPreserveTopology(
            cast(MonitoredArea.geometry, Geometry()),
            simplify_tolerance,
        )
    ).label("geom")
    stmt = select(
        MonitoredArea.id,
        MonitoredArea.name,
        MonitoredArea.place_type,
        MonitoredArea.source_feature_id,
        MonitoredArea.geometry_status,
        MonitoredArea.geometry_version,
        MonitoredArea.metadata_json,
        simplified,
    )
    conditions = []
    if q and q.strip():
        conditions.append(MonitoredArea.name.ilike(f"%{q.strip()}%"))
    if place_type:
        conditions.append(MonitoredArea.place_type == place_type)
    if bbox is not None:
        west, south, east, north = bbox
        conditions.append(
            func.ST_Intersects(
                MonitoredArea.geometry,
                cast(
                    func.ST_MakeEnvelope(west, south, east, north, 4326),
                    Geography(),
                ),
            )
        )
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.limit(max(1, min(250, limit)))
    import json as _json
    items: list[PlaceListItem] = []
    for row in session.execute(stmt).all():
        metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
        source = metadata.get("source") if isinstance(metadata.get("source"), str) else "osm"
        geom = row.geom
        try:
            geometry = _json.loads(geom) if isinstance(geom, str) else geom or {}
        except (TypeError, ValueError):
            geometry = {}
        items.append(
            PlaceListItem(
                id=row.id,
                name=row.name,
                place_type=row.place_type,
                source_feature_id=row.source_feature_id,
                geometry_status=row.geometry_status,
                geometry_version=row.geometry_version,
                source=source,
                geometry_simplified=geometry,
            )
        )
    return items


# ---------------------------------------------------------------------------
# DB-backed upstream evidence.
# ---------------------------------------------------------------------------


def _fetch_candidate_occurrences(
    session: Session,
    place_id: uuid.UUID,
    catalogue_version: str,
    fetch_radius_m: float,
    upstream_max_m: float,
) -> list[OccurrenceCandidate]:
    """Eligible occurrences within (fetch_radius + upstream_max) metres
    of the place. Only species with a curated
    ``waterway_direction_eligible=True`` trait AND rows whose
    ``eligible_for_waterway_direction`` flag is true are considered.
    """
    outer_radius = fetch_radius_m + upstream_max_m
    rows = session.execute(
        select(
            GbifOccurrence.record_uid,
            GbifOccurrence.species_id,
            GbifOccurrence.event_year,
            GbifOccurrence.longitude,
            GbifOccurrence.latitude,
        )
        .join(
            SpeciesDispersalTrait,
            SpeciesDispersalTrait.species_id == GbifOccurrence.species_id,
        )
        .where(
            GbifOccurrence.catalogue_version == catalogue_version,
            GbifOccurrence.eligible_for_waterway_direction.is_(True),
            SpeciesDispersalTrait.waterway_direction_eligible.is_(True),
            GbifOccurrence.record_uid.isnot(None),
            func.ST_DWithin(
                MonitoredArea.geometry,
                GbifOccurrence.location,
                outer_radius,
            ),
            MonitoredArea.id == place_id,
        )
    ).all()
    return [
        OccurrenceCandidate(
            record_uid=row.record_uid,
            species_id=row.species_id,
            event_year=int(row.event_year) if row.event_year is not None else None,
            longitude=float(row.longitude),
            latitude=float(row.latitude),
        )
        for row in rows
    ]


def _fetch_waterway_ways(
    session: Session,
    place_id: uuid.UUID,
    fetch_radius_m: float,
) -> list[WaterwayWay]:
    return list(
        session.execute(
            select(WaterwayWay)
            .where(
                func.ST_DWithin(
                    WaterwayWay.geometry,
                    MonitoredArea.geometry,
                    fetch_radius_m,
                ),
                MonitoredArea.id == place_id,
            )
        )
        .scalars()
        .all()
    )


def _snap_place_to_way(
    session: Session,
    place_id: uuid.UUID,
    ways: list[WaterwayWay],
    tolerance_m: float,
    way_segments: Mapping[uuid.UUID, list[Segment]],
) -> SnapPoint | None:
    """Return the closest waterway to the place's geometry (using its
    centroid for the along-line fraction) within ``tolerance_m``.
    """
    if not ways:
        return None
    way_ids = [w.id for w in ways]
    # AC 5.1.4: snap the place to its NEAREST point on the way, not its
    # centroid. Using ST_Centroid would inflate the along-way fraction when
    # a river skirts a polygon edge — the place's real touch point on the
    # network is where the boundary meets the line, not deep inside the
    # polygon.
    row = session.execute(
        select(
            WaterwayWay.id,
            func.ST_Distance(WaterwayWay.geometry, MonitoredArea.geometry).label("dist"),
            func.ST_LineLocatePoint(
                cast(WaterwayWay.geometry, Geometry),
                func.ST_ClosestPoint(
                    cast(WaterwayWay.geometry, Geometry),
                    cast(MonitoredArea.geometry, Geometry),
                ),
            ).label("frac"),
        )
        .where(
            WaterwayWay.id.in_(way_ids),
            MonitoredArea.id == place_id,
            func.ST_DWithin(WaterwayWay.geometry, MonitoredArea.geometry, tolerance_m),
        )
        .order_by(text("dist ASC"))
        .limit(1)
    ).first()
    if row is None:
        return None
    return _snap_from_fraction(row.id, float(row.frac or 0.0), float(row.dist or 0.0), way_segments)


def _snap_occurrences_to_ways(
    session: Session,
    candidates: list[OccurrenceCandidate],
    way_ids: list[uuid.UUID],
    tolerance_m: float,
    way_segments: Mapping[uuid.UUID, list[Segment]],
) -> dict[str, tuple[SnapPoint, OccurrenceCandidate]]:
    """Snap each candidate to its nearest way (within tolerance).
    Returns a map keyed on ``record_uid``. Candidates with no way within
    tolerance are omitted.
    """
    out: dict[str, tuple[SnapPoint, OccurrenceCandidate]] = {}
    if not candidates or not way_ids:
        return out
    # One round-trip: build a (record_uid, lon, lat) VALUES table and
    # LATERAL-join each candidate to its nearest waterway within tolerance.
    # Previously this was N+1 round-trips per candidate. Postgres LATERAL
    # keyword + ORDER BY dist LIMIT 1 gives us the nearest-neighbour per
    # candidate in a single plan.
    cand_by_uid = {c.record_uid: c for c in candidates}
    stmt = text(
        """
        WITH cand(record_uid, lon, lat) AS (
            SELECT * FROM unnest(
                CAST(:uids AS text[]),
                CAST(:lons AS double precision[]),
                CAST(:lats AS double precision[])
            )
        )
        SELECT
            cand.record_uid AS record_uid,
            snap.id AS way_id,
            snap.dist AS dist,
            snap.frac AS frac
        FROM cand
        JOIN LATERAL (
            SELECT
                w.id,
                ST_Distance(
                    w.geometry,
                    ST_SetSRID(ST_MakePoint(cand.lon, cand.lat), 4326)::geography
                ) AS dist,
                ST_LineLocatePoint(
                    w.geometry::geometry,
                    ST_SetSRID(ST_MakePoint(cand.lon, cand.lat), 4326)
                ) AS frac
            FROM waterway_ways AS w
            WHERE w.id = ANY(CAST(:way_ids AS uuid[]))
              AND ST_DWithin(
                  w.geometry,
                  ST_SetSRID(ST_MakePoint(cand.lon, cand.lat), 4326)::geography,
                  :tol
              )
            ORDER BY dist ASC
            LIMIT 1
        ) AS snap ON TRUE
        """
    )
    rows = session.execute(
        stmt,
        {
            "uids": list(cand_by_uid.keys()),
            "lons": [c.longitude for c in cand_by_uid.values()],
            "lats": [c.latitude for c in cand_by_uid.values()],
            "way_ids": [str(w) for w in way_ids],
            "tol": tolerance_m,
        },
    ).all()
    for row in rows:
        cand = cand_by_uid.get(row.record_uid)
        if cand is None:
            continue
        way_id = row.way_id if isinstance(row.way_id, uuid.UUID) else uuid.UUID(str(row.way_id))
        snap = _snap_from_fraction(
            way_id, float(row.frac or 0.0), float(row.dist or 0.0), way_segments
        )
        if snap is None:
            continue
        out[cand.record_uid] = (snap, cand)
    return out


def _snap_from_fraction(
    way_id: uuid.UUID,
    frac: float,
    distance_m: float,
    way_segments: Mapping[uuid.UUID, list[Segment]],
) -> SnapPoint | None:
    segs = way_segments.get(way_id)
    if not segs:
        return None
    n = len(segs)
    frac = max(0.0, min(1.0, frac))
    idx = min(int(frac * n), n - 1)
    local = frac * n - idx
    return SnapPoint(
        way_id=way_id,
        segment_index=idx,
        local_frac=local,
        distance_to_way_m=distance_m,
    )


def compute_upstream_evidence(
    session: Session,
    place_id: uuid.UUID,
    catalogue_version: str,
    candidate_occurrences: list[OccurrenceCandidate] | None = None,
) -> list[UpstreamEvidence]:
    """Compute direction-aware upstream evidence for one place.

    ``candidate_occurrences`` may be supplied by the caller (skipping the
    fetch) or left None to have this function pull them from
    ``gbif_occurrences`` itself. The function returns one row per
    accepted occurrence with the network distance in metres.
    """
    settings = get_settings()
    tolerance_m = float(settings.waterway_snap_tolerance_m)
    fetch_radius_m = float(settings.waterway_fetch_radius_km) * 1000.0
    upstream_max_m = float(settings.waterway_upstream_max_km) * 1000.0

    ways = _fetch_waterway_ways(session, place_id, fetch_radius_m)
    if not ways:
        return []
    way_segments: dict[uuid.UUID, list[Segment]] = {}
    all_segments: list[Segment] = []
    for way in ways:
        node_ids = way.node_ids or []
        if not isinstance(node_ids, list):
            continue
        segs = segments_from_way(
            way.id,
            int(way.osm_way_id),
            str(way.waterway_type),
            [int(n) for n in node_ids],
            float(way.length_m),
        )
        if not segs:
            continue
        way_segments[way.id] = segs
        all_segments.extend(segs)
    if not way_segments:
        return []
    adjacency = build_adjacency(all_segments)

    place_snap = _snap_place_to_way(
        session, place_id, ways, tolerance_m, way_segments
    )
    if place_snap is None:
        return []

    if candidate_occurrences is None:
        candidate_occurrences = _fetch_candidate_occurrences(
            session,
            place_id,
            catalogue_version,
            fetch_radius_m,
            upstream_max_m,
        )
    if not candidate_occurrences:
        return []

    snapped = _snap_occurrences_to_ways(
        session,
        candidate_occurrences,
        list(way_segments.keys()),
        tolerance_m,
        way_segments,
    )

    evidence: list[UpstreamEvidence] = []
    for record_uid, (occ_snap, cand) in snapped.items():
        dist = dijkstra_upstream_distance(
            occ_snap,
            place_snap,
            way_segments,
            adjacency,
            upstream_max_m,
        )
        if dist is None:
            continue
        osm_way_id = way_segments[occ_snap.way_id][0].osm_way_id
        evidence.append(
            UpstreamEvidence(
                record_uid=record_uid,
                species_id=cand.species_id,
                network_distance_m=dist,
                osm_way_id_snapped=osm_way_id,
                event_year=cand.event_year,
            )
        )
    return evidence


# ---------------------------------------------------------------------------
# Ranking.
# ---------------------------------------------------------------------------


def _tier_for(record: PlantAssociation) -> int:
    """3 = inside, 2 = nearby|trail_buffer, 1 = upstream-only."""
    kinds = {c.kind for c in record.evidence}
    if "inside" in kinds:
        return 3
    if kinds & {"nearby", "trail_buffer"}:
        return 2
    if "upstream_waterway" in kinds:
        return 1
    return 0


def rank(
    associations: list[PlantAssociation],
    buffer_m: float,
    upstream_max_m: float,
) -> list[PlantAssociation]:
    """Deterministic ranking: tier desc, then component scores, then
    recency, then scientific name asc.
    """
    for record in associations:
        record.tier = _tier_for(record)
        nearby_component = 0.0
        if record.closest_distance_m is not None and buffer_m > 0:
            nearby_component = max(0.0, 1.0 - record.closest_distance_m / buffer_m)
        upstream_component = 0.0
        if record.closest_network_m is not None and upstream_max_m > 0:
            upstream_component = max(0.0, 1.0 - record.closest_network_m / upstream_max_m)
        # total_score is set by compute_associations for the response
        # ranking_formula; here we simply record the components so ties
        # break deterministically.
        record._nearby_component = nearby_component  # type: ignore[attr-defined]
        record._upstream_component = upstream_component  # type: ignore[attr-defined]
    # AC 5.1.5 ordering: tier desc, nearby component desc, upstream
    # component desc, most-recent-year desc, scientific name asc. total_score
    # is kept on the response for debug/inspection but is not part of the
    # ranking spec, so it is intentionally NOT a sort key here.
    return sorted(
        associations,
        key=lambda r: (
            -r.tier,
            -(getattr(r, "_nearby_component", 0.0)),
            -(getattr(r, "_upstream_component", 0.0)),
            -(r.most_recent_year or 0),
            r.scientific_name,
        ),
    )


# ---------------------------------------------------------------------------
# Main entry point.
# ---------------------------------------------------------------------------


def compute_associations(
    session: Session,
    place_id: uuid.UUID,
) -> PlaceAssociationsResult | None:
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

    area_geom = session.scalar(
        select(MonitoredArea.geometry).where(MonitoredArea.id == place.id)
    )
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
        nearby_kind = "trail_buffer"
    else:
        buffer_m = float(settings.discovery_park_buffer_m)
        nearby_kind = "nearby"
    decay_scale_m = float(settings.discovery_decay_scale_m)
    upstream_max_m = float(settings.waterway_upstream_max_km) * 1000.0

    # geography ST_Distance / ST_DWithin -> geodesic metres (AC 5.1.3).
    distance_expr = func.ST_Distance(MonitoredArea.geometry, GbifOccurrence.location)
    inside_expr = func.ST_Covers(MonitoredArea.geometry, GbifOccurrence.location)

    rows = session.execute(
        select(
            GbifOccurrence.species_id,
            Species.name,
            Species.common_names,
            Species.reference_image_url,
            Species.evidence_codes,
            Species.malaysian_states,
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
            record = _bootstrap_association_from_row(row)
            per_species[species_id] = record
        distance_m = float(row.distance_m) if row.distance_m is not None else buffer_m
        is_inside = bool(row.is_inside) and not is_trail
        record.qualifying_records += 1
        year = int(row.event_year) if row.event_year is not None else None
        if year is not None and (
            record.most_recent_year is None or year > record.most_recent_year
        ):
            record.most_recent_year = year
        candidate_closest = 0.0 if is_inside else distance_m
        if record.closest_distance_m is None or candidate_closest < record.closest_distance_m:
            record.closest_distance_m = candidate_closest
        if is_inside:
            record.inside_area = True

    # Roll up inside/nearby buckets per species.
    for record in per_species.values():
        inside_count = 0
        nearby_count = 0
        nearby_weight_sum = 0.0
        for row in rows:
            if row.species_id != record.species_id:
                continue
            if bool(row.is_inside) and not is_trail:
                inside_count += 1
                continue
            nearby_count += 1
            dist = float(row.distance_m) if row.distance_m is not None else buffer_m
            nearby_weight_sum += (
                math.exp(-dist / decay_scale_m) if decay_scale_m > 0 else 0.0
            )
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
            weight = nearby_weight_sum / nearby_count if nearby_count else 0.0
            record.evidence.append(
                EvidenceComponent(
                    kind=nearby_kind,
                    distance_m=record.closest_distance_m,
                    weight=weight,
                    qualifying_records=nearby_count,
                    most_recent_year=record.most_recent_year,
                )
            )

    # Upstream waterway bucket (Dijkstra on waterway_ways).
    upstream = compute_upstream_evidence(session, place.id, catalogue_version)
    # Group upstream evidence per species for the response component.
    per_species_upstream: dict[str, list[UpstreamEvidence]] = defaultdict(list)
    for ev in upstream:
        per_species_upstream[ev.species_id].append(ev)
    for species_id, evs in per_species_upstream.items():
        record = per_species.get(species_id)
        if record is None:
            record = _bootstrap_association(session, species_id)
            per_species[species_id] = record
        record.direction_aware_evidence = True
        closest = min(ev.network_distance_m for ev in evs)
        record.closest_network_m = closest
        year = max(
            (ev.event_year for ev in evs if ev.event_year is not None),
            default=None,
        )
        if year is not None and (
            record.most_recent_year is None or year > record.most_recent_year
        ):
            record.most_recent_year = year
        weight = (
            math.exp(-closest / decay_scale_m) if decay_scale_m > 0 else 0.0
        )
        record.evidence.append(
            EvidenceComponent(
                kind="upstream_waterway",
                distance_m=closest,
                weight=weight,
                qualifying_records=len(evs),
                most_recent_year=year,
            )
        )

    # Score & attach ranking_formula.
    for record in per_species.values():
        score = 0.0
        formula_components: list[dict[str, object]] = []
        for component in record.evidence:
            if component.kind == "inside":
                contribution = _INSIDE_WEIGHT * component.weight
            elif component.kind in ("nearby", "trail_buffer"):
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
            formula=(
                "weight = exp(-distance_m / decay_scale_m); "
                "total_score = inside_weight*inside "
                "+ nearby_weight*mean(nearby_weights) "
                "+ upstream_weight*upstream_weight"
            ),
            coefficients={
                "inside_weight": _INSIDE_WEIGHT,
                "nearby_weight": _NEARBY_WEIGHT,
                "upstream_weight": _UPSTREAM_WEIGHT,
                "decay_scale_m": decay_scale_m,
            },
            components=formula_components,
        )

    ranked = rank(list(per_species.values()), buffer_m, upstream_max_m)

    latest_ingest = session.scalar(
        select(func.max(GbifOccurrence.ingested_at)).where(
            GbifOccurrence.catalogue_version == catalogue_version
        )
    )
    processed_data_version = session.scalar(
        select(func.max(GbifOccurrence.processed_data_version)).where(
            GbifOccurrence.catalogue_version == catalogue_version
        )
    )
    osm_source_version = session.scalar(
        select(OsmImport.source_date)
        .where(OsmImport.status == "active")
        .order_by(OsmImport.source_date.desc())
        .limit(1)
    )
    return PlaceAssociationsResult(
        place=place,
        associations=ranked,
        catalogue_version=catalogue_version,
        occurrence_data_updated_at=(
            latest_ingest.isoformat().replace("+00:00", "Z")
            if latest_ingest is not None
            else None
        ),
        disclaimer=_DISCLAIMER,
        processed_data_version=processed_data_version,
        osm_source_version=(
            osm_source_version.isoformat().replace("+00:00", "Z")
            if osm_source_version is not None
            else None
        ),
    )


def _bootstrap_association_from_row(row) -> PlantAssociation:
    common_names = row.common_names if isinstance(row.common_names, list) else []
    ev_codes = row.evidence_codes if isinstance(row.evidence_codes, list) else []
    states = row.malaysian_states if isinstance(row.malaysian_states, list) else []
    return PlantAssociation(
        species_id=row.species_id,
        scientific_name=row.name,
        common_names=[c for c in common_names if isinstance(c, str)][:6],
        catalogue_link=f"/plants/{row.species_id}",
        reference_image_url=row.reference_image_url,
        evidence_codes=[c for c in ev_codes if isinstance(c, str)],
        malaysian_states=[s for s in states if isinstance(s, str)],
    )


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
    ev_codes = species.evidence_codes if isinstance(species.evidence_codes, list) else []
    states = species.malaysian_states if isinstance(species.malaysian_states, list) else []
    return PlantAssociation(
        species_id=species_id,
        scientific_name=species.name,
        common_names=[c for c in common_names if isinstance(c, str)][:6],
        catalogue_link=f"/plants/{species_id}",
        reference_image_url=species.reference_image_url,
        evidence_codes=[c for c in ev_codes if isinstance(c, str)],
        malaysian_states=[s for s in states if isinstance(s, str)],
    )
