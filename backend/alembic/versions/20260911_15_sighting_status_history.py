"""Iteration 2 Phase 4 - community removal reporting (Epic 4).

Extends ``sightings.status`` to allow ``removal_reported`` (a community-
reported removal, distinct from the admin/system-forced ``removed``) and
adds ``sighting_status_history`` to keep an append-only audit trail of
every status transition that a community removal-report or admin action
drives. The history row captures the submitter's coordinates and the
computed distance to the sighting so we can defend the vicinity check
after the fact.

Revision ID: 20260911_15
Revises: 20260911_14
"""

from __future__ import annotations

from alembic import op


revision = "20260911_15"
down_revision = "20260911_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend the sightings.status CHECK constraint to allow the new
    # community-reported removal state without dropping the existing rows.
    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK ("
        "status IN ('candidate','screened','rejected','removed','merged','removal_reported'))"
    )
    op.execute(
        """
        CREATE TABLE sighting_status_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sighting_id UUID NOT NULL REFERENCES sightings(id) ON DELETE CASCADE,
            from_status VARCHAR(20) NOT NULL,
            to_status VARCHAR(20) NOT NULL,
            actor_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
            submitted_lat NUMERIC(8, 5),
            submitted_lon NUMERIC(8, 5),
            submitted_accuracy_m INTEGER,
            calculated_distance_m NUMERIC(10, 2),
            idempotency_key VARCHAR(128),
            event_time_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_sighting_status_history_sighting "
        "ON sighting_status_history (sighting_id, event_time_utc DESC)"
    )
    op.execute(
        "CREATE INDEX ix_sighting_status_history_actor "
        "ON sighting_status_history (actor_profile_id, event_time_utc DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS sighting_status_history")
    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK ("
        "status IN ('candidate','screened','rejected','removed','merged'))"
    )
