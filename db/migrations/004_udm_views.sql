-- IOS+ Platform — UDM Views and Functions
-- Universal Data Model (UDM) crosswalk views for licensure analysis
-- PostgreSQL 16+
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- View: CIP -> NAICS crosswalk
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_cip_naics AS
SELECT
    n.id AS cip_node_id,
    n.code AS cip_code,
    n.title AS cip_title,
    n.description AS cip_description,
    c.id AS crosswalk_id,
    c.match_type,
    c.confidence,
    t.id AS naics_node_id,
    t.code AS naics_code,
    t.title AS naics_title,
    t.description AS naics_description
FROM uco_nodes n
JOIN uco_crosswalk c
    ON c.source_type = 'CIP' AND c.source_code = n.code
JOIN uco_nodes t
    ON t.type = 'NAICS' AND t.code = c.target_code
WHERE n.type = 'CIP'
ORDER BY c.confidence DESC;

COMMENT ON VIEW v_cip_naics IS 'UDM view: CIP educational programs mapped to NAICS industry codes via crosswalk.';

-- ------------------------------------------------------------
-- View: CIP -> SOC crosswalk
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_cip_soc AS
SELECT
    n.id AS cip_node_id,
    n.code AS cip_code,
    n.title AS cip_title,
    n.description AS cip_description,
    c.id AS crosswalk_id,
    c.match_type,
    c.confidence,
    t.id AS soc_node_id,
    t.code AS soc_code,
    t.title AS soc_title,
    t.description AS soc_description
FROM uco_nodes n
JOIN uco_crosswalk c
    ON c.source_type = 'CIP' AND c.source_code = n.code
JOIN uco_nodes t
    ON t.type = 'SOC' AND t.code = c.target_code
WHERE n.type = 'CIP'
ORDER BY c.confidence DESC;

COMMENT ON VIEW v_cip_soc IS 'UDM view: CIP educational programs mapped to SOC occupation codes via crosswalk.';

-- ------------------------------------------------------------
-- View: SOC -> NAICS crosswalk
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_soc_naics AS
SELECT
    n.id AS soc_node_id,
    n.code AS soc_code,
    n.title AS soc_title,
    n.description AS soc_description,
    c.id AS crosswalk_id,
    c.match_type,
    c.confidence,
    t.id AS naics_node_id,
    t.code AS naics_code,
    t.title AS naics_title,
    t.description AS naics_description
FROM uco_nodes n
JOIN uco_crosswalk c
    ON c.source_type = 'SOC' AND c.source_code = n.code
JOIN uco_nodes t
    ON t.type = 'NAICS' AND t.code = c.target_code
WHERE n.type = 'SOC'
ORDER BY c.confidence DESC;

COMMENT ON VIEW v_soc_naics IS 'UDM view: SOC occupation codes mapped to NAICS industry codes via crosswalk.';

-- ------------------------------------------------------------
-- View: State licensure candidates
-- Derived from UCO nodes -> crosswalk -> obligation metadata
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_state_licensure_candidates AS
WITH licensure_paths AS (
    SELECT
        o.state,
        cip.code AS cip,
        cip.title AS cip_title,
        cw_naics.target_code AS naics,
        naics.title AS naics_title,
        cw_soc.target_code AS soc,
        soc.title AS soc_title,
        o.enforcement_type,
        o.title AS obligation_title,
        o.authority,
        o.effective_date,
        o.expiration_date,
        COALESCE(cw_naics.confidence, 0.0) AS naics_confidence,
        COALESCE(cw_soc.confidence, 0.0) AS soc_confidence,
        CASE
            WHEN cw_naics.match_type = 'exact' AND cw_soc.match_type = 'exact' THEN 1.0
            WHEN cw_naics.match_type = 'exact' OR cw_soc.match_type = 'exact' THEN 0.85
            WHEN cw_naics.match_type = 'fuzzy' AND cw_soc.match_type = 'fuzzy' THEN 0.70
            ELSE 0.50
        END AS match_quality,
        -- Simple risk score: higher enforcement = higher risk
        CASE o.enforcement_type
            WHEN 'mandatory' THEN 1.0
            WHEN 'license' THEN 0.9
            WHEN 'examination' THEN 0.8
            WHEN 'certification' THEN 0.7
            WHEN 'registration' THEN 0.5
            WHEN 'background_check' THEN 0.4
            WHEN 'continuing_education' THEN 0.3
            ELSE 0.5
        END AS enforcement_risk,
        o.metadata AS obligation_metadata
    FROM uco_obligation_metadata o
    LEFT JOIN uco_nodes naics ON naics.type = 'NAICS' AND naics.code = o.naics_code
    LEFT JOIN uco_nodes soc ON soc.type = 'SOC' AND soc.code = o.soc_code
    LEFT JOIN uco_crosswalk cw_naics
        ON cw_naics.target_type = 'NAICS' AND cw_naics.target_code = o.naics_code
    LEFT JOIN uco_crosswalk cw_soc
        ON cw_soc.target_type = 'SOC' AND cw_soc.target_code = o.soc_code
    LEFT JOIN uco_nodes cip ON cip.type = 'CIP' AND (
        cip.code = cw_naics.source_code OR cip.code = cw_soc.source_code
    )
    WHERE o.enforcement_type IN ('license', 'certification', 'examination', 'mandatory')
)
SELECT
    state,
    cip,
    naics,
    soc,
    obligation_title AS title,
    enforcement_type,
    ROUND((naics_confidence + soc_confidence + match_quality) / 3.0, 3) AS confidence,
    ROUND(enforcement_risk * (1.0 - (naics_confidence + soc_confidence) / 2.0), 3) AS risk_score,
    authority,
    effective_date,
    expiration_date,
    obligation_metadata
FROM licensure_paths
ORDER BY state, risk_score DESC, confidence DESC;

COMMENT ON VIEW v_state_licensure_candidates IS 'UDM licensure candidate view: derives state licensure requirements from CIP/NAICS/SOC crosswalks and obligation metadata. Includes confidence scoring and risk scoring.';

-- ------------------------------------------------------------
-- Function: Lookup state licensure by CIP and state
-- Returns licensure requirements ranked by direct match, confidence, and risk
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lookup_state_licensure_by_cip(
    student_cip TEXT,
    destination_state TEXT
)
RETURNS TABLE (
    state_code CHAR(2),
    cip_code VARCHAR(32),
    cip_title VARCHAR(255),
    naics_code VARCHAR(32),
    soc_code VARCHAR(32),
    obligation_title VARCHAR(255),
    enforcement_type enforcement_type,
    authority VARCHAR(255),
    effective_date DATE,
    expiration_date DATE,
    confidence NUMERIC,
    risk_score NUMERIC,
    match_rank INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH cip_matches AS (
        -- Direct CIP matches
        SELECT
            o.state,
            cip.code AS cip_code,
            cip.title AS cip_title,
            o.naics_code,
            o.soc_code,
            o.title AS obligation_title,
            o.enforcement_type,
            o.authority,
            o.effective_date,
            o.expiration_date,
            COALESCE(cw.confidence, 1.0) AS match_confidence,
            'direct'::TEXT AS match_source
        FROM uco_nodes cip
        JOIN uco_crosswalk cw
            ON cw.source_type = 'CIP' AND cw.source_code = cip.code
        LEFT JOIN uco_obligation_metadata o
            ON o.state = UPPER(destination_state)
            AND (
                o.naics_code = cw.target_code
                OR o.soc_code = (
                    SELECT code FROM uco_nodes
                    WHERE type = 'SOC' AND code = cw.target_code
                    LIMIT 1
                )
            )
        WHERE cip.type = 'CIP'
          AND cip.code = student_cip
          AND o.id IS NOT NULL
    ),
    indirect_matches AS (
        -- Indirect: CIP -> NAICS -> obligation (or CIP -> SOC -> obligation)
        SELECT
            o.state,
            cip.code AS cip_code,
            cip.title AS cip_title,
            o.naics_code,
            o.soc_code,
            o.title AS obligation_title,
            o.enforcement_type,
            o.authority,
            o.effective_date,
            o.expiration_date,
            COALESCE(cw.confidence, 0.5) AS match_confidence,
            'indirect'::TEXT AS match_source
        FROM uco_nodes cip
        JOIN uco_crosswalk cw
            ON cw.source_type = 'CIP' AND cw.source_code = cip.code
        JOIN uco_obligation_metadata o
            ON o.state = UPPER(destination_state)
            AND (
                o.naics_code = cw.target_code
                OR o.soc_code = cw.target_code
            )
        WHERE cip.type = 'CIP'
          AND cip.code = student_cip
          AND NOT EXISTS (
              SELECT 1 FROM cip_matches cm
              WHERE cm.obligation_title = o.title
          )
    ),
    all_matches AS (
        SELECT * FROM cip_matches
        UNION ALL
        SELECT * FROM indirect_matches
    )
    SELECT
        am.state::CHAR(2),
        am.cip_code::VARCHAR(32),
        am.cip_title::VARCHAR(255),
        am.naics_code::VARCHAR(32),
        am.soc_code::VARCHAR(32),
        am.obligation_title::VARCHAR(255),
        am.enforcement_type,
        am.authority::VARCHAR(255),
        am.effective_date,
        am.expiration_date,
        ROUND(am.match_confidence, 3)::NUMERIC AS confidence,
        ROUND(
            CASE am.enforcement_type
                WHEN 'mandatory' THEN 1.0
                WHEN 'license' THEN 0.9
                WHEN 'examination' THEN 0.8
                WHEN 'certification' THEN 0.7
                WHEN 'registration' THEN 0.5
                WHEN 'background_check' THEN 0.4
                WHEN 'continuing_education' THEN 0.3
                ELSE 0.5
            END * (1.0 - am.match_confidence * 0.5)
        , 3)::NUMERIC AS risk_score,
        ROW_NUMBER() OVER (
            ORDER BY
                CASE am.match_source WHEN 'direct' THEN 0 ELSE 1 END,
                am.match_confidence DESC,
                CASE am.enforcement_type
                    WHEN 'mandatory' THEN 0
                    WHEN 'license' THEN 1
                    WHEN 'examination' THEN 2
                    WHEN 'certification' THEN 3
                    ELSE 4
                END
        )::INTEGER AS match_rank
    FROM all_matches am
    ORDER BY match_rank;
END;
$$;

COMMENT ON FUNCTION fn_lookup_state_licensure_by_cip(TEXT, TEXT) IS
'Looks up state licensure requirements for a given CIP code and destination state. Returns ranked results by direct match priority, confidence, and enforcement risk. Stable function suitable for repeated queries.';

COMMIT;
