"""Allow 'gallery' as a report capture source.

Reports can use a gallery photo when live camera access is unavailable. This
migration widens the database constraint to match the supported capture paths.

Revision ID: 20260901_05
Revises: 20260830_04
"""

from __future__ import annotations

from sqlalchemy import text

from alembic import op

revision = "20260901_05"
down_revision = "20260830_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_capture_source_v2 CHECK "
        "(capture_source IN ('camera','gallery')) NOT VALID"
    )
    op.execute("ALTER TABLE reports VALIDATE CONSTRAINT ck_reports_capture_source_v2")
    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_capture_source")
    op.execute(
        "ALTER TABLE reports RENAME CONSTRAINT ck_reports_capture_source_v2 "
        "TO ck_reports_capture_source"
    )


def downgrade() -> None:
    gallery_count = op.get_bind().scalar(
        text("SELECT count(*) FROM reports WHERE capture_source = 'gallery'")
    )
    if gallery_count:
        raise RuntimeError(
            "Cannot downgrade while gallery reports exist; preserve or migrate their capture source first."
        )
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_capture_source_v1 CHECK "
        "(capture_source = 'camera') NOT VALID"
    )
    op.execute("ALTER TABLE reports VALIDATE CONSTRAINT ck_reports_capture_source_v1")
    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_capture_source")
    op.execute(
        "ALTER TABLE reports RENAME CONSTRAINT ck_reports_capture_source_v1 "
        "TO ck_reports_capture_source"
    )
