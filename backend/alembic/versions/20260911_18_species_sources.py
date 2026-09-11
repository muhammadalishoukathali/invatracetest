"""Iteration 2 Phase 5 - Epic 5.2.5 structured sources column on species.

Adds ``species.sources`` (JSONB, nullable): a list of
``{title, url_or_id, image_creator?, licence?, review_date?}`` entries so
the bestiary detail Sources drawer can render titled references, image
credits and per-source review dates instead of the opaque
``evidence_sources`` id-string list. Nullable so rows seeded before this
migration round-trip unchanged; the loader/seed populates every catalogue
row on the next boot.

Revision ID: 20260911_18
Revises: 20260911_17
"""

from __future__ import annotations

from alembic import op


revision = "20260911_18"
down_revision = "20260911_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE species ADD COLUMN IF NOT EXISTS sources JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE species DROP COLUMN IF EXISTS sources")
