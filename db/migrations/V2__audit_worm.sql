-- ============================================================
-- IOS+ COS+ Database — V2 Audit Tables + WORM Enforcement
-- Flyway migration: V2__audit_worm.sql
-- Append-only enforced via: audit_writer RBAC + row-level trigger
-- SMEPro Technologies — Confidential
-- EB Doc 3 §3 / EB Doc 2 §5
-- ============================================================

-- ── evidence_packages ────────────────────────────────────────
-- Ed25519-signed JCS/RFC8785 canonical payloads
-- INSERT-only via audit_writer role; UPDATE/DELETE blocked by trigger
CREATE TABLE evidence_packages (
  package_id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    UUID        NOT NULL,
  session_id                   UUID        NOT NULL,
  event_type                   TEXT        NOT NULL
                                CHECK (event_type IN (
                                  'INFERENCE_REQUEST','GATE_DECISION','RAG_RETRIEVAL',
                                  'UCO_EVALUATION','WORM_COMMIT','KEY_ROTATION','QUARANTINE'
                                )),
  layer_depth                  SMALLINT    NOT NULL CHECK (layer_depth BETWEEN 1 AND 7),
  canonical_payload            JSONB       NOT NULL,   -- JCS-canonical (RFC 8785)
  signature                    TEXT        NOT NULL,   -- Ed25519, base64url
  verification_key_id          UUID        NOT NULL REFERENCES ios_signing_keys(key_id),
  signing_algorithm            TEXT        NOT NULL DEFAULT 'Ed25519',
  canonicalization_algorithm   TEXT        NOT NULL DEFAULT 'JCS/RFC8785',
  classification_level         TEXT        NOT NULL DEFAULT 'CONFIDENTIAL',
  published_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  merkle_root_id               UUID        -- set after batch Merkle publication
);
CREATE INDEX idx_ep_tenant     ON evidence_packages (tenant_id);
CREATE INDEX idx_ep_session    ON evidence_packages (session_id);
CREATE INDEX idx_ep_published  ON evidence_packages (published_at);
CREATE INDEX idx_ep_event_type ON evidence_packages (event_type);

-- ── gate_decisions ───────────────────────────────────────────
CREATE TABLE gate_decisions (
  decision_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID        NOT NULL,
  tenant_id                UUID        NOT NULL,
  decided_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  uco_node_id              TEXT        NOT NULL,
  policy_action            TEXT        NOT NULL CHECK (policy_action IN ('BLOCK','APPROVE','ESCALATE')),
  risk_weight              SMALLINT    NOT NULL CHECK (risk_weight BETWEEN 5 AND 10),
  rationale                TEXT        NOT NULL,
  override_applied         BOOLEAN     NOT NULL DEFAULT false,
  override_authorized_by   TEXT,
  evidence_package_id      UUID        REFERENCES evidence_packages(package_id),
  latency_ms               INTEGER     NOT NULL
);
CREATE INDEX idx_gd_session    ON gate_decisions (session_id);
CREATE INDEX idx_gd_tenant     ON gate_decisions (tenant_id);
CREATE INDEX idx_gd_uco_node   ON gate_decisions (uco_node_id);
CREATE INDEX idx_gd_action     ON gate_decisions (policy_action);

-- ── evidence_source_manifest ─────────────────────────────────
CREATE TABLE evidence_source_manifest (
  manifest_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id     UUID        NOT NULL REFERENCES evidence_packages(package_id),
  source_type    TEXT        NOT NULL,
  source_uri     TEXT        NOT NULL,
  content_hash   TEXT        NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── quarantine_records ───────────────────────────────────────
CREATE TABLE quarantine_records (
  quarantine_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        NOT NULL,
  tenant_id        UUID        NOT NULL,
  uco_node_id      TEXT        NOT NULL,
  reason           TEXT        NOT NULL,
  policy_action    TEXT        NOT NULL DEFAULT 'BLOCK',
  evidence_id      UUID        REFERENCES evidence_packages(package_id),
  quarantined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at      TIMESTAMPTZ,
  released_by      TEXT
);
CREATE INDEX idx_qr_tenant   ON quarantine_records (tenant_id);
CREATE INDEX idx_qr_node     ON quarantine_records (uco_node_id);

-- ── merkle_roots ─────────────────────────────────────────────
CREATE TABLE merkle_roots (
  merkle_root_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_package_ids    JSONB       NOT NULL,    -- array of package_id UUIDs
  merkle_root          TEXT        NOT NULL,    -- hex SHA-256 Merkle root
  batch_size           INTEGER     NOT NULL,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  dns_published_at     TIMESTAMPTZ
);

-- ════════════════════════════════════════════════════════════
-- WORM TRIGGER FUNCTIONS
-- Enforces append-only at database layer (belt-and-suspenders
-- with audit_writer RBAC which grants INSERT-only).
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION worm_block_update_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'WORM VIOLATION: UPDATE/DELETE blocked on table [%]. '
    'Audit records are immutable. Evidence package_id: % Session: %',
    TG_TABLE_NAME, OLD.package_id, OLD.session_id;
END;
$$;

CREATE OR REPLACE FUNCTION worm_block_update_delete_generic()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'WORM VIOLATION: UPDATE/DELETE blocked on immutable audit table [%].',
    TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER worm_evidence_packages
  BEFORE UPDATE OR DELETE ON evidence_packages
  FOR EACH ROW EXECUTE FUNCTION worm_block_update_delete();

CREATE TRIGGER worm_gate_decisions
  BEFORE UPDATE OR DELETE ON gate_decisions
  FOR EACH ROW EXECUTE FUNCTION worm_block_update_delete_generic();

CREATE TRIGGER worm_quarantine_records
  BEFORE UPDATE OR DELETE ON quarantine_records
  FOR EACH ROW EXECUTE FUNCTION worm_block_update_delete_generic();

CREATE TRIGGER worm_merkle_roots
  BEFORE UPDATE OR DELETE ON merkle_roots
  FOR EACH ROW EXECUTE FUNCTION worm_block_update_delete_generic();

COMMENT ON TABLE evidence_packages IS
  'WORM-enforced audit table. Append-only via audit_writer role (INSERT-only RBAC) '
  'and DB-layer trigger (worm_evidence_packages). Ed25519+JCS/RFC8785 signed. '
  'See EB Doc 2 §5.1.';
