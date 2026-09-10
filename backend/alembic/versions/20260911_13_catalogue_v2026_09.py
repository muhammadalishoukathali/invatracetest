"""Iteration 2 Phase 2 - 32-species evidence catalogue fields + versions table.

Adds the columns the Iteration 2 catalogue (32 evidence-confirmed species)
needs on ``species`` so the plant-detail screen can render evidence codes,
sources, states, habitat, reference imagery with attribution, and the AC
5.2.4 "formal severity assessment / beginner-safe action" availability
flags. All columns default null/false so pre-existing rows stay valid until
the seeder rewrites them.

Also introduces ``catalogue_versions`` - one row per published catalogue
snapshot - so the API can serve the version metadata alongside the species
list without hardcoding it in Python.

Revision ID: 20260911_13
Revises: 20260903_12
"""

from __future__ import annotations

from alembic import op


revision = "20260911_13"
down_revision = "20260903_12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE species ADD COLUMN catalogue_version VARCHAR(32)")
    op.execute("ALTER TABLE species ADD COLUMN evidence_codes JSONB DEFAULT '[]'::jsonb NOT NULL")
    op.execute("ALTER TABLE species ADD COLUMN evidence_sources JSONB DEFAULT '[]'::jsonb NOT NULL")
    op.execute("ALTER TABLE species ADD COLUMN malaysian_states JSONB DEFAULT '[]'::jsonb NOT NULL")
    op.execute("ALTER TABLE species ADD COLUMN habitat VARCHAR(60)")
    op.execute("ALTER TABLE species ADD COLUMN accepted_name_usage VARCHAR(160)")
    op.execute("ALTER TABLE species ADD COLUMN reference_image_url VARCHAR(500)")
    op.execute("ALTER TABLE species ADD COLUMN image_attribution JSONB")
    op.execute("ALTER TABLE species ADD COLUMN identifying_characteristics TEXT")
    op.execute("ALTER TABLE species ADD COLUMN typical_habitat TEXT")
    op.execute("ALTER TABLE species ADD COLUMN documented_impacts TEXT")
    op.execute(
        "ALTER TABLE species ADD COLUMN severity_assessment_available BOOLEAN "
        "DEFAULT FALSE NOT NULL"
    )
    op.execute(
        "ALTER TABLE species ADD COLUMN beginner_safe_action_available BOOLEAN "
        "DEFAULT FALSE NOT NULL"
    )
    op.execute("ALTER TABLE species ADD COLUMN last_reviewed_at TIMESTAMPTZ")
    op.execute(
        "CREATE INDEX ix_species_catalogue_version ON species (catalogue_version)"
    )

    op.execute(
        """
        CREATE TABLE catalogue_versions (
            version VARCHAR(32) PRIMARY KEY,
            published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_at DATE NOT NULL,
            total_species_count INTEGER NOT NULL,
            notes TEXT
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS catalogue_versions")
    op.execute("DROP INDEX IF EXISTS ix_species_catalogue_version")
    for col in (
        "last_reviewed_at",
        "beginner_safe_action_available",
        "severity_assessment_available",
        "documented_impacts",
        "typical_habitat",
        "identifying_characteristics",
        "image_attribution",
        "reference_image_url",
        "accepted_name_usage",
        "habitat",
        "malaysian_states",
        "evidence_sources",
        "evidence_codes",
        "catalogue_version",
    ):
        op.execute(f"ALTER TABLE species DROP COLUMN IF EXISTS {col}")
