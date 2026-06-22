-- IOS+ Platform — Database Roles
-- PostgreSQL 16+
-- ============================================================

-- Application role: standard application access
-- SELECT + INSERT on all tables; EXECUTE on functions; USAGE on schemas
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ios_plus_app') THEN
        CREATE ROLE ios_plus_app NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ios_plus_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ios_plus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO ios_plus_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ios_plus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ios_plus_app;

-- Admin role: full administrative access
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ios_plus_admin') THEN
        CREATE ROLE ios_plus_admin NOLOGIN;
    END IF;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ios_plus_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ios_plus_admin;
GRANT CREATE ON SCHEMA public TO ios_plus_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ios_plus_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ios_plus_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ios_plus_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ios_plus_admin;

-- Read-only role: reporting and analytics
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ios_plus_readonly') THEN
        CREATE ROLE ios_plus_readonly NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ios_plus_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ios_plus_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ios_plus_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ios_plus_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ios_plus_readonly;

-- Migrator role: schema migration tooling
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ios_plus_migrator') THEN
        CREATE ROLE ios_plus_migrator NOLOGIN;
    END IF;
END
$$;

GRANT USAGE, CREATE ON SCHEMA public TO ios_plus_migrator;
GRANT ALL ON TABLE schema_migrations TO ios_plus_migrator;
GRANT ALL ON SEQUENCE schema_migrations_id_seq TO ios_plus_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ios_plus_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ios_plus_migrator;

-- Audit role: dedicated audit logging
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ios_plus_audit') THEN
        CREATE ROLE ios_plus_audit NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ios_plus_audit;
GRANT INSERT ON TABLE audit_events TO ios_plus_audit;
GRANT SELECT ON TABLE audit_events TO ios_plus_audit;

-- Conditional grant for audit_events_archive (created in migration 002)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'audit_events_archive' AND table_schema = 'public'
    ) THEN
        EXECUTE 'GRANT SELECT ON TABLE audit_events_archive TO ios_plus_audit';
        EXECUTE 'GRANT USAGE ON SEQUENCE audit_events_archive_id_seq TO ios_plus_audit';
    END IF;
END
$$;

-- Note: This script is safe to run before or after migrations.
-- If audit_events_archive does not yet exist, the conditional block
-- silently skips those grants. Re-run after migration 002 to apply them.
