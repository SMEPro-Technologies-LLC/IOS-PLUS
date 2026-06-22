-- IOS+ End-to-End CIP→SOC→State Licensure Lookup Test
-- PostgreSQL 16+
-- ============================================================
-- Run this after migrations V7-V10 and after loading seed CSVs
-- ============================================================

-- ------------------------------------------------------------
-- 1. Create staging tables for CSV seed data
-- ------------------------------------------------------------
DROP TABLE IF EXISTS staging_cip_soc_state_license;
CREATE TABLE staging_cip_soc_state_license (
    cip_code VARCHAR(10),
    soc_code VARCHAR(10),
    state_abbrev VARCHAR(2),
    state_name VARCHAR(100),
    license_type VARCHAR(200),
    compact_member BOOLEAN,
    compact_status VARCHAR(50),
    endorsement_required BOOLEAN,
    reciprocity_available BOOLEAN,
    exam_required VARCHAR(100),
    ce_hours_per_cycle VARCHAR(20),
    cycle_length_years VARCHAR(10),
    source_url VARCHAR(500),
    last_verified DATE
);

DROP TABLE IF EXISTS staging_compact_participation;
CREATE TABLE staging_compact_participation (
    jurisdiction_code VARCHAR(10),
    jurisdiction_name VARCHAR(100),
    compact_type VARCHAR(20),
    member_status VARCHAR(50),
    effective_date VARCHAR(20),
    notes TEXT,
    source_url VARCHAR(500),
    last_verified DATE
);

-- ------------------------------------------------------------
-- 2. Load CSVs (adjust paths for your environment)
-- ------------------------------------------------------------
-- COPY staging_cip_soc_state_license FROM '/path/to/cip_soc_state_license.csv' CSV HEADER;
-- COPY staging_compact_participation FROM '/path/to/compact_participation.csv' CSV HEADER;

-- ------------------------------------------------------------
-- 3. End-to-End Test Queries
-- ------------------------------------------------------------

-- Test 1: Given CIP 51.3801 (Registered Nursing), find all valid SOC → State → License paths
SELECT
    cssl.cip_code,
    cssl.soc_code,
    cssl.state_abbrev,
    cssl.state_name,
    cssl.license_type,
    cssl.compact_member,
    cssl.compact_status,
    cssl.endorsement_required,
    cp.compact_type AS available_compact,
    cp.member_status AS compact_member_status
FROM staging_cip_soc_state_license cssl
LEFT JOIN staging_compact_participation cp
    ON cssl.state_abbrev = cp.jurisdiction_code
    AND cp.compact_type = 'eNLC'
WHERE cssl.cip_code = '51.3801'
ORDER BY cssl.state_abbrev;

-- Test 2: Destination-state lookup for a nursing graduate moving to California
SELECT
    cssl.cip_code,
    cssl.soc_code,
    cssl.state_abbrev,
    cssl.state_name,
    cssl.license_type,
    cssl.compact_member,
    cssl.compact_status,
    cssl.endorsement_required,
    cssl.exam_required,
    cssl.ce_hours_per_cycle,
    cssl.cycle_length_years
FROM staging_cip_soc_state_license cssl
WHERE cssl.cip_code = '51.3801'
  AND cssl.soc_code = '29-1141'
  AND cssl.state_abbrev = 'CA';

-- Test 3: Multi-state compact eligibility for a Texas RN (home state = TX)
SELECT
    cp.jurisdiction_code,
    cp.jurisdiction_name,
    cp.compact_type,
    cp.member_status
FROM staging_compact_participation cp
WHERE cp.compact_type = 'eNLC'
  AND cp.member_status IN ('Fully Active', 'Partial Implementation')
ORDER BY cp.jurisdiction_code;

-- Test 4: IMLC participation for a Texas physician (home state = TX)
SELECT
    cp.jurisdiction_code,
    cp.jurisdiction_name,
    cp.compact_type,
    cp.member_status
FROM staging_compact_participation cp
WHERE cp.compact_type = 'IMLC'
  AND cp.member_status IN ('Fully Active SPL', 'Fully Active Non-SPL', 'Fully Active')
ORDER BY cp.jurisdiction_code;

-- Test 5: PSYPACT participation for a psychologist
SELECT
    cp.jurisdiction_code,
    cp.jurisdiction_name,
    cp.compact_type,
    cp.member_status
FROM staging_compact_participation cp
WHERE cp.compact_type = 'PSYPACT'
  AND cp.member_status = 'Fully Active'
ORDER BY cp.jurisdiction_code;

-- Test 6: Cross-compact comparison for a single state (e.g., Texas)
SELECT
    cp.compact_type,
    cp.member_status,
    cp.effective_date,
    cp.notes
FROM staging_compact_participation cp
WHERE cp.jurisdiction_code = 'TX'
ORDER BY cp.compact_type;

-- Test 7: Validate all 43 eNLC jurisdictions are present
SELECT COUNT(DISTINCT jurisdiction_code) AS eNLC_count
FROM staging_compact_participation
WHERE compact_type = 'eNLC' AND member_status != 'Non-Compact';

-- Test 8: Validate all 45 IMLC jurisdictions are present
SELECT COUNT(DISTINCT jurisdiction_code) AS IMLC_count
FROM staging_compact_participation
WHERE compact_type = 'IMLC' AND member_status != 'Non-Compact';

-- Test 9: Validate all 42-43 PSYPACT jurisdictions are present
SELECT COUNT(DISTINCT jurisdiction_code) AS PSYPACT_count
FROM staging_compact_participation
WHERE compact_type = 'PSYPACT' AND member_status != 'Non-Compact';

-- Test 10: Find states where a TX RN can practice WITHOUT additional license
SELECT
    cp.jurisdiction_code,
    cp.jurisdiction_name,
    cp.compact_type,
    cp.member_status
FROM staging_compact_participation cp
WHERE cp.compact_type = 'eNLC'
  AND cp.member_status IN ('Fully Active', 'Partial Implementation');

-- Test 11: Find states where a TX physician can get expedited license via IMLC
SELECT
    cp.jurisdiction_code,
    cp.jurisdiction_name,
    cp.compact_type,
    cp.member_status
FROM staging_compact_participation cp
WHERE cp.compact_type = 'IMLC'
  AND cp.member_status IN ('Fully Active SPL', 'Fully Active');

-- Test 12: Find states where a psychologist can practice telehealth via PSYPACT
SELECT
    cp.jurisdiction_code,
    cp.jurisdiction_name,
    cp.compact_type,
    cp.member_status
FROM staging_compact_participation cp
WHERE cp.compact_type = 'PSYPACT'
  AND cp.member_status = 'Fully Active';

-- ------------------------------------------------------------
-- 4. Validation Assertions (should all return TRUE / counts)
-- ------------------------------------------------------------
SELECT
    (SELECT COUNT(*) FROM staging_compact_participation WHERE compact_type = 'eNLC' AND member_status = 'Fully Active') AS eNLC_fully_active_count,
    (SELECT COUNT(*) FROM staging_compact_participation WHERE compact_type = 'eNLC' AND member_status = 'Enacted Pending') AS eNLC_enacted_pending_count,
    (SELECT COUNT(*) FROM staging_compact_participation WHERE compact_type = 'eNLC' AND member_status = 'Partial Implementation') AS eNLC_partial_count,
    (SELECT COUNT(*) FROM staging_compact_participation WHERE compact_type = 'IMLC' AND member_status IN ('Fully Active SPL', 'Fully Active Non-SPL')) AS IMLC_active_count,
    (SELECT COUNT(*) FROM staging_compact_participation WHERE compact_type = 'PSYPACT' AND member_status = 'Fully Active') AS PSYPACT_active_count;

-- ------------------------------------------------------------
-- 5. Cleanup (optional — uncomment to drop staging tables after testing)
-- ------------------------------------------------------------
-- DROP TABLE IF EXISTS staging_cip_soc_state_license;
-- DROP TABLE IF EXISTS staging_compact_participation;
