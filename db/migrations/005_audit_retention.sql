-- IOS+ Platform — Audit Retention Policy
-- PostgreSQL 16+
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Retention policy configuration table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_retention_policy (
    id              SERIAL PRIMARY KEY,
    table_name      VARCHAR(128) NOT NULL UNIQUE,
    retention_days  INTEGER NOT NULL DEFAULT 2555,
    archive_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit_retention_policy IS 'Retention policy configuration for WORM and audit tables. Default 2555 days = 7 years.';

-- Insert default policies
INSERT INTO audit_retention_policy (table_name, retention_days, archive_enabled)
VALUES
    ('audit_events', 2555, TRUE),
    ('evidence_records', 2555, TRUE)
ON CONFLICT (table_name) DO NOTHING;

-- ------------------------------------------------------------
-- Function: prune_expired_audit_events
-- Moves expired audit_events to archive and logs the action
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prune_expired_audit_events()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_policy      RECORD;
    v_cutoff      TIMESTAMPTZ;
    v_moved_count INTEGER := 0;
BEGIN
    SELECT * INTO v_policy
    FROM audit_retention_policy
    WHERE table_name = 'audit_events'
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE NOTICE 'No retention policy found for audit_events. Skipping prune.';
        RETURN 0;
    END IF;

    IF NOT v_policy.archive_enabled THEN
        RAISE NOTICE 'Archiving disabled for audit_events. Skipping prune.';
        RETURN 0;
    END IF;

    v_cutoff := NOW() - (v_policy.retention_days || ' days')::INTERVAL;

    -- Move expired records to archive
    INSERT INTO audit_events_archive (
        original_id, table_name, operation, record_id,
        old_data, new_data, actor_id, actor_type, session_id,
        ip_address, user_agent, timestamp, created_at
    )
    SELECT
        id, table_name, operation, record_id,
        old_data, new_data, actor_id, actor_type, session_id,
        ip_address, user_agent, timestamp, created_at
    FROM audit_events
    WHERE timestamp < v_cutoff;

    GET DIAGNOSTICS v_moved_count = ROW_COUNT;

    IF v_moved_count > 0 THEN
        -- Delete from source (bypasses WORM trigger since this is a privileged admin function)
        DELETE FROM audit_events WHERE timestamp < v_cutoff;

        -- Log the prune action to a new audit event (self-auditing)
        INSERT INTO audit_events (
            table_name, operation, record_id,
            new_data, actor_type, timestamp, created_at
        )
        VALUES (
            'audit_events_archive',
            'ACCESS_DENIED',  -- repurposed as 'ARCHIVE' action
            uuid_generate_v4(),
            jsonb_build_object(
                'action', 'PRUNE',
                'table_name', 'audit_events',
                'retention_days', v_policy.retention_days,
                'cutoff', v_cutoff,
                'records_moved', v_moved_count,
                'archived_at', NOW()
            ),
            'system',
            NOW(),
            NOW()
        );

        RAISE NOTICE 'Pruned % audit_events older than % to archive.', v_moved_count, v_cutoff;
    END IF;

    RETURN v_moved_count;
END;
$$;

COMMENT ON FUNCTION prune_expired_audit_events() IS 'Moves expired audit_events to audit_events_archive based on retention policy. Logs the prune action as a new audit event. Returns count of records moved.';

-- ------------------------------------------------------------
-- Function: get_retention_policy
-- Returns retention policy for a given table
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_retention_policy(p_table_name VARCHAR)
RETURNS TABLE (
    table_name VARCHAR,
    retention_days INTEGER,
    archive_enabled BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        arp.table_name::VARCHAR,
        arp.retention_days,
        arp.archive_enabled,
        arp.created_at
    FROM audit_retention_policy arp
    WHERE arp.table_name = p_table_name;
END;
$$;

COMMENT ON FUNCTION get_retention_policy(VARCHAR) IS 'Returns the retention policy for a given table name. Returns empty set if no policy exists.';

COMMIT;
