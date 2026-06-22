-- IOS+ Platform — Grant Application Script
-- Run this after all migrations and roles are in place
-- ============================================================

-- Load role definitions
\i roles.sql

-- Grant roles to application user accounts
-- (These users must be created separately by the DBA)

-- Application runtime user
GRANT ios_plus_app TO ios_plus_user;

-- Admin user
GRANT ios_plus_admin TO ios_plus_admin_user;

-- Read-only / reporting user
GRANT ios_plus_readonly TO ios_plus_read_user;

-- Schema migrator user
GRANT ios_plus_migrator TO ios_plus_migrator_user;

-- Dedicated audit ingestion user
GRANT ios_plus_audit TO ios_plus_audit_user;
