-- IOS+ Platform — WORM Enforcement Triggers
-- PostgreSQL 16+
-- Write-Once-Read-Many: audit_events and evidence_records are immutable
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Archive table for expired audit records (NOT WORM protected)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events_archive (
    id           SERIAL PRIMARY KEY,
    original_id  UUID NOT NULL,
    table_name   VARCHAR(128) NOT NULL,
    operation    audit_operation NOT NULL,
    record_id    UUID NOT NULL,
    old_data     JSONB,
    new_data     JSONB,
    actor_id     UUID,
    actor_type   VARCHAR(64),
    session_id   VARCHAR(255),
    ip_address   INET,
    user_agent   TEXT,
    timestamp    TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    archived_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_archive_original_id ON audit_events_archive(original_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_archive_archived_at ON audit_events_archive(archived_at);

COMMENT ON TABLE audit_events_archive IS 'Archive of expired audit_events moved by retention policy. Not WORM protected but fully logged.';

-- ------------------------------------------------------------
-- WORM enforcement function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_worm()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'WORM_VIOLATION: Table "%" is write-once-read-many. Updates are prohibited.', TG_TABLE_NAME;
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'WORM_VIOLATION: Table "%" is write-once-read-many. Deletes are prohibited.', TG_TABLE_NAME;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enforce_worm() IS 'WORM trigger function: blocks UPDATE and DELETE on protected tables.';

-- ------------------------------------------------------------
-- WORM triggers for protected tables
-- ------------------------------------------------------------

-- audit_events: immutable audit log
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_audit_events_worm'
          AND tgrelid = 'audit_events'::regclass
    ) THEN
        CREATE TRIGGER trg_audit_events_worm
            BEFORE UPDATE OR DELETE ON audit_events
            FOR EACH ROW
            EXECUTE FUNCTION enforce_worm();
    END IF;
END
$$;

-- evidence_records: immutable evidence chain
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_evidence_records_worm'
          AND tgrelid = 'evidence_records'::regclass
    ) THEN
        CREATE TRIGGER trg_evidence_records_worm
            BEFORE UPDATE OR DELETE ON evidence_records
            FOR EACH ROW
            EXECUTE FUNCTION enforce_worm();
    END IF;
END
$$;

-- schema_migrations: immutable migration history
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_schema_migrations_worm'
          AND tgrelid = 'schema_migrations'::regclass
    ) THEN
        CREATE TRIGGER trg_schema_migrations_worm
            BEFORE UPDATE OR DELETE ON schema_migrations
            FOR EACH ROW
            EXECUTE FUNCTION enforce_worm();
    END IF;
END
$$;

COMMIT;
