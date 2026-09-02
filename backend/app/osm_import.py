"""One-off/occasional importer for OSM place data (parks, reserves, trails).

Reads a Malaysia-clipped .osm.pbf extract with pyosmium and loads named
parks/forests/reserves as MonitoredArea rows and named paths/tracks as
Trail rows. These feed app/domain/place_association.py, which snaps a
sighting's raw lat/lng to a human-readable place name. Invoked via the
`import-osm` CLI command in app/cli.py, not from the API.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path

import osmium
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import MonitoredArea, OsmImport, Trail

# Which OSM tag pairs count as an "area" worth importing, and which highway
# types count as a walkable "trail". Anything else in the extract gets skipped.
AREA_TAGS = {
    ("leisure", "park"),
    ("leisure", "nature_reserve"),
    ("boundary", "national_park"),
    ("boundary", "protected_area"),
    ("landuse", "forest"),
    ("natural", "wood"),
}
TRAIL_HIGHWAYS = {"path", "footway", "track"}


class MalaysiaOsmHandler(osmium.SimpleHandler):
    """pyosmium visitor that streams through the .pbf and inserts matching
    areas/ways as it goes, rather than loading the whole extract into memory
    first. See import_malaysia_pbf() below for how this gets invoked."""

    def __init__(self, session: Session) -> None:
        super().__init__()
        self.session = session
        self.factory = osmium.geom.WKTFactory()
        self.area_count = 0
        self.trail_count = 0

    def area(self, area) -> None:
        tags = area.tags
        name = tags.get("name")
        if not name or not any(tags.get(key) == value for key, value in AREA_TAGS):
            return
        try:
            wkt = self.factory.create_multipolygon(area)
        except (RuntimeError, osmium.InvalidLocationError):
            # Some OSM geometry is malformed or references missing nodes -
            # just skip it rather than blow up the whole import.
            return
        label = self._unique_label(name, MonitoredArea, f"area/{area.orig_id()}")
        self.session.add(
            MonitoredArea(
                name=label,
                geometry=func.ST_GeogFromText(f"SRID=4326;{wkt}"),
                metadata_json={
                    "source": "OpenStreetMap",
                    "osmType": "area",
                    "osmId": str(area.orig_id()),
                },
            )
        )
        self.session.flush()
        self.area_count += 1

    def way(self, way) -> None:
        tags = way.tags
        name = tags.get("name")
        if (
            not name
            or tags.get("highway") not in TRAIL_HIGHWAYS
            or tags.get("access") in {"private", "no"}
        ):
            return
        try:
            line = self.factory.create_linestring(way)
        except (RuntimeError, osmium.InvalidLocationError):
            return
        if not line.startswith("LINESTRING"):
            return
        # Trail.geometry is a MULTILINESTRING column (so a trail can later be
        # made of several disjoint segments), so wrap the single line we get here.
        multiline = f"MULTILINESTRING({line.removeprefix('LINESTRING')})"
        label = self._unique_label(name, Trail, f"way/{way.id}")
        self.session.add(
            Trail(
                name=label,
                geometry=func.ST_GeogFromText(f"SRID=4326;{multiline}"),
                metadata_json={
                    "source": "OpenStreetMap",
                    "osmType": "way",
                    "osmId": str(way.id),
                },
            )
        )
        self.session.flush()
        self.trail_count += 1

    def _unique_label(self, name: str, model, osm_reference: str) -> str:
        # OSM has plenty of duplicate place names (multiple "Taman"s etc) - rather
        # than silently overwrite/skip, disambiguate the second one onward with
        # its OSM id so both stay visible and queryable.
        existing = self.session.scalar(select(model.id).where(model.name == name))
        return name if not existing else f"{name} · OSM {osm_reference}"


def import_malaysia_pbf(session: Session, *, source_path: Path, source_date: datetime) -> OsmImport:
    """Entry point for the `import-osm` CLI command. Hashes the source file so
    re-running the import with the same extract is a cheap no-op (returns the
    existing OsmImport record) instead of re-inserting everything."""
    if source_path.suffix.lower() != ".pbf":
        raise ValueError("the OSM source must be a Malaysia-clipped .osm.pbf or .pbf file")
    digest_builder = hashlib.sha256()
    with source_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest_builder.update(chunk)
    digest = digest_builder.digest()
    existing = session.scalar(select(OsmImport).where(OsmImport.sha256 == digest))
    if existing:
        return existing
    handler = MalaysiaOsmHandler(session)
    # locations=True + flex_mem index keeps node coordinates around in memory as
    # we stream through, which the geometry factory above needs to build ways.
    handler.apply_file(str(source_path), locations=True, idx="flex_mem")
    imported = OsmImport(
        source_name=source_path.name,
        source_date=source_date,
        sha256=digest,
        area_count=handler.area_count,
        trail_count=handler.trail_count,
        metadata_json={
            "source": "OpenStreetMap",
            "license": "ODbL",
            "scope": "caller-confirmed Malaysia-clipped extract",
        },
    )
    session.add(imported)
    session.commit()
    return imported
