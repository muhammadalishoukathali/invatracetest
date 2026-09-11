"""One-off/occasional importer for OSM place data (parks, reserves, trails, waterways).

Reads a Malaysia-clipped .osm.pbf extract with pyosmium and loads named
parks/forests/reserves as MonitoredArea rows, named paths/tracks as Trail
rows, and (Phase 10 Wave 2b) river/stream/canal/drain ways as WaterwayWay
rows. Feeds app/domain/place_association.py + upstream evidence discovery.
Invoked via the `import-osm` CLI command in app/cli.py, not from the API.
"""

from __future__ import annotations

import hashlib
import math
from datetime import UTC, datetime
from pathlib import Path

import osmium
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import MonitoredArea, OsmImport, Trail, WaterwayWay

AREA_TAGS = {
    ("leisure", "park"),
    ("leisure", "nature_reserve"),
    ("boundary", "national_park"),
    ("boundary", "protected_area"),
    ("landuse", "forest"),
    ("natural", "wood"),
}
# AC 5.1.1: list_places filters by place_type (park|forest|trail|line).
# Map every accepted OSM area tag to one of park/forest.
_AREA_PLACE_TYPE = {
    ("leisure", "park"): "park",
    ("leisure", "nature_reserve"): "forest",
    ("boundary", "national_park"): "forest",
    ("boundary", "protected_area"): "forest",
    ("landuse", "forest"): "forest",
    ("natural", "wood"): "forest",
}
TRAIL_HIGHWAYS = {"path", "footway", "track"}
# Phase 10 Wave 2b - allow-listed waterway types. ditch is explicitly
# excluded per HANDOVER_PBF_AND_WATERWAY_INGEST doc 2 (too noisy for
# upstream evidence and not a meaningful dispersal corridor).
WATERWAY_TAGS = {"river", "stream", "canal", "drain"}

_WATERWAY_BATCH_SIZE = 500


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS84 points. Used at
    import-time so we don't have to round-trip through PostGIS to store a
    length_m per way."""
    r = 6371008.8  # mean Earth radius (m) matching PostGIS's default sphere
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class MalaysiaOsmHandler(osmium.SimpleHandler):
    """pyosmium visitor that streams through the .pbf and inserts matching
    areas/ways as it goes, rather than loading the whole extract into memory
    first. See import_malaysia_pbf() below for how this gets invoked."""

    def __init__(
        self,
        session: Session,
        osm_import_id,
        *,
        include_waterways: bool = False,
    ) -> None:
        super().__init__()
        self.session = session
        self.factory = osmium.geom.WKTFactory()
        self.osm_import_id = osm_import_id
        self.include_waterways = include_waterways
        self.imported_areas_count = 0
        self.imported_trails_count = 0
        self.waterway_count = 0
        self.rejected_waterway_count = 0
        self._waterway_buffer: list[dict] = []

    # Back-compat property accessors so existing callers reading area_count /
    # trail_count still work.
    @property
    def area_count(self) -> int:
        return self.imported_areas_count

    @property
    def trail_count(self) -> int:
        return self.imported_trails_count

    def area(self, area) -> None:
        tags = area.tags
        name = tags.get("name")
        if not name:
            return
        matched_tag = next(
            ((key, value) for key, value in AREA_TAGS if tags.get(key) == value),
            None,
        )
        if matched_tag is None:
            return
        try:
            wkt = self.factory.create_multipolygon(area)
        except (RuntimeError, osmium.InvalidLocationError):
            return
        label = self._unique_label(name, MonitoredArea, f"area/{area.orig_id()}")
        tag_key, tag_value = matched_tag
        place_type = _AREA_PLACE_TYPE[matched_tag]
        self.session.add(
            MonitoredArea(
                name=label,
                place_type=place_type,
                source_feature_id=f"osm:area:{area.orig_id()}",
                geometry=func.ST_GeogFromText(f"SRID=4326;{wkt}"),
                metadata_json={
                    "source": "OpenStreetMap",
                    "osmType": "area",
                    "osmId": str(area.orig_id()),
                    tag_key: tag_value,
                },
            )
        )
        self.session.flush()
        self.imported_areas_count += 1

    def way(self, way) -> None:
        tags = way.tags
        # ---- trail handling (unchanged behaviour) ------------------------
        name = tags.get("name")
        highway = tags.get("highway")
        if name and highway in TRAIL_HIGHWAYS and tags.get("access") not in {"private", "no"}:
            try:
                line = self.factory.create_linestring(way)
            except (RuntimeError, osmium.InvalidLocationError):
                line = None
            if line and line.startswith("LINESTRING"):
                multiline = f"MULTILINESTRING({line.removeprefix('LINESTRING')})"
                label = self._unique_label(name, Trail, f"way/{way.id}")
                self.session.add(
                    Trail(
                        name=label,
                        source_feature_id=f"osm:way:{way.id}",
                        geometry=func.ST_GeogFromText(f"SRID=4326;{multiline}"),
                        metadata_json={
                            "source": "OpenStreetMap",
                            "osmType": "way",
                            "osmId": str(way.id),
                            "highway": tags.get("highway"),
                        },
                    )
                )
                self.session.flush()
                self.imported_trails_count += 1

        # ---- waterway handling (Phase 10 Wave 2b) ------------------------
        if not self.include_waterways:
            return
        waterway_type = tags.get("waterway")
        if waterway_type not in WATERWAY_TAGS:
            return
        # ditch is not in WATERWAY_TAGS but leave a defensive check in case
        # the allow-list is ever widened.
        if waterway_type == "ditch":
            return

        nodes = list(way.nodes)
        if len(nodes) < 2:
            self.rejected_waterway_count += 1
            return
        coords: list[tuple[float, float]] = []
        node_ids: list[int] = []
        try:
            for n in nodes:
                loc = n.location
                if not loc.valid():
                    raise osmium.InvalidLocationError()
                coords.append((loc.lon, loc.lat))
                node_ids.append(int(n.ref))
        except (RuntimeError, osmium.InvalidLocationError):
            self.rejected_waterway_count += 1
            return
        if len(coords) < 2:
            self.rejected_waterway_count += 1
            return

        try:
            line_wkt = self.factory.create_linestring(way)
        except (RuntimeError, osmium.InvalidLocationError):
            self.rejected_waterway_count += 1
            return
        if not line_wkt or not line_wkt.startswith("LINESTRING"):
            self.rejected_waterway_count += 1
            return

        length_m = 0.0
        for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
            length_m += _haversine_m(lat1, lon1, lat2, lon2)

        self._waterway_buffer.append(
            {
                "osm_import_id": self.osm_import_id,
                "osm_way_id": int(way.id),
                "waterway_type": waterway_type,
                "name": tags.get("name"),
                "node_ids": node_ids,
                "geometry": f"SRID=4326;{line_wkt}",
                "length_m": round(length_m, 2),
                "direction_basis": "OSM_WAY_NODE_ORDER",
            }
        )
        if len(self._waterway_buffer) >= _WATERWAY_BATCH_SIZE:
            self.flush_waterways()

    def flush_waterways(self) -> None:
        """Bulk-insert buffered waterway ways. Uses ON CONFLICT DO NOTHING on
        (osm_import_id, osm_way_id) so a retried import within the same
        OsmImport row is idempotent."""
        if not self._waterway_buffer:
            return
        rows = self._waterway_buffer
        self._waterway_buffer = []
        # Convert the plain WKT string to a geography via ST_GeogFromText in
        # the VALUES list.
        values = [
            {
                **r,
                "geometry": func.ST_GeogFromText(r["geometry"]),
            }
            for r in rows
        ]
        table = WaterwayWay.__table__
        stmt = pg_insert(table).values(values)
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["osm_import_id", "osm_way_id"]
        )
        result = self.session.execute(stmt)
        # rowcount is best-effort - trust the caller-visible counter over it.
        self.waterway_count += result.rowcount if result.rowcount is not None else len(rows)
        # NOTE: no commit here. The outer import_malaysia_pbf() owns the
        # transaction lifecycle so a mid-import failure rolls back cleanly.
        self.session.flush()

    def _unique_label(self, name: str, model, osm_reference: str) -> str:
        existing = self.session.scalar(select(model.id).where(model.name == name))
        return name if not existing else f"{name} · OSM {osm_reference}"


def import_malaysia_pbf(
    session: Session,
    *,
    source_path: Path,
    source_date: datetime,
    include_waterways: bool = False,
    provider: str = "openstreetmap.fr",
    source_url: str | None = None,
    download_date=None,
) -> OsmImport:
    """Entry point for the `import-osm` CLI command. Hashes the source file so
    re-running the import with the same extract is a cheap no-op (returns the
    existing active OsmImport record) instead of re-inserting everything."""
    if source_path.suffix.lower() != ".pbf":
        raise ValueError("the OSM source must be a Malaysia-clipped .osm.pbf or .pbf file")
    digest_builder = hashlib.sha256()
    with source_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest_builder.update(chunk)
    digest = digest_builder.digest()
    existing = session.scalar(select(OsmImport).where(OsmImport.sha256 == digest))
    if existing and existing.status == "active":
        return existing

    # Insert a loading row up front so a mid-import failure leaves a
    # visible failed record for operators.
    imported = OsmImport(
        source_name=source_path.name,
        source_date=source_date,
        sha256=digest,
        area_count=0,
        trail_count=0,
        waterway_count=0,
        provider=provider,
        source_url=source_url,
        download_date=download_date,
        status="loading",
        started_at=datetime.now(UTC),
        metadata_json={
            "source": "OpenStreetMap",
            "license": "ODbL",
            "scope": "caller-confirmed Malaysia-clipped extract",
            "include_waterways": include_waterways,
        },
    )
    session.add(imported)
    session.commit()

    handler = MalaysiaOsmHandler(
        session, imported.id, include_waterways=include_waterways
    )
    try:
        handler.apply_file(str(source_path), locations=True, idx="flex_mem")
        handler.flush_waterways()
        imported.area_count = handler.imported_areas_count
        imported.trail_count = handler.imported_trails_count
        imported.waterway_count = handler.waterway_count
        imported.status = "active"
        imported.completed_at = datetime.now(UTC)
        # NOTE: operators retire any previously-`active` row for the same
        # provider manually; this importer never auto-retires them.
        session.commit()
    except Exception:
        session.rollback()
        session.query(OsmImport).filter(OsmImport.id == imported.id).update(
            {
                "status": "failed",
                "completed_at": datetime.now(UTC),
            }
        )
        session.commit()
        raise
    return imported
