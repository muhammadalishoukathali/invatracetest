"""Add durable object deletion jobs.

Revision ID: 20260901_07
Revises: 20260901_06
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260901_07"
down_revision = "20260901_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "object_deletion_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("object_key", sa.String(length=500), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key", name="uq_object_deletion_job_key"),
    )
    op.create_index(
        "ix_object_deletion_jobs_available_at",
        "object_deletion_jobs",
        ["available_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_object_deletion_jobs_available_at", table_name="object_deletion_jobs")
    op.drop_table("object_deletion_jobs")
