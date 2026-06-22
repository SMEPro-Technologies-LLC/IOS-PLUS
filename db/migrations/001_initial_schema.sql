-- IOS+ Platform — Initial Schema Migration
-- PostgreSQL 16+ with pgvector support
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Schema migrations tracking table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          SERIAL PRIMARY KEY,
    version     VARCHAR(255) NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT
);

-- ------------------------------------------------------------
-- ENUMs
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_operation') THEN
        CREATE TYPE audit_operation AS ENUM ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS_DENIED', 'POLICY_VIOLATION');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_type') THEN
        CREATE TYPE match_type AS ENUM ('exact', 'fuzzy', 'derived', 'manual');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enforcement_type') THEN
        CREATE TYPE enforcement_type AS ENUM ('license', 'certification', 'registration', 'examination', 'background_check', 'continuing_education', 'mandatory');
    END IF;
END
$$;

-- ------------------------------------------------------------
-- 1. audit_events — Append-only, WORM-protected audit log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit_events IS 'Append-only WORM-protected audit log. All writes permanent; updates/deletes blocked by trigger.';
COMMENT ON COLUMN audit_events.operation IS 'Type of operation being audited (INSERT, UPDATE, DELETE, LOGIN, etc.)';
COMMENT ON COLUMN audit_events.old_data IS 'Snapshot of the record before the operation (for UPDATE/DELETE)';
COMMENT ON COLUMN audit_events.new_data IS 'Snapshot of the record after the operation (for INSERT/UPDATE)';

-- ------------------------------------------------------------
-- 2. evidence_records — Append-only, cryptographically linked
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_records (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id         UUID NOT NULL,
    timestamp          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decision           JSONB NOT NULL,
    signature          BYTEA NOT NULL,
    public_key         BYTEA NOT NULL,
    canonical_payload  TEXT NOT NULL,
    previous_hash      BYTEA,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE evidence_records IS 'Append-only cryptographic evidence chain. Each record optionally links to previous hash for chain integrity.';
COMMENT ON COLUMN evidence_records.decision IS 'Structured decision payload (JSONB) from policy engine or agent';
COMMENT ON COLUMN evidence_records.signature IS 'Cryptographic signature of the canonical payload';
COMMENT ON COLUMN evidence_records.previous_hash IS 'Hash of the previous evidence record to form a chain';

-- ------------------------------------------------------------
-- 3. compliance_rules — Mutable policy configuration
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_rules (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL,
    dimension   VARCHAR(64) NOT NULL CHECK (dimension IN ('regulatory', 'security', 'privacy', 'operational', 'ethical', 'sector_specific')),
    condition   JSONB NOT NULL DEFAULT '{}',
    effect      VARCHAR(32) NOT NULL CHECK (effect IN ('allow', 'deny', 'log', 'require_approval')),
    priority    INTEGER NOT NULL DEFAULT 100,
    sector      VARCHAR(64) NOT NULL DEFAULT 'all',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE compliance_rules IS 'Mutable compliance policy rules. Each rule defines a dimension, condition, effect, and sector scope.';
COMMENT ON COLUMN compliance_rules.condition IS 'JSONB predicate evaluated by the policy engine';
COMMENT ON COLUMN compliance_rules.effect IS 'Policy effect: allow, deny, log, or require_approval';
COMMENT ON COLUMN compliance_rules.priority IS 'Lower numbers = higher priority. Evaluated in ascending order.';

-- ------------------------------------------------------------
-- 4. rag_documents — Vector-embedded RAG corpus
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_documents (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content     TEXT NOT NULL,
    embedding   VECTOR(1536),
    metadata    JSONB NOT NULL DEFAULT '{}',
    partition_id VARCHAR(64) NOT NULL DEFAULT 'default',
    sector      VARCHAR(64) NOT NULL DEFAULT 'all',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rag_documents IS 'RAG document store with pgvector embeddings (1536-dim). Partitioned by sector and partition_id.';
COMMENT ON COLUMN rag_documents.embedding IS 'OpenAI-embedding-compatible 1536-dim vector for similarity search';
COMMENT ON COLUMN rag_documents.partition_id IS 'Logical partition for multi-tenant or domain isolation';

-- ------------------------------------------------------------
-- 5. uco_nodes — Unified Classification Ontology nodes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uco_nodes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type        VARCHAR(16) NOT NULL CHECK (type IN ('CIP', 'NAICS', 'SOC')),
    code        VARCHAR(32) NOT NULL,
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id   UUID REFERENCES uco_nodes(id) ON DELETE SET NULL,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE uco_nodes IS 'Unified Classification Ontology nodes: CIP (education), NAICS (industry), SOC (occupation) codes.';
COMMENT ON COLUMN uco_nodes.type IS 'Ontology type: CIP, NAICS, or SOC';
COMMENT ON COLUMN uco_nodes.code IS 'Standardized code for the classification';
COMMENT ON COLUMN uco_nodes.parent_id IS 'Self-referential FK for hierarchical relationships (e.g., CIP family -> detailed)';

-- ------------------------------------------------------------
-- 6. uco_crosswalk — Code-to-code mappings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uco_crosswalk (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type  VARCHAR(16) NOT NULL CHECK (source_type IN ('CIP', 'NAICS', 'SOC')),
    source_code  VARCHAR(32) NOT NULL,
    target_type  VARCHAR(16) NOT NULL CHECK (target_type IN ('CIP', 'NAICS', 'SOC')),
    target_code  VARCHAR(32) NOT NULL,
    match_type   match_type NOT NULL DEFAULT 'exact',
    confidence   NUMERIC(4,3) NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE uco_crosswalk IS 'Crosswalk mappings between CIP, NAICS, and SOC codes with confidence scoring.';
COMMENT ON COLUMN uco_crosswalk.confidence IS 'Match confidence from 0.000 to 1.000';

-- ------------------------------------------------------------
-- 7. uco_obligation_metadata — Regulatory obligations per jurisdiction
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uco_obligation_metadata (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state               CHAR(2) NOT NULL,
    naics_code          VARCHAR(32),
    soc_code            VARCHAR(32),
    enforcement_type    enforcement_type NOT NULL,
    title               VARCHAR(255) NOT NULL,
    authority           VARCHAR(255),
    effective_date      DATE,
    expiration_date     DATE,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE uco_obligation_metadata IS 'State-level regulatory obligations mapped to NAICS/SOC codes. Used for licensure candidate derivation.';
COMMENT ON COLUMN uco_obligation_metadata.state IS 'Two-character US state code (e.g., CA, TX, FL)';
COMMENT ON COLUMN uco_obligation_metadata.enforcement_type IS 'Type of enforcement required (license, certification, etc.)';

COMMIT;
