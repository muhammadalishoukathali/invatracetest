"""Iteration 2 Phase 3 - protected_areas table for location-context PIP.

Backs POST /api/v1/location-context. A separate table (rather than reusing
``monitored_areas``) so we can distinguish "protected" (national parks,
gazetted forest reserves, wildlife sanctuaries) from generic OSM green
patches and version the boundary dataset independently. Callers get back the
row's ``source`` + ``dataset_version`` so the UI can attribute the check.

Revision ID: 20260911_14
Revises: 20260911_13
"""

from __future__ import annotations

from alembic import op


revision = "20260911_14"
down_revision = "20260911_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE protected_areas (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            source TEXT NOT NULL,
            dataset_version TEXT NOT NULL,
            geometry geography(MultiPolygon, 4326) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_protected_areas_geometry_gist "
        "ON protected_areas USING gist (geometry)"
    )
    op.execute(
        "CREATE INDEX ix_protected_areas_source_version "
        "ON protected_areas (source, dataset_version)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS protected_areas")
