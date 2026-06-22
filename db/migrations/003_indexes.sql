-- IOS+ Platform — Performance Indexes
-- PostgreSQL 16+ with pgvector HNSW
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- audit_events indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_events_table_name
    ON audit_events(table_name);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id
    ON audit_events(actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp
    ON audit_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_audit_events_operation
    ON audit_events(operation);

CREATE INDEX IF NOT EXISTS idx_audit_events_record_id
    ON audit_events(record_id);

-- Composite index for common audit queries
CREATE INDEX IF NOT EXISTS idx_audit_events_table_record
    ON audit_events(table_name, record_id, timestamp DESC);

-- ------------------------------------------------------------
-- evidence_records indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_evidence_records_request_id
    ON evidence_records(request_id);

CREATE INDEX IF NOT EXISTS idx_evidence_records_timestamp
    ON evidence_records(timestamp);

CREATE INDEX IF NOT EXISTS idx_evidence_records_previous_hash
    ON evidence_records(previous_hash);

-- ------------------------------------------------------------
-- compliance_rules indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_compliance_rules_dimension
    ON compliance_rules(dimension);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_sector
    ON compliance_rules(sector);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_active
    ON compliance_rules(active) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_compliance_rules_priority
    ON compliance_rules(priority, active);

-- Composite index for policy engine lookups
CREATE INDEX IF NOT EXISTS idx_compliance_rules_dimension_sector_active
    ON compliance_rules(dimension, sector, active, priority);

-- ------------------------------------------------------------
-- rag_documents indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rag_documents_partition_id
    ON rag_documents(partition_id);

CREATE INDEX IF NOT EXISTS idx_rag_documents_sector
    ON rag_documents(sector);

-- HNSW vector index for approximate nearest neighbor search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding_hnsw
    ON rag_documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- GIN index on metadata for JSONB queries
CREATE INDEX IF NOT EXISTS idx_rag_documents_metadata
    ON rag_documents USING GIN (metadata);

-- ------------------------------------------------------------
-- uco_nodes indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_uco_nodes_type
    ON uco_nodes(type);

CREATE INDEX IF NOT EXISTS idx_uco_nodes_code
    ON uco_nodes(code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uco_nodes_type_code
    ON uco_nodes(type, code);

CREATE INDEX IF NOT EXISTS idx_uco_nodes_parent_id
    ON uco_nodes(parent_id);

-- Full-text search on title and description using trigram
CREATE INDEX IF NOT EXISTS idx_uco_nodes_trgm
    ON uco_nodes USING GIN (title gin_trgm_ops, description gin_trgm_ops);

-- ------------------------------------------------------------
-- uco_crosswalk indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_uco_crosswalk_source_type
    ON uco_crosswalk(source_type);

CREATE INDEX IF NOT EXISTS idx_uco_crosswalk_source_code
    ON uco_crosswalk(source_code);

CREATE INDEX IF NOT EXISTS idx_uco_crosswalk_target_type
    ON uco_crosswalk(target_type);

-- Composite index for crosswalk lookups
CREATE INDEX IF NOT EXISTS idx_uco_crosswalk_source_target
    ON uco_crosswalk(source_type, source_code, target_type, target_code);

-- Index for confidence-filtered queries
CREATE INDEX IF NOT EXISTS idx_uco_crosswalk_confidence
    ON uco_crosswalk(confidence DESC);

-- ------------------------------------------------------------
-- uco_obligation_metadata indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_obligation_state
    ON uco_obligation_metadata(state);

CREATE INDEX IF NOT EXISTS idx_obligation_naics
    ON uco_obligation_metadata(naics_code);

CREATE INDEX IF NOT EXISTS idx_obligation_enforcement
    ON uco_obligation_metadata(enforcement_type);

-- Composite index for state licensure lookups
CREATE INDEX IF NOT EXISTS idx_obligation_state_naics_enforcement
    ON uco_obligation_metadata(state, naics_code, enforcement_type);

-- GIN index on metadata for JSONB queries
CREATE INDEX IF NOT EXISTS idx_obligation_metadata
    ON uco_obligation_metadata USING GIN (metadata);

COMMIT;
