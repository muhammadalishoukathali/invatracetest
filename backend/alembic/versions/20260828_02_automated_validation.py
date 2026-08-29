"""Automated validation, seasonal guidance, and OSM associations.

Revision ID: 20260828_02
Revises: 20260828_01
"""

from __future__ import annotations

from alembic import op

revision = "20260828_02"
down_revision = "20260828_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE profiles ADD COLUMN resolved_reports INTEGER DEFAULT 0 NOT NULL")
    op.execute("ALTER TABLE profiles ADD COLUMN valid_reports INTEGER DEFAULT 0 NOT NULL")
    op.execute("ALTER TABLE profiles ADD COLUMN hard_failures INTEGER DEFAULT 0 NOT NULL")

    op.execute("ALTER TABLE species ADD COLUMN reportable BOOLEAN DEFAULT false NOT NULL")
    op.execute("ALTER TABLE species ADD COLUMN action_guides JSONB DEFAULT '[]'::jsonb NOT NULL")

    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_status")
    op.execute("ALTER TABLE reports ALTER COLUMN status TYPE VARCHAR(30)")
    op.execute("ALTER TABLE reports ADD COLUMN observed_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE reports ADD COLUMN capture_id UUID")
    op.execute("ALTER TABLE reports ADD COLUMN capture_source VARCHAR(20)")
    op.execute("ALTER TABLE reports ADD COLUMN content_sha256 BYTEA")
    op.execute("ALTER TABLE reports ADD COLUMN perceptual_hash VARCHAR(32)")
    op.execute(
        "ALTER TABLE reports ADD COLUMN validation_reasons JSONB DEFAULT '[]'::jsonb NOT NULL"
    )
    op.execute("ALTER TABLE reports ADD COLUMN validation_policy_version VARCHAR(120)")
    op.execute("ALTER TABLE reports ADD COLUMN validation_model_version VARCHAR(120)")
    op.execute(
        "UPDATE reports SET observed_at = created_at, capture_id = id, capture_source = 'camera'"
    )
    op.execute("UPDATE reports SET status = 'processing' WHERE status = 'candidate'")
    op.execute(
        """
        UPDATE verification_jobs
        SET status = 'pending', attempts = 0, available_at = now(), locked_at = NULL,
            last_error_code = NULL
        FROM reports
        WHERE verification_jobs.report_id = reports.id
          AND reports.status = 'processing'
          AND verification_jobs.status IN ('completed', 'failed')
        """
    )
    op.execute(
        """
        INSERT INTO verification_jobs (id, report_id, status, attempts, available_at)
        SELECT gen_random_uuid(), reports.id, 'pending', 0, now()
        FROM reports
        LEFT JOIN verification_jobs ON verification_jobs.report_id = reports.id
        WHERE reports.status = 'processing' AND verification_jobs.id IS NULL
        """
    )
    op.execute("ALTER TABLE reports ALTER COLUMN observed_at SET NOT NULL")
    op.execute("ALTER TABLE reports ALTER COLUMN capture_id SET NOT NULL")
    op.execute("ALTER TABLE reports ALTER COLUMN capture_source SET NOT NULL")
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_status CHECK "
        "(status IN ('processing','confirmed','merged','needs_rescan','rejected',"
        "'validation_unavailable'))"
    )
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_capture_source CHECK "
        "(capture_source = 'camera')"
    )
    op.execute("CREATE INDEX ix_reports_observed_at ON reports (observed_at)")
    op.execute("CREATE INDEX ix_reports_capture_id ON reports (capture_id)")
    op.execute("CREATE INDEX ix_reports_content_sha256 ON reports (content_sha256)")
    op.execute("CREATE INDEX ix_reports_perceptual_hash ON reports (perceptual_hash)")

    op.execute("ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind")
    op.execute("ALTER TABLE notifications ALTER COLUMN kind TYPE VARCHAR(30)")
    op.execute("UPDATE notifications SET kind = 'system' WHERE kind = 'queue_new'")
    op.execute(
        "ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind CHECK "
        "(kind IN ('report_confirmed','report_rejected','report_needs_rescan',"
        "'report_merged','validation_unavailable','sync_ok','system'))"
    )

    op.execute("ALTER TABLE sightings ADD COLUMN area_id UUID")
    op.execute("ALTER TABLE sightings ADD COLUMN trail_id UUID")
    op.execute(
        "ALTER TABLE sightings ADD COLUMN place_label VARCHAR(380) "
        "DEFAULT 'Reported location, Malaysia' NOT NULL"
    )
    op.execute("ALTER TABLE sightings ADD COLUMN thumbnail_key VARCHAR(500)")
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT fk_sightings_area_id_monitored_areas "
        "FOREIGN KEY(area_id) REFERENCES monitored_areas (id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE sightings ADD CONSTRAINT fk_sightings_trail_id_trails "
        "FOREIGN KEY(trail_id) REFERENCES trails (id) ON DELETE SET NULL"
    )
    op.execute("CREATE INDEX ix_sightings_area_id ON sightings (area_id)")
    op.execute("CREATE INDEX ix_sightings_trail_id ON sightings (trail_id)")

    op.execute(
        """
        CREATE TABLE automated_validation_decisions (
            id UUID NOT NULL,
            report_id UUID NOT NULL,
            decision VARCHAR(30) NOT NULL,
            previous_state VARCHAR(30) NOT NULL,
            resulting_state VARCHAR(30) NOT NULL,
            policy_version VARCHAR(120) NOT NULL,
            model_version VARCHAR(120),
            reason_codes JSONB DEFAULT '[]'::jsonb NOT NULL,
            checks_json JSONB DEFAULT '{}'::jsonb NOT NULL,
            merge_target_id UUID,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            CONSTRAINT pk_automated_validation_decisions PRIMARY KEY (id),
            CONSTRAINT fk_auto_decision_report FOREIGN KEY(report_id)
                REFERENCES reports (id) ON DELETE RESTRICT,
            CONSTRAINT fk_auto_decision_merge_target FOREIGN KEY(merge_target_id)
                REFERENCES sightings (id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_automated_validation_decisions_report_id "
        "ON automated_validation_decisions (report_id)"
    )
    op.execute(
        "CREATE INDEX ix_automated_validation_decisions_created_at "
        "ON automated_validation_decisions (created_at)"
    )

    op.execute(
        """
        CREATE TABLE osm_imports (
            id UUID NOT NULL,
            source_name VARCHAR(200) NOT NULL,
            source_date TIMESTAMP WITH TIME ZONE NOT NULL,
            sha256 BYTEA NOT NULL,
            area_count INTEGER NOT NULL,
            trail_count INTEGER NOT NULL,
            metadata_json JSONB DEFAULT '{}'::jsonb NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            CONSTRAINT pk_osm_imports PRIMARY KEY (id),
            CONSTRAINT uq_osm_imports_sha256 UNIQUE (sha256)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS osm_imports")
    op.execute("DROP TABLE IF EXISTS automated_validation_decisions")

    op.execute("DROP INDEX IF EXISTS ix_sightings_trail_id")
    op.execute("DROP INDEX IF EXISTS ix_sightings_area_id")
    op.execute("ALTER TABLE sightings DROP CONSTRAINT fk_sightings_trail_id_trails")
    op.execute("ALTER TABLE sightings DROP CONSTRAINT fk_sightings_area_id_monitored_areas")
    op.execute("ALTER TABLE sightings DROP COLUMN place_label")
    op.execute("ALTER TABLE sightings DROP COLUMN thumbnail_key")
    op.execute("ALTER TABLE sightings DROP COLUMN trail_id")
    op.execute("ALTER TABLE sightings DROP COLUMN area_id")

    op.execute("ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind")
    op.execute(
        "UPDATE notifications SET kind = 'system' WHERE kind IN "
        "('report_needs_rescan','report_merged','validation_unavailable')"
    )
    op.execute("ALTER TABLE notifications ALTER COLUMN kind TYPE VARCHAR(20)")
    op.execute(
        "ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind CHECK "
        "(kind IN ('report_confirmed','report_rejected','queue_new','sync_ok','system'))"
    )

    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_capture_source")
    op.execute("ALTER TABLE reports DROP CONSTRAINT ck_reports_status")
    op.execute(
        "UPDATE reports SET status = 'candidate' WHERE status IN ('processing','needs_rescan','validation_unavailable')"
    )
    op.execute("ALTER TABLE reports ALTER COLUMN status TYPE VARCHAR(20)")
    op.execute(
        "ALTER TABLE reports ADD CONSTRAINT ck_reports_status CHECK "
        "(status IN ('candidate','confirmed','rejected','merged'))"
    )
    op.execute("DROP INDEX IF EXISTS ix_reports_perceptual_hash")
    op.execute("DROP INDEX IF EXISTS ix_reports_content_sha256")
    op.execute("DROP INDEX IF EXISTS ix_reports_capture_id")
    op.execute("DROP INDEX IF EXISTS ix_reports_observed_at")
    op.execute("ALTER TABLE reports DROP COLUMN validation_model_version")
    op.execute("ALTER TABLE reports DROP COLUMN validation_policy_version")
    op.execute("ALTER TABLE reports DROP COLUMN validation_reasons")
    op.execute("ALTER TABLE reports DROP COLUMN perceptual_hash")
    op.execute("ALTER TABLE reports DROP COLUMN content_sha256")
    op.execute("ALTER TABLE reports DROP COLUMN capture_source")
    op.execute("ALTER TABLE reports DROP COLUMN capture_id")
    op.execute("ALTER TABLE reports DROP COLUMN observed_at")

    op.execute("ALTER TABLE species DROP COLUMN action_guides")
    op.execute("ALTER TABLE species DROP COLUMN reportable")
    op.execute("ALTER TABLE profiles DROP COLUMN hard_failures")
    op.execute("ALTER TABLE profiles DROP COLUMN valid_reports")
    op.execute("ALTER TABLE profiles DROP COLUMN resolved_reports")
