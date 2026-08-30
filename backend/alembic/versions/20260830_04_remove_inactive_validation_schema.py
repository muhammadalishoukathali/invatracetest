"""Remove inactive validation schema from the Iteration 1 runtime.

Revision ID: 20260830_04
Revises: 20260830_03
"""

from __future__ import annotations

from alembic import op

revision = "20260830_04"
down_revision = "20260830_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE profiles DROP CONSTRAINT ck_profiles_role")
    op.execute("UPDATE profiles SET role = 'Volunteer' WHERE role = 'Coordinator'")
    op.execute(
        "ALTER TABLE profiles ADD CONSTRAINT ck_profiles_role CHECK "
        "(role IN ('Detector','Volunteer','Expert','Admin'))"
    )

    op.execute("DROP TABLE IF EXISTS verification_decisions")
    op.execute("DROP TABLE IF EXISTS inference_records")
    op.execute("DROP TABLE IF EXISTS model_versions")
    op.execute("DROP TABLE IF EXISTS ovcvi_stream_events")
    op.execute("DROP TABLE IF EXISTS ovcvi_checkpoints")
    op.execute("ALTER TABLE reports DROP COLUMN IF EXISTS validation_model_version")
    op.execute("ALTER TABLE automated_validation_decisions DROP COLUMN IF EXISTS model_version")


def downgrade() -> None:
    raise RuntimeError(
        "20260830_04 removes unused schema and cannot restore discarded placeholder data"
    )
