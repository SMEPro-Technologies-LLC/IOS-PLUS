-- ============================================================
-- IOS+ COS+ Database — V4 UCO Amendment v1.1
-- Flyway migration: V4__uco_amendment.sql
-- 9 new tables, 14 indexes
-- 350-node Universal Compliance Decoding Matrix schema
-- SMEPro Technologies — Confidential
-- EB Doc 3 Amendment v1.1 / EB Docs 4–6
-- ============================================================

-- ── agency_registry ──────────────────────────────────────────
CREATE TABLE agency_registry (
  agency_id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_code       TEXT    NOT NULL UNIQUE,  -- e.g. "EPA", "FDA", "OCC"
  agency_name       TEXT    NOT NULL,
  jurisdiction      TEXT    NOT NULL CHECK (jurisdiction IN ('Federal','State','Local','International')),
  parent_agency     TEXT,
  website           TEXT,
  notes             TEXT
);
CREATE INDEX idx_agency_jurisdiction ON agency_registry (jurisdiction);
CREATE INDEX idx_agency_code         ON agency_registry (agency_code);

-- ── uco_nodes ────────────────────────────────────────────────
-- 350 nodes (331 sector-specific + 19 UCO-XSC-5xxx cross-cutting)
-- BLOCK=192, APPROVE=108, ESCALATE=50 | Risk weight floor: 5, ceiling: 10
CREATE TABLE uco_nodes (
  -- Regulatory Identity (cols 0–19)
  uco_node_id             TEXT        PRIMARY KEY,  -- e.g. "UCO-ENERGY-001"
  broad_industry          TEXT        NOT NULL,
  industry_subtype        TEXT        NOT NULL,
  specific_activity       TEXT        NOT NULL,
  jurisdiction_level      TEXT        NOT NULL CHECK (jurisdiction_level IN ('Federal','State','Local','International')),
  governing_agency        TEXT        NOT NULL,
  regulation_name         TEXT        NOT NULL,
  cfr_usc_citation        TEXT,
  report_form_name        TEXT,
  form_code               TEXT,
  filing_frequency        TEXT,
  key_due_dates           TEXT,
  business_segment        TEXT,
  penalties_consequences  TEXT,
  cip                     TEXT,
  sic                     TEXT,
  naics                   TEXT        NOT NULL,
  soc                     TEXT,
  isic                    TEXT,
  hs_hts                  TEXT,
  notes                   TEXT,
  -- COS+ Engine Metadata (cols 20–29)
  ontology_level          TEXT        NOT NULL CHECK (ontology_level IN ('sector','subsector','activity','cross-cutting')),
  compliance_chain_ref    TEXT,
  operating_segment       TEXT,
  responsible_role        TEXT,
  enforcement_type        TEXT        NOT NULL CHECK (enforcement_type IN (
                            'Criminal','Civil Monetary Penalty','Administrative',
                            'License/Certificate','Injunctive','Warning/Notice'
                          )),
  risk_weight             SMALLINT    NOT NULL CHECK (risk_weight BETWEEN 5 AND 10),
  ybr_gate                TEXT        NOT NULL CHECK (ybr_gate IN ('L3','L4','L5','L7')),
  policy_action           TEXT        NOT NULL CHECK (policy_action IN ('BLOCK','APPROVE','ESCALATE')),
  last_updated            DATE        NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX idx_uco_naics          ON uco_nodes (naics);
CREATE INDEX idx_uco_policy_action  ON uco_nodes (policy_action);
CREATE INDEX idx_uco_risk_weight    ON uco_nodes (risk_weight);
CREATE INDEX idx_uco_ontology       ON uco_nodes (ontology_level);
CREATE INDEX idx_uco_agency         ON uco_nodes (governing_agency);

-- ── naics_decoder ────────────────────────────────────────────
CREATE TABLE naics_decoder (
  naics_code    TEXT    PRIMARY KEY,
  description   TEXT    NOT NULL,
  sector_code   TEXT    NOT NULL,   -- e.g. "01-ENERGY"
  sector_name   TEXT    NOT NULL,
  subsector     TEXT,
  industry_grp  TEXT,
  naics_year    INTEGER NOT NULL DEFAULT 2022
);
CREATE INDEX idx_naics_sector ON naics_decoder (sector_code);

-- ── code_crosswalk ───────────────────────────────────────────
CREATE TABLE code_crosswalk (
  crosswalk_id  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code_system   TEXT    NOT NULL CHECK (code_system IN ('CIP','SIC','NAICS','SOC','ISIC','HS/HTS')),
  source_code   TEXT    NOT NULL,
  target_system TEXT    NOT NULL CHECK (target_system IN ('CIP','SIC','NAICS','SOC','ISIC','HS/HTS')),
  target_code   TEXT    NOT NULL,
  confidence    NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence BETWEEN 0 AND 1),
  notes         TEXT
);
CREATE INDEX idx_crosswalk_source ON code_crosswalk (code_system, source_code);
CREATE INDEX idx_crosswalk_target ON code_crosswalk (target_system, target_code);

-- ── compliance_chains ────────────────────────────────────────
CREATE TABLE compliance_chains (
  chain_id        TEXT    PRIMARY KEY,   -- e.g. "CHAIN-ENERGY-001"
  chain_name      TEXT    NOT NULL,
  sector_code     TEXT    NOT NULL,
  uco_node_ids    TEXT[]  NOT NULL,      -- ordered sequence of UCO node IDs
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── tenant_naics_profiles ────────────────────────────────────
CREATE TABLE tenant_naics_profiles (
  profile_id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID    NOT NULL REFERENCES tenant_registry(tenant_id) ON DELETE CASCADE,
  naics_codes     TEXT[]  NOT NULL,
  sic_codes       TEXT[]  NOT NULL DEFAULT '{}',
  jurisdictions   TEXT[]  NOT NULL DEFAULT ARRAY['Federal'],
  effective_date  DATE    NOT NULL DEFAULT CURRENT_DATE,
  resolved_at     TIMESTAMPTZ,
  resolved_node_count INTEGER,
  UNIQUE (tenant_id, effective_date)
);
CREATE INDEX idx_tnp_tenant ON tenant_naics_profiles (tenant_id);

-- ── uco_evaluation_results ───────────────────────────────────
CREATE TABLE uco_evaluation_results (
  eval_id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID    NOT NULL,
  tenant_id         UUID    NOT NULL,
  uco_node_id       TEXT    NOT NULL REFERENCES uco_nodes(uco_node_id),
  policy_action     TEXT    NOT NULL CHECK (policy_action IN ('BLOCK','APPROVE','ESCALATE')),
  dimension_scores  JSONB   NOT NULL,   -- {jurisdiction_match, activity_match, ...}
  composite_score   NUMERIC(5,4),
  evaluation_ms     INTEGER NOT NULL,
  evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_pkg_id   UUID    REFERENCES evidence_packages(package_id)
);
CREATE INDEX idx_uer_session    ON uco_evaluation_results (session_id);
CREATE INDEX idx_uer_uco_node   ON uco_evaluation_results (uco_node_id);
CREATE INDEX idx_uer_action     ON uco_evaluation_results (policy_action);

-- ── filing_calendar ──────────────────────────────────────────
CREATE TABLE filing_calendar (
  calendar_id     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  uco_node_id     TEXT    NOT NULL REFERENCES uco_nodes(uco_node_id),
  tenant_id       UUID    REFERENCES tenant_registry(tenant_id),
  due_date        DATE    NOT NULL,
  filing_period   TEXT    NOT NULL,   -- "Q1 2026", "Annual 2026", etc.
  form_code       TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','filed','overdue','waived')),
  reminder_sent   BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_filing_uco      ON filing_calendar (uco_node_id);
CREATE INDEX idx_filing_due      ON filing_calendar (due_date);
CREATE INDEX idx_filing_tenant   ON filing_calendar (tenant_id) WHERE tenant_id IS NOT NULL;

-- ── rag_vault_sector_partitions ──────────────────────────────
CREATE TABLE rag_vault_sector_partitions (
  partition_name    TEXT    PRIMARY KEY,   -- e.g. "rag_chunks_01_energy"
  sector_code       TEXT    NOT NULL UNIQUE,
  uco_node_count    INTEGER NOT NULL,
  risk_tier         TEXT    NOT NULL CHECK (risk_tier IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  hnsw_ef_search    INTEGER NOT NULL,      -- CRITICAL=128, HIGH=64, MEDIUM=40
  chunk_count       INTEGER NOT NULL DEFAULT 0,
  last_ingested_at  TIMESTAMPTZ,
  status            TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','rebuilding','error'))
);

-- Seed partition registry from UCO matrix sector distribution
INSERT INTO rag_vault_sector_partitions (partition_name, sector_code, uco_node_count, risk_tier, hnsw_ef_search) VALUES
  ('rag_chunks_01_energy',     '01-ENERGY',                54, 'CRITICAL', 128),
  ('rag_chunks_02_healthcare', '02-HEALTHCARE',            36, 'CRITICAL', 128),
  ('rag_chunks_03_finance',    '03-FINANCE',               30, 'CRITICAL', 128),
  ('rag_chunks_04_food',       '04-FOOD-DRUG-AG',          16, 'HIGH',      64),
  ('rag_chunks_05_mfg',        '05-MFG-TRANSPORT',         27, 'HIGH',      64),
  ('rag_chunks_06_telecom',    '06-TELECOM-ENV-DEFENSE',   20, 'HIGH',      64),
  ('rag_chunks_07_insurance',  '07-INSURANCE',             35, 'CRITICAL', 128),
  ('rag_chunks_08_re',         '08-REAL-ESTATE',           10, 'HIGH',      64),
  ('rag_chunks_09_ag',         '09-AGRICULTURE',            8, 'MEDIUM',    40),
  ('rag_chunks_10_mining',     '10-MINING',                 5, 'HIGH',      64),
  ('rag_chunks_11_retail',     '11-WHOLESALE-RETAIL',      15, 'HIGH',      64),
  ('rag_chunks_12_prof',       '12-PROFESSIONAL-SERVICES', 13, 'HIGH',      64),
  ('rag_chunks_13_edu',        '13-EDUCATION',             10, 'CRITICAL', 128),
  ('rag_chunks_14_arts',       '14-ARTS-ENTERTAINMENT',     9, 'HIGH',      64),
  ('rag_chunks_15_accom',      '15-ACCOMMODATION-FOOD',    10, 'MEDIUM',    40),
  ('rag_chunks_16_admin',      '16-ADMIN-WASTE',            9, 'HIGH',      64),
  ('rag_chunks_17_other',      '17-OTHER-SERVICES',         9, 'HIGH',      64),
  ('rag_chunks_18_pub',        '18-PUBLIC-ADMIN',           9, 'CRITICAL', 128),
  ('rag_chunks_19_mgmt',       '19-MGMT-COMPANIES',         6, 'HIGH',      64),
  ('rag_chunks_xsc',           'XSC-CROSS-CUTTING',        19, 'CRITICAL', 128);

COMMENT ON TABLE uco_nodes IS
  '350-node Universal Compliance Decoding Matrix. '
  '331 sector-specific + 19 UCO-XSC-5xxx cross-cutting. '
  'BLOCK=192 (54.9%), APPROVE=108 (30.9%), ESCALATE=50 (14.3%). '
  'Risk weight floor: 5. See EB Doc 4 §2.';
