"""Iteration 2 Phase 5 - Epic 5.1 place-based plant discovery.

Backs GET /api/v1/places/{place_id} and the plant-associations endpoint.
Adds:

* ``gbif_occurrences`` - cleaned occurrence rows for the catalogue's 32
  species, filtered to Malaysia + Present + valid coords + coordinate
  uncertainty within the configured ceiling.
* ``waterways`` - line geometry with a directed upstream/downstream flag
  used for the water-dispersal upstream evidence bucket. Directionless
  rows are still indexed but the discovery domain must not emit an
  upstream evidence line for them - no Euclidean fallback.
* ``monitored_areas.place_type`` / ``monitored_areas.geometry_status`` /
  ``monitored_areas.geometry_version`` so a place can advertise whether
  its polygon is authoritative (``authoritative``) or best-effort
  (``sketch``) at the point of use.

Revision ID: 20260911_16
Revises: 20260911_15
"""

from __future__ import annotations

from alembic import op


revision = "20260911_16"
down_revision = "20260911_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE monitored_areas "
        "ADD COLUMN IF NOT EXISTS place_type VARCHAR(32) NOT NULL DEFAULT 'park'"
    )
    op.execute(
        "ALTER TABLE monitored_areas "
        "ADD COLUMN IF NOT EXISTS geometry_status VARCHAR(24) NOT NULL DEFAULT 'authoritative'"
    )
    op.execute(
        "ALTER TABLE monitored_areas "
        "ADD COLUMN IF NOT EXISTS geometry_version VARCHAR(64) NOT NULL DEFAULT 'seed-2026-09'"
    )
    op.execute(
        "ALTER TABLE monitored_areas ADD CONSTRAINT ck_monitored_areas_place_type "
        "CHECK (place_type IN ('park','forest','reserve','trail_area','other'))"
    )
    op.execute(
        "ALTER TABLE monitored_areas ADD CONSTRAINT ck_monitored_areas_geometry_status "
        "CHECK (geometry_status IN ('authoritative','sketch','unsupported'))"
    )

    op.execute(
        """
        CREATE TABLE waterways (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(180),
            source VARCHAR(80) NOT NULL,
            source_id VARCHAR(120) NOT NULL,
            directed BOOLEAN NOT NULL DEFAULT FALSE,
            line geography(LineString, 4326) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (source, source_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_waterways_line_gist ON waterways USING gist (line)")

    op.execute(
        """
        CREATE TABLE gbif_occurrences (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            species_id VARCHAR(120) NOT NULL REFERENCES species(id) ON DELETE CASCADE,
            source VARCHAR(40) NOT NULL DEFAULT 'gbif',
            source_occurrence_id VARCHAR(120) NOT NULL,
            country_code CHAR(2) NOT NULL,
            occurrence_status VARCHAR(16) NOT NULL DEFAULT 'PRESENT',
            latitude NUMERIC(8, 5) NOT NULL,
            longitude NUMERIC(8, 5) NOT NULL,
            location geography(Point, 4326)
                GENERATED ALWAYS AS
                (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
            coordinate_uncertainty_m NUMERIC(8, 2),
            event_year INTEGER,
            event_date DATE,
            catalogue_version VARCHAR(32) NOT NULL,
            ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (source, source_occurrence_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_gbif_occurrences_location_gist "
        "ON gbif_occurrences USING gist (location)"
    )
    op.execute(
        "CREATE INDEX ix_gbif_occurrences_species "
        "ON gbif_occurrences (species_id, event_year DESC)"
    )
    op.execute(
        "ALTER TABLE gbif_occurrences ADD CONSTRAINT ck_gbif_occurrences_country_my "
        "CHECK (country_code = 'MY')"
    )
    op.execute(
        "ALTER TABLE gbif_occurrences ADD CONSTRAINT ck_gbif_occurrences_present "
        "CHECK (occurrence_status = 'PRESENT')"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS gbif_occurrences")
    op.execute("DROP TABLE IF EXISTS waterways")
    op.execute("ALTER TABLE monitored_areas DROP CONSTRAINT IF EXISTS ck_monitored_areas_place_type")
    op.execute("ALTER TABLE monitored_areas DROP CONSTRAINT IF EXISTS ck_monitored_areas_geometry_status")
    op.execute("ALTER TABLE monitored_areas DROP COLUMN IF EXISTS geometry_version")
    op.execute("ALTER TABLE monitored_areas DROP COLUMN IF EXISTS geometry_status")
    op.execute("ALTER TABLE monitored_areas DROP COLUMN IF EXISTS place_type")
