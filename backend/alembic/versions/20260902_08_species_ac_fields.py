"""Add AC-required fields to species (Epic 1.2 + Epic 3 guidance).

Revision ID: 20260902_08
Revises: 20260901_07
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260902_08"
down_revision = "20260901_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("species", sa.Column("malaysia_status", sa.String(length=60), nullable=True))
    op.add_column("species", sa.Column("status_source", sa.String(length=200), nullable=True))
    op.add_column(
        "species", sa.Column("status_reviewed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("species", sa.Column("general_information", sa.Text(), nullable=True))
    op.add_column(
        "species",
        sa.Column("action_eligible", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "species", sa.Column("guidance_content_version", sa.String(length=60), nullable=True)
    )
    op.add_column(
        "species", sa.Column("guidance_last_reviewed", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "species",
        sa.Column(
            "guidance_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("species", "guidance_metadata")
    op.drop_column("species", "guidance_last_reviewed")
    op.drop_column("species", "guidance_content_version")
    op.drop_column("species", "action_eligible")
    op.drop_column("species", "general_information")
    op.drop_column("species", "status_reviewed_at")
    op.drop_column("species", "status_source")
    op.drop_column("species", "malaysia_status")
