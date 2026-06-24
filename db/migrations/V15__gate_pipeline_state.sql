-- Gate Walker Engine — Pipeline State Table
-- Phase 1 Migration
-- ============================================================

BEGIN;

-- Ensure uuid-ossp extension is available for uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- gate_pipeline_state — Persists 10-stage pipeline intermediate state
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_pipeline_state (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id      UUID NOT NULL UNIQUE,
    current_stage   VARCHAR(64) NOT NULL,
    final_decision  VARCHAR(16),
    state           JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE gate_pipeline_state IS 'Persists intermediate state for the 10-stage Gate Walker pipeline. One row per request_id (upserted at each stage transition).';
COMMENT ON COLUMN gate_pipeline_state.request_id IS 'Unique request identifier — correlates with audit_events and evidence_records.';
COMMENT ON COLUMN gate_pipeline_state.current_stage IS 'The last completed pipeline stage (AUTHENTICATE|INTERPRET|CLASSIFY|AUTHORIZE|ROUTE|EXECUTE|RECONCILE|REDACT|RESPOND|AUDIT).';
COMMENT ON COLUMN gate_pipeline_state.final_decision IS 'Final pipeline decision once EXECUTE stage completes (ALLOW|REDACT|DENY). NULL while pipeline is in progress.';
COMMENT ON COLUMN gate_pipeline_state.state IS 'JSONB blob containing the full PipelineState object (request, stages array, timestamps).';

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_gate_pipeline_state_request_id
    ON gate_pipeline_state (request_id);

CREATE INDEX IF NOT EXISTS idx_gate_pipeline_state_final_decision
    ON gate_pipeline_state (final_decision)
    WHERE final_decision IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gate_pipeline_state_current_stage
    ON gate_pipeline_state (current_stage);

CREATE INDEX IF NOT EXISTS idx_gate_pipeline_state_updated_at
    ON gate_pipeline_state (updated_at DESC);

-- ------------------------------------------------------------
-- gate_audit_receipts — Sealed audit receipts for every final decision
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_audit_receipts (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id         UUID NOT NULL,
    decision           VARCHAR(16) NOT NULL CHECK (decision IN ('ALLOW', 'REDACT', 'DENY')),
    actor              VARCHAR(255) NOT NULL,
    resource           VARCHAR(512) NOT NULL,
    action             VARCHAR(128) NOT NULL,
    sector             VARCHAR(64) NOT NULL DEFAULT 'general',
    issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signature          TEXT NOT NULL,
    signer_public_key  TEXT NOT NULL,
    algorithm          VARCHAR(32) NOT NULL DEFAULT 'none',
    hash               VARCHAR(64) NOT NULL,
    receipt_payload    JSONB NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE gate_audit_receipts IS 'Immutable sealed audit receipts for every Gate Walker final decision (ALLOW/REDACT/DENY). Ed25519-signed with evidence fabric.';
COMMENT ON COLUMN gate_audit_receipts.signature IS 'Ed25519 signature over the canonical receipt payload.';
COMMENT ON COLUMN gate_audit_receipts.hash IS 'SHA-256 hash of the canonical receipt payload (hex string).';
COMMENT ON COLUMN gate_audit_receipts.receipt_payload IS 'Full JSONB receipt payload including stage history.';

CREATE INDEX IF NOT EXISTS idx_gate_audit_receipts_request_id
    ON gate_audit_receipts (request_id);

CREATE INDEX IF NOT EXISTS idx_gate_audit_receipts_decision
    ON gate_audit_receipts (decision);

CREATE INDEX IF NOT EXISTS idx_gate_audit_receipts_issued_at
    ON gate_audit_receipts (issued_at DESC);

INSERT INTO schema_migrations (version, description)
VALUES ('V15', 'Gate Walker pipeline state and audit receipts tables')
ON CONFLICT (version) DO NOTHING;

COMMIT;
