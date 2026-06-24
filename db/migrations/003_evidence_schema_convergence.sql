-- IOS+ Platform — Evidence Schema Convergence
-- PostgreSQL 16+
-- ============================================================
-- Reconciles the mismatch between the gate-530 / migration-defined
-- evidence_records and audit_events schemas and the supplemental
-- fields used by the cos-plus application layer.
--
-- After this migration both layers share a single table with:
--   * The original cryptographic fields (decision, signature,
--     public_key, canonical_payload) from the gate-530 path.
--   * The application-level fields (record_type, content, hash,
--     created_by, metadata) from the cos-plus path.
--   * previous_hash changed from BYTEA to TEXT so both paths can
--     write a hex-encoded SHA-256 chain link without conversion.
--   * signature, public_key, canonical_payload made nullable so
--     cos-plus records (which have no Ed25519 signing) can insert.
--   * decision given a default of '{}' so cos-plus records that
--     omit it do not violate the NOT NULL constraint.
--
-- WORM invariant: this migration does NOT drop any existing rows
-- or disable WORM triggers. Every ALTER is additive or widens a
-- constraint (NULL -> allow-null, BYTEA -> TEXT-with-encoding).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- evidence_records convergence
-- ------------------------------------------------------------

-- 1a. Make signature, public_key, canonical_payload nullable
--     (cos-plus records have no Ed25519 payload; gate-530 records do).
ALTER TABLE evidence_records
  ALTER COLUMN signature      DROP NOT NULL,
  ALTER COLUMN public_key     DROP NOT NULL,
  ALTER COLUMN canonical_payload DROP NOT NULL;

-- 1b. Give decision a safe default so cos-plus can omit it.
ALTER TABLE evidence_records
  ALTER COLUMN decision SET DEFAULT '{}';

-- 1c. Convert previous_hash from BYTEA to TEXT.
--     Existing BYTEA values are re-encoded as lowercase hex strings
--     so gate-530 chain links remain intact.
ALTER TABLE evidence_records
  ALTER COLUMN previous_hash TYPE TEXT USING
    CASE WHEN previous_hash IS NULL THEN NULL
         ELSE encode(previous_hash, 'hex')
    END;

-- 1d. Add cos-plus supplemental columns (idempotent).
ALTER TABLE evidence_records
  ADD COLUMN IF NOT EXISTS record_type  TEXT    NOT NULL DEFAULT 'compliance_decision',
  ADD COLUMN IF NOT EXISTS content      JSONB,
  ADD COLUMN IF NOT EXISTS hash         TEXT,
  ADD COLUMN IF NOT EXISTS created_by   TEXT    NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS metadata     JSONB   DEFAULT '{}';

-- 1e. Add indexes for the new cos-plus columns.
CREATE INDEX IF NOT EXISTS idx_evidence_record_type ON evidence_records(record_type);
CREATE INDEX IF NOT EXISTS idx_evidence_created_by  ON evidence_records(created_by);

-- ------------------------------------------------------------
-- audit_events convergence
-- ------------------------------------------------------------
-- The migration schema uses actor_id/actor_type/operation/timestamp.
-- The cos-plus application layer uses actor/action/metadata/correlation_id.
-- Both sets coexist in the same table; each writer populates its own columns.

-- 2a. Make actor_id nullable (cos-plus records use free-text actor).
ALTER TABLE audit_events
  ALTER COLUMN actor_id DROP NOT NULL;

-- 2b. Add cos-plus supplemental audit columns (idempotent).
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor          TEXT,
  ADD COLUMN IF NOT EXISTS action         TEXT,
  ADD COLUMN IF NOT EXISTS metadata       JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- 2c. Add index on the new text columns used by cos-plus queries.
CREATE INDEX IF NOT EXISTS idx_audit_actor          ON audit_events(actor);
CREATE INDEX IF NOT EXISTS idx_audit_correlation_id ON audit_events(correlation_id);

-- ------------------------------------------------------------
-- Record this migration
-- ------------------------------------------------------------
INSERT INTO schema_migrations (version, description)
VALUES (
  '003',
  'Evidence schema convergence: unify evidence_records and audit_events for gate-530 and cos-plus compatibility'
) ON CONFLICT (version) DO NOTHING;

COMMIT;
