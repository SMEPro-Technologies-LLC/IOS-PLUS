-- =============================================================
-- V5__rbac_app_roles.sql
-- IOS+ COS+ Role-Based Access Control
-- SMEPro Technologies — EB Doc 6 §4.2 Least-Privilege RBAC
-- =============================================================

BEGIN;

-- 1. CREATE ROLES (idempotent)
DO $$ BEGIN
  CREATE ROLE ios_app WITH LOGIN PASSWORD 'iosplus_dev_app';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE ios_app WITH LOGIN PASSWORD 'iosplus_dev_app';
END $$;

DO $$ BEGIN
  CREATE ROLE audit_writer WITH LOGIN PASSWORD 'iosplus_dev_audit_writer';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE audit_writer WITH LOGIN PASSWORD 'iosplus_dev_audit_writer';
END $$;

DO $$ BEGIN
  CREATE ROLE audit_reader WITH LOGIN PASSWORD 'iosplus_dev_audit_reader';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE audit_reader WITH LOGIN PASSWORD 'iosplus_dev_audit_reader';
END $$;

DO $$ BEGIN
  CREATE ROLE rag_reader WITH LOGIN PASSWORD 'iosplus_dev_rag_reader';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE rag_reader WITH LOGIN PASSWORD 'iosplus_dev_rag_reader';
END $$;

DO $$ BEGIN
  CREATE ROLE rag_writer WITH LOGIN PASSWORD 'iosplus_dev_rag_writer';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE rag_writer WITH LOGIN PASSWORD 'iosplus_dev_rag_writer';
END $$;

-- 2. DATABASE + SCHEMA ACCESS
GRANT CONNECT ON DATABASE ios_plus TO
  ios_app, audit_writer, audit_reader, rag_reader, rag_writer;
GRANT USAGE ON SCHEMA public TO
  ios_app, audit_writer, audit_reader, rag_reader, rag_writer;

-- 3. ios_app — middleware-engine primary role
--    Full operational r/w; no DELETE anywhere (WORM-safe)
GRANT SELECT, INSERT, UPDATE ON
  tenant_registry, tenant_naics_profiles, objects, quarantine_records,
  compliance_chains, filing_calendar, regulatory_profiles,
  agency_registry, naics_decoder, code_crosswalk
TO ios_app;

-- V2 evidence tables: INSERT only — no UPDATE (WORM)
GRANT SELECT, INSERT ON
  evidence_packages, gate_decisions, merkle_roots,
  ios_signing_keys, evidence_source_manifest
TO ios_app;

-- V3 RAG: read-only via ios_app (writes go through rag_writer)
GRANT SELECT ON
  rag_sources, rag_vault_sector_partitions,
  rag_chunks,
  rag_chunks_01_energy, rag_chunks_02_healthcare, rag_chunks_03_finance,
  rag_chunks_04_food_drug_ag, rag_chunks_05_mfg_transport, rag_chunks_06_telecom,
  rag_chunks_07_insurance, rag_chunks_08_real_estate, rag_chunks_09_agriculture,
  rag_chunks_10_mining, rag_chunks_11_retail, rag_chunks_12_prof_svcs,
  rag_chunks_13_education, rag_chunks_14_arts, rag_chunks_15_accom_food,
  rag_chunks_16_admin_waste, rag_chunks_17_other_svcs, rag_chunks_18_pub_admin,
  rag_chunks_19_mgmt_cos, rag_chunks_xsc
TO ios_app;

-- V4 UCO: read-only
GRANT SELECT ON uco_nodes, uco_evaluation_results TO ios_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ios_app;

-- 4. audit_writer — WORM append-only (EB Doc 6 §4.2)
--    INSERT + minimal SELECT for idempotency. No UPDATE. No DELETE.
GRANT SELECT, INSERT ON
  evidence_packages, gate_decisions, merkle_roots,
  ios_signing_keys, evidence_source_manifest, quarantine_records
TO audit_writer;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO audit_writer;

-- 5. audit_reader — SELECT only: evidence + compliance
GRANT SELECT ON
  evidence_packages, gate_decisions, merkle_roots,
  ios_signing_keys, evidence_source_manifest, compliance_chains,
  quarantine_records, tenant_registry, tenant_naics_profiles,
  filing_calendar, regulatory_profiles, agency_registry,
  naics_decoder, code_crosswalk
TO audit_reader;

-- 6. rag_reader — SELECT only: RAG + UCO + reference tables
GRANT SELECT ON
  rag_sources, rag_vault_sector_partitions,
  rag_chunks,
  rag_chunks_01_energy, rag_chunks_02_healthcare, rag_chunks_03_finance,
  rag_chunks_04_food_drug_ag, rag_chunks_05_mfg_transport, rag_chunks_06_telecom,
  rag_chunks_07_insurance, rag_chunks_08_real_estate, rag_chunks_09_agriculture,
  rag_chunks_10_mining, rag_chunks_11_retail, rag_chunks_12_prof_svcs,
  rag_chunks_13_education, rag_chunks_14_arts, rag_chunks_15_accom_food,
  rag_chunks_16_admin_waste, rag_chunks_17_other_svcs, rag_chunks_18_pub_admin,
  rag_chunks_19_mgmt_cos, rag_chunks_xsc,
  uco_nodes, uco_evaluation_results,
  naics_decoder, code_crosswalk, regulatory_profiles,
  agency_registry, tenant_naics_profiles
TO rag_reader;

-- 7. rag_writer — RAG ingestion: SELECT + INSERT + UPDATE on RAG tables only
GRANT SELECT, INSERT, UPDATE ON
  rag_sources, rag_vault_sector_partitions,
  rag_chunks,
  rag_chunks_01_energy, rag_chunks_02_healthcare, rag_chunks_03_finance,
  rag_chunks_04_food_drug_ag, rag_chunks_05_mfg_transport, rag_chunks_06_telecom,
  rag_chunks_07_insurance, rag_chunks_08_real_estate, rag_chunks_09_agriculture,
  rag_chunks_10_mining, rag_chunks_11_retail, rag_chunks_12_prof_svcs,
  rag_chunks_13_education, rag_chunks_14_arts, rag_chunks_15_accom_food,
  rag_chunks_16_admin_waste, rag_chunks_17_other_svcs, rag_chunks_18_pub_admin,
  rag_chunks_19_mgmt_cos, rag_chunks_xsc
TO rag_writer;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rag_writer;

-- 8. DEFAULT PRIVILEGES — future tables inherit grants automatically
ALTER DEFAULT PRIVILEGES FOR ROLE cos_admin IN SCHEMA public
  GRANT SELECT ON TABLES TO audit_reader, rag_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE cos_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO ios_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cos_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO rag_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE cos_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ios_app, audit_writer, rag_writer;

COMMIT;
