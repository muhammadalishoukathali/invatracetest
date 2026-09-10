"""Iteration 2 Phase 7 - Epic 6 adopted areas + activity indicators.

Adds:

* ``area_adoptions`` - a per-profile bookmark of a MonitoredArea. Enforces
  AC 6.1.3 with a unique constraint on ``(profile_id, place_id)`` and caps
  the total per identity at ADOPTION_MAX_PER_IDENTITY via router logic
  backed by a fast count query on this same index.

The 30-day activity indicators + DBSCAN clustering are computed on the
fly inside app.domain.activity_indicators from the existing sightings /
report_sighting_links / sighting_status_history tables - no materialised
view. Deferred: if the indicator query ever ends up on a slow-page path
we swap it for a view later without changing the router surface.

Revision ID: 20260911_17
Revises: 20260911_16
"""

from __future__ import annotations

from alembic import op


revision = "20260911_17"
down_revision = "20260911_16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE area_adoptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            place_id UUID NOT NULL REFERENCES monitored_areas(id) ON DELETE CASCADE,
            adopted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_area_adoptions_profile_place UNIQUE (profile_id, place_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_area_adoptions_profile ON area_adoptions (profile_id)")
    op.execute("CREATE INDEX ix_area_adoptions_place ON area_adoptions (place_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS area_adoptions")
