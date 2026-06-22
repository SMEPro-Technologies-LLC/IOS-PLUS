-- ============================================================
-- SMEPro COS Mini-UDM — PostgreSQL Operationalization
-- Lamar University: v_state_licensure_candidates + fn_lookup_state_licensure_by_cip
-- Date: 2026-06-20
-- PostgreSQL 16+
-- ============================================================

-- ============================================================
-- 1. STAGING TABLES (for CSV seed loading)
-- ============================================================

DROP TABLE IF EXISTS staging_cip_soc_state_license CASCADE;
CREATE TABLE staging_cip_soc_state_license (
    cip_code            VARCHAR(10),
    soc_code            VARCHAR(10),
    state_abbrev        VARCHAR(2),
    state_name          VARCHAR(100),
    license_type        VARCHAR(200),
    compact_member      BOOLEAN,
    compact_status      VARCHAR(50),
    endorsement_required BOOLEAN,
    reciprocity_available BOOLEAN,
    exam_required       VARCHAR(100),
    ce_hours_per_cycle  VARCHAR(20),
    cycle_length_years  VARCHAR(10),
    source_url          VARCHAR(500),
    last_verified       DATE
);

DROP TABLE IF EXISTS staging_compact_participation CASCADE;
CREATE TABLE staging_compact_participation (
    jurisdiction_code   VARCHAR(10),
    jurisdiction_name   VARCHAR(100),
    compact_type        VARCHAR(20),
    member_status       VARCHAR(50),
    effective_date      VARCHAR(20),
    notes               TEXT,
    source_url          VARCHAR(500),
    last_verified       DATE
);

-- ============================================================
-- 2. VIEW: v_state_licensure_candidates
-- Real-time CIP→SOC→State lookup with compact eligibility
-- ============================================================

CREATE OR REPLACE VIEW v_state_licensure_candidates AS
SELECT
    cssl.cip_code,
    cip.title AS cip_title,
    cssl.soc_code,
    soc.title AS soc_title,
    cssl.state_abbrev,
    cssl.state_name,
    cssl.license_type,
    cssl.compact_member,
    cssl.compact_status,
    cssl.endorsement_required,
    cssl.exam_required,
    cssl.ce_hours_per_cycle,
    cssl.cycle_length_years,
    cp.compact_type AS available_compact,
    cp.member_status AS compact_member_status,
    CASE
        WHEN cssl.compact_member AND cp.member_status IN ('Fully Active', 'Partial Implementation')
            THEN TRUE
        WHEN cssl.endorsement_required = FALSE
            THEN TRUE
        ELSE FALSE
    END AS can_practice_in_destination,
    CASE
        WHEN cssl.compact_member AND cp.member_status IN ('Fully Active', 'Partial Implementation')
            THEN 'Compact privilege valid — no additional license required'
        WHEN cssl.endorsement_required
            THEN 'Endorsement required — apply to destination state board'
        ELSE 'Reciprocity or direct licensure may apply — verify with state board'
    END AS practice_notes,
    cssl.source_url,
    cssl.last_verified
FROM staging_cip_soc_state_license cssl
LEFT JOIN staging_compact_participation cp
    ON cssl.state_abbrev = cp.jurisdiction_code
    AND cp.compact_type = CASE
        WHEN cssl.license_type LIKE '%Nurse%' OR cssl.license_type LIKE '%RN%' OR cssl.license_type LIKE '%LVN%' OR cssl.license_type LIKE '%LPN%' THEN 'eNLC'
        WHEN cssl.license_type LIKE '%Physician%' OR cssl.license_type LIKE '%MD%' OR cssl.license_type LIKE '%DO%' THEN 'IMLC'
        WHEN cssl.license_type LIKE '%Psychologist%' OR cssl.license_type LIKE '%Psychology%' THEN 'PSYPACT'
        ELSE NULL
    END
LEFT JOIN uco_nodes cip ON cip.type = 'CIP' AND cip.code = cssl.cip_code
LEFT JOIN uco_nodes soc ON soc.type = 'SOC' AND soc.code = cssl.soc_code;

COMMENT ON VIEW v_state_licensure_candidates IS
'Real-time CIP→SOC→State licensure lookup for Lamar University. Joins student CIP codes, SOC occupations, and destination states with compact participation data. Returns can_practice_in_destination boolean and practice_notes for CoPilot integration.';

-- ============================================================
-- 3. FUNCTION: fn_lookup_state_licensure_by_cip
-- The CoPilot-facing lookup endpoint
-- ============================================================

CREATE OR REPLACE FUNCTION fn_lookup_state_licensure_by_cip(
    p_student_cip       VARCHAR(10),
    p_destination_state VARCHAR(2)
)
RETURNS TABLE (
    cip_code                VARCHAR(10),
    cip_title               VARCHAR(255),
    soc_code                VARCHAR(10),
    soc_title               VARCHAR(255),
    state_abbrev            VARCHAR(2),
    state_name              VARCHAR(100),
    license_type            VARCHAR(200),
    compact_member          BOOLEAN,
    compact_status          VARCHAR(50),
    endorsement_required    BOOLEAN,
    exam_required           VARCHAR(100),
    ce_hours                VARCHAR(20),
    cycle_years             VARCHAR(10),
    can_practice            BOOLEAN,
    practice_notes          TEXT,
    uco_nodes               VARCHAR[],
    source_url              VARCHAR(500),
    last_verified           DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_uco_nodes VARCHAR[];
BEGIN
    -- Gather UCO nodes that apply to this CIP→SOC→State path
    SELECT ARRAY_AGG(DISTINCT uco.uco_node_id)
    INTO v_uco_nodes
    FROM (
        SELECT uco_node_id FROM uco_nodes
        WHERE type = 'CIP' AND code = p_student_cip
        UNION ALL
        SELECT uco_node_id FROM uco_nodes
        WHERE type = 'SOC' AND code IN (
            SELECT soc_code FROM staging_cip_soc_state_license
            WHERE cip_code = p_student_cip AND state_abbrev = p_destination_state
        )
        UNION ALL
        SELECT uco_node_id FROM uco_nodes
        WHERE type = 'NAICS' AND code IN (
            SELECT naics_code FROM uco_obligation_metadata
            WHERE state = p_destination_state
        )
    ) uco;

    RETURN QUERY
    SELECT
        v.cip_code,
        v.cip_title,
        v.soc_code,
        v.soc_title,
        v.state_abbrev,
        v.state_name,
        v.license_type,
        v.compact_member,
        v.compact_status,
        v.endorsement_required,
        v.exam_required,
        v.ce_hours_per_cycle,
        v.cycle_length_years,
        v.can_practice_in_destination,
        v.practice_notes,
        v_uco_nodes,
        v.source_url,
        v.last_verified
    FROM v_state_licensure_candidates v
    WHERE v.cip_code = p_student_cip
      AND v.state_abbrev = p_destination_state;
END;
$$;

COMMENT ON FUNCTION fn_lookup_state_licensure_by_cip IS
'CoPilot-facing lookup: given a student CIP code and destination state, returns full licensure requirements, compact eligibility, and practice notes. Returns UCO_NODE_IDs for traceability. SECURITY DEFINER for read-only access.';

-- ============================================================
-- 4. EXPIRATION TRACKING TABLE
-- DEA (3-year), RN License (biennial), Accreditation (5-year)
-- ============================================================

CREATE TABLE IF NOT EXISTS license_expiration_tracking (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type             VARCHAR(50) NOT NULL CHECK (entity_type IN ('student', 'faculty', 'program', 'institution', 'clinical_site')),
    entity_id               VARCHAR(100) NOT NULL,
    license_type            VARCHAR(200) NOT NULL,
    license_number          VARCHAR(100),
    issuing_authority       VARCHAR(200),
    issue_date              DATE,
    expiration_date         DATE NOT NULL,
    renewal_reminder_date   DATE,
    status                  VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'renewed', 'revoked', 'pending')),
    renewal_cycle_years     INTEGER,
    auto_renew              BOOLEAN DEFAULT FALSE,
    metadata                JSONB,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_let_expiration ON license_expiration_tracking(expiration_date);
CREATE INDEX IF NOT EXISTS idx_let_entity ON license_expiration_tracking(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_let_status ON license_expiration_tracking(status);

COMMENT ON TABLE license_expiration_tracking IS
'Tracks all time-bound credentials: DEA registrations (3-year), state nursing licenses (biennial), accreditation cycles (5-year), and other renewable obligations. Drives automated reminders and CoPilot alerts.';

-- ============================================================
-- 5. EXPIRATION TRACKING FUNCTIONS
-- ============================================================

-- 5.1 Check upcoming expirations (default 90 days ahead)
CREATE OR REPLACE FUNCTION fn_check_expiring_licenses(
    p_days_ahead INTEGER DEFAULT 90
)
RETURNS TABLE (
    entity_type             VARCHAR(50),
    entity_id               VARCHAR(100),
    license_type            VARCHAR(200),
    license_number          VARCHAR(100),
    expiration_date         DATE,
    days_until_expiration   INTEGER,
    status                  VARCHAR(20)
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        et.entity_type,
        et.entity_id,
        et.license_type,
        et.license_number,
        et.expiration_date,
        (et.expiration_date - CURRENT_DATE)::INTEGER AS days_until_expiration,
        et.status
    FROM license_expiration_tracking et
    WHERE et.expiration_date <= CURRENT_DATE + p_days_ahead
      AND et.status = 'active'
    ORDER BY et.expiration_date;
END;
$$;

COMMENT ON FUNCTION fn_check_expiring_licenses IS
'Returns all active licenses expiring within N days. Default 90 days. Used by CoPilot dashboard and agent swarm alerts.';

-- 5.2 Auto-track DEA registration (3-year cycle)
CREATE OR REPLACE FUNCTION fn_track_dea_registration(
    p_entity_id     VARCHAR(100),
    p_dea_number    VARCHAR(100),
    p_issue_date    DATE
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_expiration DATE := p_issue_date + INTERVAL '3 years';
    v_reminder   DATE := v_expiration - INTERVAL '90 days';
    v_id         UUID;
BEGIN
    INSERT INTO license_expiration_tracking (
        entity_type, entity_id, license_type, license_number,
        issuing_authority, issue_date, expiration_date, renewal_reminder_date,
        renewal_cycle_years, metadata
    ) VALUES (
        'faculty', p_entity_id, 'DEA Controlled Substance Registration',
        p_dea_number, 'DEA Diversion Control Division', p_issue_date,
        v_expiration, v_reminder, 3,
        '{"waiver_status": "Fourth Temporary Extension through 2026-12-31", "source": "Federal Register 2025-12-31"}'::JSONB
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fn_track_dea_registration IS
'Auto-inserts DEA registration with 3-year expiration and 90-day reminder. Includes Ryan Haight waiver status in metadata.';

-- 5.3 Auto-track RN license (biennial cycle, configurable)
CREATE OR REPLACE FUNCTION fn_track_rn_license(
    p_entity_id         VARCHAR(100),
    p_license_number    VARCHAR(100),
    p_state             VARCHAR(2),
    p_issue_date        DATE,
    p_cycle_years       INTEGER DEFAULT 2
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_expiration DATE := p_issue_date + (p_cycle_years || ' years')::INTERVAL;
    v_reminder   DATE := v_expiration - INTERVAL '90 days';
    v_id         UUID;
BEGIN
    INSERT INTO license_expiration_tracking (
        entity_type, entity_id, license_type, license_number,
        issuing_authority, issue_date, expiration_date, renewal_reminder_date,
        renewal_cycle_years, metadata
    ) VALUES (
        'student', p_entity_id, 'RN License (' || p_state || ')',
        p_license_number, p_state || ' Board of Nursing', p_issue_date,
        v_expiration, v_reminder, p_cycle_years,
        '{"compact_state": true, "eNLC": true}'::JSONB
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fn_track_rn_license IS
'Auto-inserts state RN license with configurable cycle (default 2 years) and 90-day reminder. Includes eNLC metadata.';

-- 5.4 Auto-track accreditation cycle (5-year cycle)
CREATE OR REPLACE FUNCTION fn_track_accreditation(
    p_entity_id             VARCHAR(100),
    p_accreditation_body    VARCHAR(200),
    p_accreditation_type    VARCHAR(100), -- 'Institutional', 'Programmatic', 'Specialized'
    p_issue_date            DATE
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_expiration DATE := p_issue_date + INTERVAL '5 years';
    v_reminder   DATE := v_expiration - INTERVAL '180 days';
    v_id         UUID;
BEGIN
    INSERT INTO license_expiration_tracking (
        entity_type, entity_id, license_type, license_number,
        issuing_authority, issue_date, expiration_date, renewal_reminder_date,
        renewal_cycle_years, metadata
    ) VALUES (
        'program', p_entity_id, p_accreditation_type || ' Accreditation',
        NULL, p_accreditation_body, p_issue_date,
        v_expiration, v_reminder, 5,
        '{"type": "accreditation", "cycle": "5-year"}'::JSONB
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fn_track_accreditation IS
'Auto-inserts institutional or programmatic accreditation with 5-year expiration and 180-day reminder. Covers SACSCOC, ACEN, CCNE, AACSB, ACBSP.';

-- 5.5 Auto-track clinical site affiliation agreement
CREATE OR REPLACE FUNCTION fn_track_clinical_affiliation(
    p_entity_id             VARCHAR(100),
    p_site_name             VARCHAR(200),
    p_issue_date            DATE
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_expiration DATE := p_issue_date + INTERVAL '1 year';
    v_reminder   DATE := v_expiration - INTERVAL '30 days';
    v_id         UUID;
BEGIN
    INSERT INTO license_expiration_tracking (
        entity_type, entity_id, license_type, license_number,
        issuing_authority, issue_date, expiration_date, renewal_reminder_date,
        renewal_cycle_years, metadata
    ) VALUES (
        'clinical_site', p_entity_id, 'Clinical Affiliation Agreement',
        NULL, p_site_name, p_issue_date,
        v_expiration, v_reminder, 1,
        '{"type": "clinical_affiliation", "auto_renew": false}'::JSONB
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fn_track_clinical_affiliation IS
'Auto-inserts clinical site affiliation agreement with 1-year expiration and 30-day reminder. Critical for nursing program operations.';

-- 5.6 Auto-track faculty certification (e.g., CNE, CCRN, CNOR)
CREATE OR REPLACE FUNCTION fn_track_faculty_certification(
    p_entity_id             VARCHAR(100),
    p_certification_name    VARCHAR(200),
    p_issuing_body          VARCHAR(200),
    p_issue_date            DATE,
    p_cycle_years           INTEGER DEFAULT 5
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_expiration DATE := p_issue_date + (p_cycle_years || ' years')::INTERVAL;
    v_reminder   DATE := v_expiration - INTERVAL '60 days';
    v_id         UUID;
BEGIN
    INSERT INTO license_expiration_tracking (
        entity_type, entity_id, license_type, license_number,
        issuing_authority, issue_date, expiration_date, renewal_reminder_date,
        renewal_cycle_years, metadata
    ) VALUES (
        'faculty', p_entity_id, p_certification_name,
        NULL, p_issuing_body, p_issue_date,
        v_expiration, v_reminder, p_cycle_years,
        '{"type": "faculty_certification"}'::JSONB
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fn_track_faculty_certification IS
'Auto-inserts faculty specialty certification (e.g., CNE, CCRN, CNOR) with configurable cycle and 60-day reminder.';

-- ============================================================
-- 6. CO-PILOT INTEGRATION VIEW
-- Flattened for REST API consumption
-- ============================================================

CREATE OR REPLACE VIEW v_copilot_licensure_lookup AS
SELECT
    fn.cip_code,
    fn.cip_title,
    fn.soc_code,
    fn.soc_title,
    fn.state_abbrev,
    fn.state_name,
    fn.license_type,
    fn.compact_member,
    fn.compact_status,
    fn.endorsement_required,
    fn.exam_required,
    fn.ce_hours,
    fn.cycle_years,
    fn.can_practice,
    fn.practice_notes,
    fn.uco_nodes,
    fn.source_url,
    fn.last_verified,
    -- CoPilot-friendly flags
    CASE WHEN fn.can_practice THEN '✅ APPROVED' ELSE '❌ BLOCKED' END AS copilot_status,
    CASE
        WHEN fn.compact_member THEN 'Compact state — multistate license valid'
        WHEN fn.endorsement_required THEN 'Non-compact state — endorsement required'
        ELSE 'Verify directly with state board'
    END AS copilot_action
FROM fn_lookup_state_licensure_by_cip(
    '51.3801',  -- Example CIP; caller supplies actual parameter
    'TX'        -- Example state; caller supplies actual parameter
) fn;

COMMENT ON VIEW v_copilot_licensure_lookup IS
'Flattened view for CoPilot REST API. Includes copilot_status and copilot_action fields for direct UI rendering. Call with actual CIP and state parameters via the function.';

-- ============================================================
-- 7. AGENT SWARM ALERT VIEW
-- Upcoming expirations formatted for monitoring agents
-- ============================================================

CREATE OR REPLACE VIEW v_agent_swarm_alerts AS
SELECT
    et.id,
    et.entity_type,
    et.entity_id,
    et.license_type,
    et.license_number,
    et.issuing_authority,
    et.expiration_date,
    (et.expiration_date - CURRENT_DATE)::INTEGER AS days_remaining,
    CASE
        WHEN (et.expiration_date - CURRENT_DATE) <= 30 THEN 'CRITICAL'
        WHEN (et.expiration_date - CURRENT_DATE) <= 60 THEN 'WARNING'
        WHEN (et.expiration_date - CURRENT_DATE) <= 90 THEN 'NOTICE'
        ELSE 'OK'
    END AS alert_level,
    et.status,
    et.metadata,
    et.renewal_reminder_date
FROM license_expiration_tracking et
WHERE et.status = 'active'
  AND et.expiration_date <= CURRENT_DATE + INTERVAL '120 days'
ORDER BY et.expiration_date;

COMMENT ON VIEW v_agent_swarm_alerts IS
'Returns all active licenses expiring within 120 days with CRITICAL/WARNING/NOTICE/OK alert levels. Consumed by Layer 3 Live Check agents for dashboard alerts and CoPilot notifications.';

-- ============================================================
-- 8. GRANT PERMISSIONS (for REST API role)
-- ============================================================

GRANT SELECT ON v_state_licensure_candidates TO ios_plus_api;
GRANT SELECT ON v_copilot_licensure_lookup TO ios_plus_api;
GRANT SELECT ON v_agent_swarm_alerts TO ios_plus_api;
GRANT EXECUTE ON FUNCTION fn_lookup_state_licensure_by_cip TO ios_plus_api;
GRANT EXECUTE ON FUNCTION fn_check_expiring_licenses TO ios_plus_api;
GRANT SELECT ON staging_cip_soc_state_license TO ios_plus_api;
GRANT SELECT ON staging_compact_participation TO ios_plus_api;

-- ============================================================
-- 9. EXAMPLE QUERIES (commented out — run manually for testing)
-- ============================================================

/*
-- Test 1: Look up a Lamar nursing graduate moving to California
SELECT * FROM fn_lookup_state_licensure_by_cip('51.3801', 'CA');

-- Test 2: Look up a Lamar nursing graduate moving to Texas (home state)
SELECT * FROM fn_lookup_state_licensure_by_cip('51.3801', 'TX');

-- Test 3: Look up a Lamar business student moving to New York
SELECT * FROM fn_lookup_state_licensure_by_cip('52.0301', 'NY');

-- Test 4: Check all expiring licenses in the next 90 days
SELECT * FROM fn_check_expiring_licenses(90);

-- Test 5: Agent swarm alerts
SELECT * FROM v_agent_swarm_alerts WHERE alert_level IN ('CRITICAL', 'WARNING');

-- Test 6: Track a new DEA registration
SELECT fn_track_dea_registration('faculty-001', 'BX1234567', '2024-01-15');

-- Test 7: Track a new RN license
SELECT fn_track_rn_license('student-001', 'RN-123456-TX', 'TX', '2024-06-01', 2);

-- Test 8: Track ACEN accreditation
SELECT fn_track_accreditation('lamar-nursing-bsn', 'ACEN', 'Programmatic', '2020-01-01');

-- Test 9: Track SACSCOC institutional accreditation
SELECT fn_track_accreditation('lamar-university', 'SACSCOC', 'Institutional', '2019-01-01');

-- Test 10: Track clinical affiliation
SELECT fn_track_clinical_affiliation('lamar-nursing', 'CHRISTUS Southeast Texas', '2024-01-01');

-- Test 11: Track faculty certification
SELECT fn_track_faculty_certification('faculty-001', 'CNE (Certified Nurse Educator)', 'NLN', '2022-03-01', 5);
*/
