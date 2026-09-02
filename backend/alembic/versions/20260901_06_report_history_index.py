"""Add the report history pagination index.

Revision ID: 20260901_06
Revises: 20260901_05
"""

from __future__ import annotations

from alembic import op

revision = "20260901_06"
down_revision = "20260901_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_reports_profile_created_id "
            "ON reports (profile_id, created_at DESC, id DESC)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_reports_profile_created_id")
