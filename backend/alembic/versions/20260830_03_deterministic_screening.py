"""Adopt deterministic Iteration 1 evidence screening.

Revision ID: 20260830_03
Revises: 20260828_02
"""

from __future__ import annotations

from alembic import op

revision = "20260830_03"
down_revision = "20260828_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Results produced by the superseded development policy must not be
    # relabelled as deterministic-rule results. Keep the historical decision
    # rows, but make their derived map records private and requeue the evidence.
    op.execute(
        """
        CREATE TEMPORARY TABLE e2_reports_to_rescreen ON COMMIT DROP AS
        SELECT id FROM reports WHERE status IN ('confirmed', 'merged')
        """
    )
    op.execute(
        """
        INSERT INTO audit_events (
            id, event_type, subject_type, subject_id, metadata_json, created_at
        )
        SELECT gen_random_uuid(), 'report.screening_policy_migrated', 'report', id::text,
               jsonb_build_object(
                   'fromPolicy', 'superseded_policy',
                   'toPolicy', 'deterministic-rules-v1.0',
                   'result', 'requeued_private'
               ),
               now()
        FROM e2_reports_to_rescreen
        """
    )
    op.execute(
        """
        UPDATE report_sighting_links
        SET active = false, ended_at = now()
        WHERE active IS true
          AND report_id IN (SELECT id FROM e2_reports_to_rescreen)
        """
    )

    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_status")
    op.execute(
        """
        UPDATE reports
        SET status = 'processing',
            content_sha256 = NULL,
            perceptual_hash = NULL,
            validation_reasons = '[]'::jsonb,
            validation_policy_version = NULL
        WHERE id IN (SELECT id FROM e2_reports_to_rescreen)
        """
    )
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_status CHECK "
        "(status IN ('processing','screened','merged','needs_rescan','rejected',"
        "'validation_unavailable'))"
    )
    op.execute("ALTER TABLE reports ALTER COLUMN perceptual_hash TYPE VARCHAR(160)")
    op.execute(
        """
        UPDATE verification_jobs
        SET status = 'pending', attempts = 0, available_at = now(), locked_at = NULL,
            last_error_code = NULL
        WHERE report_id IN (SELECT id FROM e2_reports_to_rescreen)
        """
    )
    op.execute(
        """
        INSERT INTO verification_jobs (id, report_id, status, attempts, available_at)
        SELECT gen_random_uuid(), reports.id, 'pending', 0, now()
        FROM reports
        LEFT JOIN verification_jobs ON verification_jobs.report_id = reports.id
        WHERE reports.id IN (SELECT id FROM e2_reports_to_rescreen)
          AND verification_jobs.id IS NULL
        """
    )

    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute("UPDATE sightings SET status = 'candidate' WHERE status = 'confirmed'")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK "
        "(status IN ('candidate','screened','rejected','removed','merged'))"
    )

    op.execute("ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind")
    op.execute(
        """
        UPDATE notifications
        SET kind = 'system',
            title = 'Report screening restarted',
            body = 'This report is being checked against the current automated rules and remains private.'
        WHERE kind IN ('report_confirmed', 'report_merged')
        """
    )
    op.execute(
        "ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind CHECK "
        "(kind IN ('report_screened','report_rejected','report_needs_rescan',"
        "'report_merged','validation_unavailable','sync_ok','system'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind")
    op.execute("UPDATE notifications SET kind = 'report_confirmed' WHERE kind = 'report_screened'")
    op.execute(
        "ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind CHECK "
        "(kind IN ('report_confirmed','report_rejected','report_needs_rescan',"
        "'report_merged','validation_unavailable','sync_ok','system'))"
    )

    op.execute("ALTER TABLE sightings DROP CONSTRAINT ck_sightings_status")
    op.execute("UPDATE sightings SET status = 'confirmed' WHERE status = 'screened'")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT ck_sightings_status CHECK "
        "(status IN ('candidate','confirmed','rejected','removed','merged'))"
    )

    op.execute("ALTER TABLE reports ALTER COLUMN perceptual_hash TYPE VARCHAR(32)")
    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_status")
    op.execute("UPDATE reports SET status = 'confirmed' WHERE status = 'screened'")
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_status CHECK "
        "(status IN ('processing','confirmed','merged','needs_rescan','rejected',"
        "'validation_unavailable'))"
    )
