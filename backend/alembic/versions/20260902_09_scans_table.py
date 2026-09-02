"""Add scans table for AC 2.2.1 (server-side scan record for report consistency).

Revision ID: 20260902_09
Revises: 20260902_08
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260902_09"
down_revision = "20260902_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("capture_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column(
            "predicted_species_id",
            sa.String(length=80),
            sa.ForeignKey("species.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("outcome", sa.String(length=30), nullable=False),
        sa.Column("confidence", sa.Numeric(6, 5), nullable=False),
        sa.Column("model_version", sa.String(length=120), nullable=False),
        sa.Column("image_sha256", sa.LargeBinary(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("outcome IN ('target','other_plant','uncertain')", name="scan_outcome"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="scan_confidence"),
    )
    op.create_index("ix_scans_profile_id", "scans", ["profile_id"])


def downgrade() -> None:
    op.drop_index("ix_scans_profile_id", table_name="scans")
    op.drop_table("scans")
