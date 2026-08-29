CREATE TABLE model_versions (
	id UUID NOT NULL, 
	provider VARCHAR(80) NOT NULL, 
	version VARCHAR(120) NOT NULL, 
	device VARCHAR(30) NOT NULL, 
	fake BOOLEAN NOT NULL, 
	metadata_json JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_model_versions PRIMARY KEY (id), 
	CONSTRAINT uq_model_provider_version UNIQUE (provider, version)
);
CREATE TABLE monitored_areas (
	id UUID NOT NULL, 
	name VARCHAR(180) NOT NULL, 
	geometry geography(MULTIPOLYGON,4326) NOT NULL, 
	metadata_json JSONB NOT NULL, 
	CONSTRAINT pk_monitored_areas PRIMARY KEY (id), 
	CONSTRAINT uq_monitored_areas_name UNIQUE (name)
);
CREATE TABLE monitored_places (
	id UUID NOT NULL, 
	name VARCHAR(180) NOT NULL, 
	latitude NUMERIC(8, 5) NOT NULL, 
	longitude NUMERIC(8, 5) NOT NULL, 
	location geography(POINT,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED NOT NULL, 
	CONSTRAINT pk_monitored_places PRIMARY KEY (id), 
	CONSTRAINT uq_monitored_places_name UNIQUE (name)
);
CREATE TABLE ovcvi_checkpoints (
	id UUID NOT NULL, 
	stream_id VARCHAR(160) NOT NULL, 
	state_version VARCHAR(120) NOT NULL, 
	model_version VARCHAR(120) NOT NULL, 
	object_key VARCHAR(500) NOT NULL, 
	checksum BYTEA NOT NULL, 
	metadata_json JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_ovcvi_checkpoints PRIMARY KEY (id), 
	CONSTRAINT uq_ovcvi_stream_state UNIQUE (stream_id, state_version)
);
CREATE TABLE ovcvi_stream_events (
	id UUID NOT NULL, 
	stream_id VARCHAR(160) NOT NULL, 
	event_id VARCHAR(160) NOT NULL, 
	observed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	feature_schema_version VARCHAR(80) NOT NULL, 
	payload_hash BYTEA NOT NULL, 
	features_json JSONB NOT NULL, 
	prediction_json JSONB, 
	label_json JSONB, 
	state_version_before VARCHAR(120), 
	state_version_after VARCHAR(120), 
	status VARCHAR(20) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	labeled_at TIMESTAMP WITH TIME ZONE, 
	CONSTRAINT pk_ovcvi_stream_events PRIMARY KEY (id), 
	CONSTRAINT uq_ovcvi_stream_event UNIQUE (stream_id, event_id), 
	CONSTRAINT ck_ovcvi_stream_events_status CHECK (status IN ('received','predicted','labeled','failed'))
);
CREATE TABLE profiles (
	id UUID NOT NULL, 
	public_id VARCHAR(80) NOT NULL, 
	display_name VARCHAR(80), 
	role VARCHAR(20) NOT NULL, 
	trust_level VARCHAR(20) NOT NULL, 
	recovery_setup_acknowledged BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_profiles PRIMARY KEY (id), 
	CONSTRAINT ck_profiles_role CHECK (role IN ('Detector','Volunteer','Coordinator','Expert','Admin')), 
	CONSTRAINT ck_profiles_trust_level CHECK (trust_level IN ('New','Trusted','Steward')), 
	CONSTRAINT ck_profiles_display_name CHECK (display_name IS NULL OR char_length(display_name) <= 80)
);
CREATE TABLE species (
	id VARCHAR(80) NOT NULL, 
	name VARCHAR(160) NOT NULL, 
	latin_name VARCHAR(160) NOT NULL, 
	common_names JSONB NOT NULL, 
	is_invasive BOOLEAN NOT NULL, 
	risk VARCHAR(20), 
	traits JSONB NOT NULL, 
	native_twin JSONB, 
	removal_steps JSONB NOT NULL, 
	do_not_do JSONB NOT NULL, 
	detail_available BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_species PRIMARY KEY (id), 
	CONSTRAINT ck_species_risk CHECK (risk IS NULL OR risk IN ('high','watch'))
);
CREATE TABLE trails (
	id UUID NOT NULL, 
	name VARCHAR(180) NOT NULL, 
	geometry geography(MULTILINESTRING,4326) NOT NULL, 
	metadata_json JSONB NOT NULL, 
	CONSTRAINT pk_trails PRIMARY KEY (id), 
	CONSTRAINT uq_trails_name UNIQUE (name)
);
CREATE TABLE audit_events (
	id UUID NOT NULL, 
	event_type VARCHAR(100) NOT NULL, 
	acting_profile_id UUID, 
	subject_type VARCHAR(80) NOT NULL, 
	subject_id VARCHAR(160) NOT NULL, 
	request_id VARCHAR(100), 
	metadata_json JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_audit_events PRIMARY KEY (id), 
	CONSTRAINT fk_audit_events_acting_profile_id_profiles FOREIGN KEY(acting_profile_id) REFERENCES profiles (id) ON DELETE SET NULL
);
CREATE TABLE idempotency_records (
	id UUID NOT NULL, 
	profile_id UUID NOT NULL, 
	scope VARCHAR(80) NOT NULL, 
	idempotency_key VARCHAR(128) NOT NULL, 
	request_hash BYTEA NOT NULL, 
	response_status INTEGER NOT NULL, 
	response_json JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	CONSTRAINT pk_idempotency_records PRIMARY KEY (id), 
	CONSTRAINT uq_idempotency_scope_key UNIQUE (profile_id, scope, idempotency_key), 
	CONSTRAINT fk_idempotency_records_profile_id_profiles FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE installations (
	id UUID NOT NULL, 
	profile_id UUID NOT NULL, 
	token_hash BYTEA NOT NULL, 
	key_version INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	last_used_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	CONSTRAINT pk_installations PRIMARY KEY (id), 
	CONSTRAINT fk_installations_profile_id_profiles FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE, 
	CONSTRAINT uq_installations_token_hash UNIQUE (token_hash)
);
CREATE TABLE notifications (
	id UUID NOT NULL, 
	profile_id UUID NOT NULL, 
	kind VARCHAR(30) NOT NULL, 
	title VARCHAR(160) NOT NULL, 
	body VARCHAR(500) NOT NULL, 
	link_to VARCHAR(300), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	read_at TIMESTAMP WITH TIME ZONE, 
	CONSTRAINT pk_notifications PRIMARY KEY (id), 
	CONSTRAINT ck_notifications_kind CHECK (kind IN ('report_confirmed','report_rejected','queue_new','sync_ok','system')), 
	CONSTRAINT fk_notifications_profile_id_profiles FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE recovery_code_batches (
	id UUID NOT NULL, 
	profile_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	invalidated_at TIMESTAMP WITH TIME ZONE, 
	CONSTRAINT pk_recovery_code_batches PRIMARY KEY (id), 
	CONSTRAINT fk_recovery_code_batches_profile_id_profiles FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE reports (
	id UUID NOT NULL, 
	profile_id UUID NOT NULL, 
	species_id VARCHAR(80), 
	status VARCHAR(20) NOT NULL, 
	photo_key VARCHAR(500) NOT NULL, 
	outcome VARCHAR(30) NOT NULL, 
	confidence NUMERIC(6, 5) NOT NULL, 
	client_model_version VARCHAR(120) NOT NULL, 
	latitude NUMERIC(8, 5) NOT NULL, 
	longitude NUMERIC(8, 5) NOT NULL, 
	location geography(POINT,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED NOT NULL, 
	location_accuracy_m INTEGER, 
	extent VARCHAR(30) NOT NULL, 
	notes VARCHAR(280) NOT NULL, 
	consent_accurate BOOLEAN NOT NULL, 
	consent_no_pii BOOLEAN NOT NULL, 
	submitter_trust VARCHAR(20) NOT NULL, 
	idempotency_key VARCHAR(128) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_reports PRIMARY KEY (id), 
	CONSTRAINT ck_reports_status CHECK (status IN ('candidate','confirmed','rejected','merged')), 
	CONSTRAINT ck_reports_outcome CHECK (outcome IN ('target','other_plant','uncertain')), 
	CONSTRAINT ck_reports_extent CHECK (extent IN ('single','small_patch','large_area')), 
	CONSTRAINT ck_reports_confidence CHECK (confidence >= 0 AND confidence <= 1), 
	CONSTRAINT ck_reports_malaysia_latitude CHECK (latitude BETWEEN 0.8 AND 7.5), 
	CONSTRAINT ck_reports_malaysia_longitude CHECK (longitude BETWEEN 99.3 AND 119.5), 
	CONSTRAINT ck_reports_accuracy CHECK (location_accuracy_m IS NULL OR location_accuracy_m >= 0), 
	CONSTRAINT ck_reports_notes_length CHECK (char_length(notes) <= 280), 
	CONSTRAINT ck_reports_submitter_trust CHECK (submitter_trust IN ('New','Trusted','Steward')), 
	CONSTRAINT uq_report_idempotency UNIQUE (profile_id, idempotency_key), 
	CONSTRAINT fk_reports_profile_id_profiles FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_reports_species_id_species FOREIGN KEY(species_id) REFERENCES species (id) ON DELETE RESTRICT, 
	CONSTRAINT uq_reports_photo_key UNIQUE (photo_key)
);
CREATE TABLE sightings (
	id UUID NOT NULL, 
	species_id VARCHAR(80) NOT NULL, 
	source_profile_id UUID, 
	status VARCHAR(20) NOT NULL, 
	risk VARCHAR(20) NOT NULL, 
	latitude NUMERIC(8, 5) NOT NULL, 
	longitude NUMERIC(8, 5) NOT NULL, 
	location geography(POINT,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED NOT NULL, 
	reporter_trust VARCHAR(20) NOT NULL, 
	recommended_action TEXT NOT NULL, 
	merged_into_sighting_id UUID, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_sightings PRIMARY KEY (id), 
	CONSTRAINT ck_sightings_status CHECK (status IN ('candidate','confirmed','rejected','removed','merged')), 
	CONSTRAINT ck_sightings_reporter_trust CHECK (reporter_trust IN ('New','Trusted','Steward')), 
	CONSTRAINT ck_sightings_malaysia_latitude CHECK (latitude BETWEEN 0.8 AND 7.5), 
	CONSTRAINT ck_sightings_malaysia_longitude CHECK (longitude BETWEEN 99.3 AND 119.5), 
	CONSTRAINT fk_sightings_species_id_species FOREIGN KEY(species_id) REFERENCES species (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_sightings_source_profile_id_profiles FOREIGN KEY(source_profile_id) REFERENCES profiles (id) ON DELETE SET NULL, 
	CONSTRAINT fk_sightings_merged_into_sighting_id_sightings FOREIGN KEY(merged_into_sighting_id) REFERENCES sightings (id) ON DELETE SET NULL
);
CREATE TABLE inference_records (
	id UUID NOT NULL, 
	report_id UUID NOT NULL, 
	model_version_id UUID, 
	status VARCHAR(30) NOT NULL, 
	quality_json JSONB, 
	detection_json JSONB, 
	identification_json JSONB, 
	embedding_json JSONB, 
	duration_ms INTEGER, 
	error_code VARCHAR(80), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_inference_records PRIMARY KEY (id), 
	CONSTRAINT fk_inference_records_report_id_reports FOREIGN KEY(report_id) REFERENCES reports (id) ON DELETE CASCADE, 
	CONSTRAINT fk_inference_records_model_version_id_model_versions FOREIGN KEY(model_version_id) REFERENCES model_versions (id) ON DELETE SET NULL
);
CREATE TABLE recovery_codes (
	id UUID NOT NULL, 
	batch_id UUID NOT NULL, 
	profile_id UUID NOT NULL, 
	code_hash BYTEA NOT NULL, 
	key_version INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	used_at TIMESTAMP WITH TIME ZONE, 
	CONSTRAINT pk_recovery_codes PRIMARY KEY (id), 
	CONSTRAINT uq_recovery_batch_hash UNIQUE (batch_id, code_hash), 
	CONSTRAINT fk_recovery_codes_batch_id_recovery_code_batches FOREIGN KEY(batch_id) REFERENCES recovery_code_batches (id) ON DELETE CASCADE, 
	CONSTRAINT fk_recovery_codes_profile_id_profiles FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE TABLE report_sighting_links (
	id UUID NOT NULL, 
	report_id UUID NOT NULL, 
	sighting_id UUID NOT NULL, 
	active BOOLEAN NOT NULL, 
	linked_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	ended_at TIMESTAMP WITH TIME ZONE, 
	CONSTRAINT pk_report_sighting_links PRIMARY KEY (id), 
	CONSTRAINT fk_report_sighting_links_report_id_reports FOREIGN KEY(report_id) REFERENCES reports (id) ON DELETE CASCADE, 
	CONSTRAINT fk_report_sighting_links_sighting_id_sightings FOREIGN KEY(sighting_id) REFERENCES sightings (id) ON DELETE CASCADE
);
CREATE TABLE upload_grants (
	id UUID NOT NULL, 
	profile_id UUID NOT NULL, 
	object_key VARCHAR(500) NOT NULL, 
	content_type VARCHAR(100) NOT NULL, 
	size_bytes BIGINT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	consumed_at TIMESTAMP WITH TIME ZONE, 
	consumed_by_report_id UUID, 
	CONSTRAINT pk_upload_grants PRIMARY KEY (id), 
	CONSTRAINT ck_upload_grants_positive_size CHECK (size_bytes > 0), 
	CONSTRAINT uq_upload_object_key UNIQUE (object_key), 
	CONSTRAINT fk_upload_grants_profile_id_profiles FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE, 
	CONSTRAINT fk_upload_grants_consumed_by_report_id_reports FOREIGN KEY(consumed_by_report_id) REFERENCES reports (id) ON DELETE SET NULL
);
CREATE TABLE verification_decisions (
	id UUID NOT NULL, 
	report_id UUID NOT NULL, 
	acting_profile_id UUID NOT NULL, 
	decision VARCHAR(20) NOT NULL, 
	previous_state VARCHAR(20) NOT NULL, 
	resulting_state VARCHAR(20) NOT NULL, 
	merge_target_id UUID, 
	metadata_json JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_verification_decisions PRIMARY KEY (id), 
	CONSTRAINT fk_verification_decisions_report_id_reports FOREIGN KEY(report_id) REFERENCES reports (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_verification_decisions_acting_profile_id_profiles FOREIGN KEY(acting_profile_id) REFERENCES profiles (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_verification_decisions_merge_target_id_sightings FOREIGN KEY(merge_target_id) REFERENCES sightings (id) ON DELETE RESTRICT
);
CREATE TABLE verification_jobs (
	id UUID NOT NULL, 
	report_id UUID NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	attempts INTEGER NOT NULL, 
	available_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	locked_at TIMESTAMP WITH TIME ZONE, 
	last_error_code VARCHAR(80), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_verification_jobs PRIMARY KEY (id), 
	CONSTRAINT ck_verification_jobs_status CHECK (status IN ('pending','running','completed','retry','unavailable','failed')), 
	CONSTRAINT uq_verification_job_report UNIQUE (report_id), 
	CONSTRAINT fk_verification_jobs_report_id_reports FOREIGN KEY(report_id) REFERENCES reports (id) ON DELETE CASCADE
);
CREATE INDEX ix_areas_geometry_gist ON monitored_areas USING gist (geometry);
CREATE INDEX ix_places_location_gist ON monitored_places USING gist (location);
CREATE INDEX ix_ovcvi_checkpoints_stream_id ON ovcvi_checkpoints (stream_id);
CREATE INDEX ix_ovcvi_stream_events_stream_id ON ovcvi_stream_events (stream_id);
CREATE UNIQUE INDEX ix_profiles_public_id ON profiles (public_id);
CREATE INDEX ix_trails_geometry_gist ON trails USING gist (geometry);
CREATE INDEX ix_audit_events_acting_profile_id ON audit_events (acting_profile_id);
CREATE INDEX ix_audit_events_created_at ON audit_events (created_at);
CREATE INDEX ix_audit_events_event_type ON audit_events (event_type);
CREATE INDEX ix_audit_events_subject_id ON audit_events (subject_id);
CREATE INDEX ix_idempotency_records_expires_at ON idempotency_records (expires_at);
CREATE INDEX ix_idempotency_records_profile_id ON idempotency_records (profile_id);
CREATE INDEX ix_installations_profile_id ON installations (profile_id);
CREATE INDEX ix_notifications_created_at ON notifications (created_at);
CREATE INDEX ix_notifications_profile_id ON notifications (profile_id);
CREATE INDEX ix_notifications_read_at ON notifications (read_at);
CREATE INDEX ix_recovery_code_batches_profile_id ON recovery_code_batches (profile_id);
CREATE INDEX ix_reports_created_at ON reports (created_at);
CREATE INDEX ix_reports_location_gist ON reports USING gist (location);
CREATE INDEX ix_reports_profile_id ON reports (profile_id);
CREATE INDEX ix_reports_status ON reports (status);
CREATE INDEX ix_sightings_location_gist ON sightings USING gist (location);
CREATE INDEX ix_sightings_source_profile_id ON sightings (source_profile_id);
CREATE INDEX ix_sightings_species_id ON sightings (species_id);
CREATE INDEX ix_sightings_status ON sightings (status);
CREATE INDEX ix_inference_records_created_at ON inference_records (created_at);
CREATE INDEX ix_inference_records_report_id ON inference_records (report_id);
CREATE INDEX ix_recovery_codes_batch_id ON recovery_codes (batch_id);
CREATE INDEX ix_recovery_codes_profile_id ON recovery_codes (profile_id);
CREATE INDEX ix_report_sighting_links_report_id ON report_sighting_links (report_id);
CREATE INDEX ix_report_sighting_links_sighting_id ON report_sighting_links (sighting_id);
CREATE UNIQUE INDEX uq_report_sighting_active ON report_sighting_links (report_id) WHERE active IS true;
CREATE INDEX ix_upload_grants_expires_at ON upload_grants (expires_at);
CREATE INDEX ix_upload_grants_profile_id ON upload_grants (profile_id);
CREATE INDEX ix_verification_decisions_acting_profile_id ON verification_decisions (acting_profile_id);
CREATE INDEX ix_verification_decisions_report_id ON verification_decisions (report_id);
CREATE INDEX ix_verification_jobs_available_at ON verification_jobs (available_at);
CREATE INDEX ix_verification_jobs_report_id ON verification_jobs (report_id);
CREATE INDEX ix_verification_jobs_status ON verification_jobs (status);

