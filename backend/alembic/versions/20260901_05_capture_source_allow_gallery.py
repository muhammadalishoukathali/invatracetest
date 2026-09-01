"""Allow 'gallery' as a report capture source.

Reporting was gated to live-camera captures only, which made the feature
untestable from the file-picker path. The frontend already supports both
sources; this migration widens the DB check constraint to match.

Revision ID: 20260901_05
Revises: 20260830_04
"""

from __future__ import annotations

from alembic import op

revision = "20260901_05"
down_revision = "20260830_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_capture_source")
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_capture_source CHECK "
        "(capture_source IN ('camera','gallery'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_capture_source")
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_capture_source CHECK "
        "(capture_source = 'camera')"
    )
