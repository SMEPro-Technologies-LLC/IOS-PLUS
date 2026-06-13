-- ============================================================
-- IOS+ COS+ Database — V8 UCO Obligation Metadata
-- Flyway migration: V8__uco_obligation_metadata.sql
-- Provenance and trust metadata for UCO obligation nodes.
-- Keyed to uco_nodes.uco_node_id.
-- SMEPro Technologies — Confidential
-- ============================================================

-- ── uco_obligation_metadata ──────────────────────────────────
-- Stores provenance, trust, and source metadata for each UCO obligation node.
-- Populated by the workbook ingestion pipeline (scripts/db/preprocess_workbook.py).
-- Designed for reliable provenance queries and audit trails.
CREATE TABLE uco_obligation_metadata (
  metadata_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to the canonical obligation node
  uco_node_id           TEXT        NOT NULL REFERENCES uco_nodes(uco_node_id)
                                      ON DELETE CASCADE,

  -- Workbook provenance fields
  report_family         TEXT,                   -- e.g. "EPA Enforcement", "SEC Disclosure"
  jurisdiction_detail   TEXT,                   -- Raw workbook value, e.g. "State – TX", "Federal / State"
  state                 TEXT,                   -- Normalized state code, e.g. "TX", "CA", or NULL for Federal
  input_source          TEXT,                   -- Original data source identifier
  submission_channel    TEXT,                   -- Submission channel, e.g. "eFiling", "Paper", "API"
  renderer_ref          TEXT,                   -- Reference to the rendering template or form renderer
  obligation_schema_id  TEXT,                   -- Schema/version identifier for the obligation definition

  -- Temporal / revision metadata
  as_of_date            DATE,                   -- Effective date of this obligation record
  verification_status   TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (verification_status IN ('verified','stale','corrected','pending')),
  source_note           TEXT,                   -- Free-text provenance note from workbook or analyst

  -- Audit timestamps (immutable after insert)
  ingested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_by           TEXT        NOT NULL DEFAULT current_user,
  last_verified_at      TIMESTAMPTZ,

  -- Ensure exactly one canonical metadata record per node
  UNIQUE (uco_node_id)
);

-- Indexes to support provenance and compliance queries
CREATE INDEX idx_uom_uco_node        ON uco_obligation_metadata (uco_node_id);
CREATE INDEX idx_uom_report_family   ON uco_obligation_metadata (report_family)
  WHERE report_family IS NOT NULL;
CREATE INDEX idx_uom_state           ON uco_obligation_metadata (state)
  WHERE state IS NOT NULL;
CREATE INDEX idx_uom_vstatus         ON uco_obligation_metadata (verification_status);
CREATE INDEX idx_uom_as_of_date      ON uco_obligation_metadata (as_of_date)
  WHERE as_of_date IS NOT NULL;

-- Grant read access to existing app roles (mirrors V5 RBAC pattern)
GRANT SELECT ON uco_obligation_metadata TO ios_app;
GRANT SELECT ON uco_obligation_metadata TO audit_reader;
GRANT SELECT ON uco_obligation_metadata TO rag_reader;

-- cos_admin (migration/seed role) retains full CRUD via ownership

COMMENT ON TABLE uco_obligation_metadata IS
  'Provenance and trust metadata for UCO obligation nodes. '
  'Keyed 1-to-1 to uco_nodes.uco_node_id. '
  'Populated by preprocess_workbook.py ingestion pipeline. '
  'See EB Doc 3 Amendment / workbook ingestion runbook.';

COMMENT ON COLUMN uco_obligation_metadata.jurisdiction_detail IS
  'Raw jurisdiction value from source workbook (e.g. "State – TX", "Federal / State"). '
  'Preserved for provenance; normalized canonical value is in uco_nodes.jurisdiction_level.';

COMMENT ON COLUMN uco_obligation_metadata.verification_status IS
  'Trust status of this obligation record. '
  'verified=confirmed accurate; stale=not recently reviewed; '
  'corrected=was incorrect, now fixed; pending=not yet reviewed.';
