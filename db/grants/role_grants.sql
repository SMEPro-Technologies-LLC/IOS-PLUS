-- ============================================================
-- IOS+ COS+ Role Grants
-- Creates all 6 named PostgreSQL roles with least-privilege RBAC
-- Run as cos_admin after all migrations complete
-- SMEPro Technologies — Confidential
-- EB Doc 3 §4
-- ============================================================

-- ── Create roles (idempotent) ────────────────────────────────
DO $$
BEGIN
  -- Application role: SELECT/INSERT on operational tables only
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ios_app') THEN
    CREATE ROLE ios_app LOGIN;
  END IF;
  -- Audit writer: INSERT-only on audit tables (WORM-aligned)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer LOGIN;
  END IF;
  -- Audit reader: SELECT-only on audit tables
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_reader') THEN
    CREATE ROLE audit_reader LOGIN;
  END IF;
  -- RAG reader: SELECT on vector corpus and uco_nodes
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_reader') THEN
    CREATE ROLE rag_reader LOGIN;
  END IF;
  -- RAG writer: INSERT/UPDATE on rag_sources/rag_chunks
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_writer') THEN
    CREATE ROLE rag_writer LOGIN;
  END IF;
  -- COS admin: DBA role, all privileges, pgaudit logged
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cos_admin') THEN
    CREATE ROLE cos_admin LOGIN SUPERUSER;
  END IF;
END $$;

-- ── ios_app: operational tables only ─────────────────────────
GRANT SELECT, INSERT ON objects           TO ios_app;
GRANT SELECT, INSERT ON tenant_registry  TO ios_app;
GRANT SELECT, INSERT ON regulatory_profiles TO ios_app;
GRANT SELECT           ON ios_signing_keys  TO ios_app;
GRANT SELECT           ON uco_nodes         TO ios_app;
GRANT SELECT           ON naics_decoder     TO ios_app;
GRANT SELECT           ON agency_registry   TO ios_app;
GRANT SELECT           ON compliance_chains TO ios_app;
GRANT SELECT, INSERT   ON tenant_naics_profiles TO ios_app;
GRANT SELECT, INSERT   ON filing_calendar   TO ios_app;
-- ios_app has NO access to audit tables (evidence_packages, gate_decisions, etc.)

-- ── audit_writer: INSERT-only on audit tables ─────────────────
GRANT INSERT ON evidence_packages       TO audit_writer;
GRANT INSERT ON gate_decisions          TO audit_writer;
GRANT INSERT ON evidence_source_manifest TO audit_writer;
GRANT INSERT ON quarantine_records      TO audit_writer;
GRANT INSERT ON merkle_roots            TO audit_writer;
GRANT INSERT ON uco_evaluation_results  TO audit_writer;
-- audit_writer explicitly NOT granted SELECT, UPDATE, DELETE

-- ── audit_reader: SELECT-only on audit tables ─────────────────
GRANT SELECT ON evidence_packages       TO audit_reader;
GRANT SELECT ON gate_decisions          TO audit_reader;
GRANT SELECT ON evidence_source_manifest TO audit_reader;
GRANT SELECT ON quarantine_records      TO audit_reader;
GRANT SELECT ON merkle_roots            TO audit_reader;
GRANT SELECT ON uco_evaluation_results  TO audit_reader;
GRANT SELECT ON ios_signing_keys        TO audit_reader;

-- ── rag_reader: vector corpus + UCO reference tables ──────────
GRANT SELECT ON rag_chunks   TO rag_reader;
GRANT SELECT ON rag_sources  TO rag_reader;
GRANT SELECT ON uco_nodes    TO rag_reader;
GRANT SELECT ON naics_decoder TO rag_reader;
GRANT SELECT ON rag_vault_sector_partitions TO rag_reader;
GRANT SET ON PARAMETER hnsw.ef_search TO rag_reader;

-- ── rag_writer: ingestion pipeline ────────────────────────────
GRANT SELECT, INSERT, UPDATE ON rag_sources  TO rag_writer;
GRANT SELECT, INSERT         ON rag_chunks   TO rag_writer;
GRANT UPDATE ON rag_vault_sector_partitions  TO rag_writer;

-- ── cos_admin: full access (pgaudit logs all statements) ───────
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO cos_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO cos_admin;

-- ── Default privileges for future tables ─────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE cos_admin IN SCHEMA public
  GRANT SELECT ON TABLES TO audit_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE cos_admin IN SCHEMA public
  GRANT SELECT ON TABLES TO rag_reader;
