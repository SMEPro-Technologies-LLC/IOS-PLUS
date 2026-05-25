-- ============================================================
-- IOS+ COS+ Database â€” V3 RAG Vault Tables
-- Flyway migration: V3__rag_vault.sql
-- Requires: pgvector extension
-- 20 sector partitions (matching UCO matrix sectors)
-- HNSW indexes with ef_search tuned per risk tier:
--   CRITICAL=128, HIGH=64, MEDIUM=40
-- SMEPro Technologies â€” Confidential
-- EB Doc 5 Â§3
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- â”€â”€ rag_sources â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE rag_sources (
  source_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_code    TEXT        NOT NULL,
  uco_node_id    TEXT,                    -- UCO node this source maps to (nullable)
  title          TEXT        NOT NULL,
  source_type    TEXT        NOT NULL CHECK (source_type IN ('regulation','guidance','case_law','policy','internal')),
  source_uri     TEXT,
  content_hash   TEXT        NOT NULL,
  embedding_model TEXT       NOT NULL DEFAULT 'text-embedding-3-large',
  indexed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_rag_sources_sector  ON rag_sources (sector_code);
CREATE INDEX idx_rag_sources_uco     ON rag_sources (uco_node_id) WHERE uco_node_id IS NOT NULL;

-- â”€â”€ rag_chunks (partitioned by sector_code) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 20 partitions: one per UCO sector + XSC cross-cutting
CREATE TABLE rag_chunks (
  chunk_id        UUID        NOT NULL DEFAULT gen_random_uuid(),
  source_id       UUID        NOT NULL REFERENCES rag_sources(source_id),
  sector_code     TEXT        NOT NULL,
  uco_node_id     TEXT,
  chunk_index     INTEGER     NOT NULL,
  chunk_text      TEXT        NOT NULL,
  embedding       halfvec(3072) NOT NULL,   -- text-embedding-3-large dimensions
  token_count     INTEGER     NOT NULL,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, sector_code)
) PARTITION BY LIST (sector_code);

-- â”€â”€ Sector partitions (20 total) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE rag_chunks_01_energy        PARTITION OF rag_chunks FOR VALUES IN ('01-ENERGY');
CREATE TABLE rag_chunks_02_healthcare    PARTITION OF rag_chunks FOR VALUES IN ('02-HEALTHCARE');
CREATE TABLE rag_chunks_03_finance       PARTITION OF rag_chunks FOR VALUES IN ('03-FINANCE');
CREATE TABLE rag_chunks_04_food_drug_ag  PARTITION OF rag_chunks FOR VALUES IN ('04-FOOD-DRUG-AG');
CREATE TABLE rag_chunks_05_mfg_transport PARTITION OF rag_chunks FOR VALUES IN ('05-MFG-TRANSPORT');
CREATE TABLE rag_chunks_06_telecom       PARTITION OF rag_chunks FOR VALUES IN ('06-TELECOM-ENV-DEFENSE');
CREATE TABLE rag_chunks_07_insurance     PARTITION OF rag_chunks FOR VALUES IN ('07-INSURANCE');
CREATE TABLE rag_chunks_08_real_estate   PARTITION OF rag_chunks FOR VALUES IN ('08-REAL-ESTATE');
CREATE TABLE rag_chunks_09_agriculture   PARTITION OF rag_chunks FOR VALUES IN ('09-AGRICULTURE');
CREATE TABLE rag_chunks_10_mining        PARTITION OF rag_chunks FOR VALUES IN ('10-MINING');
CREATE TABLE rag_chunks_11_retail        PARTITION OF rag_chunks FOR VALUES IN ('11-WHOLESALE-RETAIL');
CREATE TABLE rag_chunks_12_prof_svcs     PARTITION OF rag_chunks FOR VALUES IN ('12-PROFESSIONAL-SERVICES');
CREATE TABLE rag_chunks_13_education     PARTITION OF rag_chunks FOR VALUES IN ('13-EDUCATION');
CREATE TABLE rag_chunks_14_arts          PARTITION OF rag_chunks FOR VALUES IN ('14-ARTS-ENTERTAINMENT');
CREATE TABLE rag_chunks_15_accom_food    PARTITION OF rag_chunks FOR VALUES IN ('15-ACCOMMODATION-FOOD');
CREATE TABLE rag_chunks_16_admin_waste   PARTITION OF rag_chunks FOR VALUES IN ('16-ADMIN-WASTE');
CREATE TABLE rag_chunks_17_other_svcs    PARTITION OF rag_chunks FOR VALUES IN ('17-OTHER-SERVICES');
CREATE TABLE rag_chunks_18_pub_admin     PARTITION OF rag_chunks FOR VALUES IN ('18-PUBLIC-ADMIN');
CREATE TABLE rag_chunks_19_mgmt_cos      PARTITION OF rag_chunks FOR VALUES IN ('19-MGMT-COMPANIES');
CREATE TABLE rag_chunks_xsc              PARTITION OF rag_chunks FOR VALUES IN ('XSC-CROSS-CUTTING');

-- â”€â”€ HNSW Indexes (per sector partition) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ef_construction=200, m=16 for all; ef_search set per-query via SET hnsw.ef_search
-- CRITICAL sectors: ef_search=128  HIGH: ef_search=64  MEDIUM: ef_search=40
CREATE INDEX idx_hnsw_01_energy   ON rag_chunks_01_energy        USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_02_health   ON rag_chunks_02_healthcare     USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_03_finance  ON rag_chunks_03_finance        USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_04_food     ON rag_chunks_04_food_drug_ag   USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_05_mfg      ON rag_chunks_05_mfg_transport  USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_06_telecom  ON rag_chunks_06_telecom        USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_07_ins      ON rag_chunks_07_insurance      USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_08_re       ON rag_chunks_08_real_estate    USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_09_ag       ON rag_chunks_09_agriculture    USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_10_mining   ON rag_chunks_10_mining         USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_11_retail   ON rag_chunks_11_retail         USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_12_prof     ON rag_chunks_12_prof_svcs      USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_13_edu      ON rag_chunks_13_education      USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_14_arts     ON rag_chunks_14_arts           USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_15_accom    ON rag_chunks_15_accom_food     USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_16_admin    ON rag_chunks_16_admin_waste    USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_17_other    ON rag_chunks_17_other_svcs     USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_18_pub      ON rag_chunks_18_pub_admin      USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_19_mgmt     ON rag_chunks_19_mgmt_cos       USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);
CREATE INDEX idx_hnsw_xsc         ON rag_chunks_xsc               USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=200);


