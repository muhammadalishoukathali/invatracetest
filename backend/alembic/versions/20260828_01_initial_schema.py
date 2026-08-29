"""Initial normalized InvaTrace schema.

Revision ID: 20260828_01
Revises: None
"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "20260828_01"
down_revision = None
branch_labels = None
depends_on = None

DROP_ORDER = [
    "verification_jobs",
    "verification_decisions",
    "upload_grants",
    "report_sighting_links",
    "recovery_codes",
    "inference_records",
    "sightings",
    "reports",
    "recovery_code_batches",
    "notifications",
    "installations",
    "idempotency_records",
    "audit_events",
    "trails",
    "species",
    "profiles",
    "ovcvi_stream_events",
    "ovcvi_checkpoints",
    "monitored_places",
    "monitored_areas",
    "model_versions",
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    schema = Path(__file__).with_name("20260828_01_schema.sql").read_text(encoding="utf-8")
    for statement in schema.split(";\n"):
        statement = statement.strip().removesuffix(";")
        if statement:
            op.execute(statement)


def downgrade() -> None:
    for table_name in DROP_ORDER:
        op.execute(f'DROP TABLE IF EXISTS "{table_name}"')
