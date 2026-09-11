"""Phase 10 Wave 1 - Direction-Aware Place Association schema.

Additive migration that introduces the new place-discovery engine:

* ``species_dispersal_traits`` - curated per-species dispersal evidence
  that gates AC 5.1.4 upstream reasoning (habitat-string matching is
  explicitly forbidden; only rows here with
  ``waterway_direction_eligible = TRUE`` are permitted).
* ``waterway_ways`` - one row per accepted OSM waterway way, with
  ``node_ids`` preserved so the runtime can split each way into
  consecutive directed segments in memory without a per-segment table.
  The legacy ``waterways`` table is kept intact for one release for
  downgrade purposes.
* Extra columns on ``gbif_occurrences``, ``osm_imports``,
  ``monitored_areas`` and ``trails`` to carry provenance and stable
  external ids.

Every DDL statement uses ``IF (NOT) EXISTS`` so the migration is safe to
re-run against a database that already carries some of the new objects.

Revision ID: 20260911_19
Revises: 20260911_18
"""

from __future__ import annotations

from alembic import op


revision = "20260911_19"
down_revision = "20260911_18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. species_dispersal_traits ---------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS species_dispersal_traits (
            species_id VARCHAR(80) PRIMARY KEY REFERENCES species(id) ON DELETE CASCADE,
            spread_mechanisms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            primary_mechanism VARCHAR(40),
            waterway_direction_eligible BOOLEAN NOT NULL DEFAULT FALSE,
            waterway_evidence_type VARCHAR(40),
            evidence_strength VARCHAR(24),
            source_title TEXT,
            source_organisation TEXT,
            source_url TEXT,
            evidence_summary TEXT,
            reviewed_at DATE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )

    # 2. waterway_ways --------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS waterway_ways (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            osm_import_id UUID NOT NULL REFERENCES osm_imports(id) ON DELETE CASCADE,
            osm_way_id BIGINT NOT NULL,
            waterway_type VARCHAR(16) NOT NULL,
            name VARCHAR(200),
            node_ids BIGINT[] NOT NULL,
            geometry geography(LINESTRING, 4326) NOT NULL,
            length_m NUMERIC(12, 2) NOT NULL,
            direction_basis VARCHAR(32) NOT NULL DEFAULT 'OSM_WAY_NODE_ORDER',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_waterway_ways_type CHECK (waterway_type IN ('river','stream','canal','drain')),
            CONSTRAINT ck_waterway_ways_min_nodes CHECK (cardinality(node_ids) >= 2),
            CONSTRAINT ck_waterway_ways_length CHECK (length_m > 0),
            CONSTRAINT uq_waterway_ways_import_way UNIQUE (osm_import_id, osm_way_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_waterway_ways_osm_import_id "
        "ON waterway_ways(osm_import_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_waterway_ways_geometry "
        "ON waterway_ways USING GIST (geometry)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_waterway_ways_osm_way_id "
        "ON waterway_ways(osm_way_id)"
    )

    # 3. gbif_occurrences extensions -----------------------------------------
    op.execute("ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS record_uid VARCHAR(64)")
    op.execute("ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS dataset_name TEXT")
    op.execute("ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS dataset_key VARCHAR(64)")
    op.execute("ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS licence TEXT")
    op.execute("ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS source_url TEXT")
    op.execute(
        "ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS basis_of_record VARCHAR(32)"
    )
    op.execute(
        "ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS state_province VARCHAR(80)"
    )
    op.execute("ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS locality TEXT")
    op.execute(
        "ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS "
        "eligible_for_waterway_direction BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE gbif_occurrences ADD COLUMN IF NOT EXISTS "
        "processed_data_version VARCHAR(64) NOT NULL DEFAULT 'legacy'"
    )
    op.execute(
        "UPDATE gbif_occurrences SET record_uid = source || ':' || source_occurrence_id "
        "WHERE record_uid IS NULL"
    )
    # Partial: legacy rows without record_uid must not all collapse into one
    # conflict target; the backfill above handles historical rows but a future
    # legacy insert should still be allowed to leave record_uid NULL.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_gbif_occurrences_record_uid "
        "ON gbif_occurrences(record_uid) WHERE record_uid IS NOT NULL"
    )

    # 4. osm_imports extensions ----------------------------------------------
    op.execute("ALTER TABLE osm_imports ADD COLUMN IF NOT EXISTS provider VARCHAR(80)")
    op.execute("ALTER TABLE osm_imports ADD COLUMN IF NOT EXISTS source_url TEXT")
    op.execute("ALTER TABLE osm_imports ADD COLUMN IF NOT EXISTS download_date DATE")
    op.execute(
        "ALTER TABLE osm_imports ADD COLUMN IF NOT EXISTS "
        "status VARCHAR(16) NOT NULL DEFAULT 'active'"
    )
    op.execute(
        "ALTER TABLE osm_imports ADD COLUMN IF NOT EXISTS "
        "waterway_count INTEGER NOT NULL DEFAULT 0"
    )
    op.execute("ALTER TABLE osm_imports ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ")
    op.execute("ALTER TABLE osm_imports ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'ck_osm_imports_status'
            ) THEN
                ALTER TABLE osm_imports
                ADD CONSTRAINT ck_osm_imports_status
                CHECK (status IN ('loading','active','failed')) NOT VALID;
            END IF;
        END
        $$;
        """
    )

    # 5. monitored_areas + trails source_feature_id --------------------------
    op.execute(
        "ALTER TABLE monitored_areas ADD COLUMN IF NOT EXISTS source_feature_id VARCHAR(80)"
    )
    op.execute("ALTER TABLE trails ADD COLUMN IF NOT EXISTS source_feature_id VARCHAR(80)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_monitored_areas_source_feature_id "
        "ON monitored_areas(source_feature_id) WHERE source_feature_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_trails_source_feature_id "
        "ON trails(source_feature_id) WHERE source_feature_id IS NOT NULL"
    )


def downgrade() -> None:
    # Reverse in opposite order. Everything guarded with IF EXISTS so a
    # partially-applied migration can still roll back cleanly.

    # 5. monitored_areas + trails
    op.execute("DROP INDEX IF EXISTS uq_trails_source_feature_id")
    op.execute("DROP INDEX IF EXISTS uq_monitored_areas_source_feature_id")
    op.execute("ALTER TABLE trails DROP COLUMN IF EXISTS source_feature_id")
    op.execute("ALTER TABLE monitored_areas DROP COLUMN IF EXISTS source_feature_id")

    # 4. osm_imports
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'ck_osm_imports_status'
            ) THEN
                ALTER TABLE osm_imports DROP CONSTRAINT ck_osm_imports_status;
            END IF;
        END
        $$;
        """
    )
    op.execute("ALTER TABLE osm_imports DROP COLUMN IF EXISTS completed_at")
    op.execute("ALTER TABLE osm_imports DROP COLUMN IF EXISTS started_at")
    op.execute("ALTER TABLE osm_imports DROP COLUMN IF EXISTS waterway_count")
    op.execute("ALTER TABLE osm_imports DROP COLUMN IF EXISTS status")
    op.execute("ALTER TABLE osm_imports DROP COLUMN IF EXISTS download_date")
    op.execute("ALTER TABLE osm_imports DROP COLUMN IF EXISTS source_url")
    op.execute("ALTER TABLE osm_imports DROP COLUMN IF EXISTS provider")

    # 3. gbif_occurrences
    op.execute("DROP INDEX IF EXISTS uq_gbif_occurrences_record_uid")
    op.execute(
        "ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS processed_data_version"
    )
    op.execute(
        "ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS eligible_for_waterway_direction"
    )
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS locality")
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS state_province")
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS basis_of_record")
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS source_url")
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS licence")
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS dataset_key")
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS dataset_name")
    op.execute("ALTER TABLE gbif_occurrences DROP COLUMN IF EXISTS record_uid")

    # 2. waterway_ways
    op.execute("DROP INDEX IF EXISTS ix_waterway_ways_osm_way_id")
    op.execute("DROP INDEX IF EXISTS ix_waterway_ways_geometry")
    op.execute("DROP INDEX IF EXISTS ix_waterway_ways_osm_import_id")
    op.execute("DROP TABLE IF EXISTS waterway_ways")

    # 1. species_dispersal_traits
    op.execute("DROP TABLE IF EXISTS species_dispersal_traits")
