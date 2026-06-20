-- ============================================================
-- IOS+ COS+ Database — V9 Student CIP -> State Licensure Lookup
-- Adds:
--   1) normalized licensure candidate view
--   2) query function for CIP + destination_state lookup
-- ============================================================

CREATE OR REPLACE VIEW v_state_licensure_candidates AS
SELECT
  un.uco_node_id,
  un.broad_industry,
  un.industry_subtype,
  un.specific_activity,
  un.jurisdiction_level,
  un.governing_agency,
  un.regulation_name,
  un.cfr_usc_citation,
  un.report_form_name,
  un.form_code,
  un.filing_frequency,
  un.key_due_dates,
  un.business_segment,
  un.penalties_consequences,
  un.cip,
  un.sic,
  un.naics,
  un.soc,
  un.isic,
  un.hs_hts,
  un.notes,
  un.ontology_level,
  un.compliance_chain_ref,
  un.operating_segment,
  un.responsible_role,
  un.enforcement_type,
  un.risk_weight,
  un.ybr_gate,
  un.policy_action,
  un.last_updated,
  uom.report_family,
  uom.jurisdiction_detail,
  uom.state,
  uom.input_source,
  uom.submission_channel,
  uom.renderer_ref,
  uom.obligation_schema_id,
  uom.as_of_date,
  uom.verification_status,
  uom.source_note,
  uom.ingested_at,
  uom.ingested_by,
  uom.last_verified_at,
  (un.enforcement_type = 'License/Certificate') AS licensure_flag,
  CASE
    WHEN uom.verification_status IN ('verified', 'corrected') THEN 0
    ELSE 1
  END AS verification_rank
FROM uco_nodes un
JOIN uco_obligation_metadata uom
  ON uom.uco_node_id = un.uco_node_id;

COMMENT ON VIEW v_state_licensure_candidates IS
  'State-scoped UCO obligation candidates with derived licensure_flag and verification rank.';

CREATE OR REPLACE FUNCTION fn_lookup_state_licensure_by_cip(
  p_student_cip TEXT,
  p_destination_state TEXT
)
RETURNS TABLE (
  student_cip TEXT,
  destination_state TEXT,
  uco_node_id TEXT,
  regulation_name TEXT,
  governing_agency TEXT,
  jurisdiction_level TEXT,
  jurisdiction_detail TEXT,
  state TEXT,
  verification_status TEXT,
  licensure_flag BOOLEAN,
  enforcement_type TEXT,
  policy_action TEXT,
  risk_weight SMALLINT,
  matched_cip TEXT,
  matched_soc TEXT,
  matched_naics TEXT,
  match_path TEXT,
  match_confidence NUMERIC(6,3),
  verification_rank INTEGER
)
LANGUAGE sql
STABLE
AS $$
WITH input AS (
  SELECT
    trim(p_student_cip)::text AS student_cip,
    upper(trim(p_destination_state))::text AS destination_state
),

direct_cip_matches AS (
  SELECT
    v.uco_node_id,
    v.regulation_name,
    v.governing_agency,
    v.jurisdiction_level,
    v.jurisdiction_detail,
    v.state,
    v.verification_status,
    v.licensure_flag,
    v.enforcement_type,
    v.policy_action,
    v.risk_weight,
    v.cip AS matched_cip,
    v.soc AS matched_soc,
    v.naics AS matched_naics,
    'CIP_DIRECT'::text AS match_path,
    1.000::numeric(6,3) AS match_confidence,
    v.verification_rank
  FROM v_state_licensure_candidates v
  JOIN input i
    ON v.cip = i.student_cip
   AND v.state = i.destination_state
  WHERE v.licensure_flag = true
),

cip_to_naics AS (
  SELECT
    cc.target_code AS naics_code,
    cc.confidence::numeric(6,3) AS confidence
  FROM code_crosswalk cc
  JOIN input i
    ON cc.code_system = 'CIP'
   AND cc.source_code = i.student_cip
   AND cc.target_system = 'NAICS'
),

cip_to_soc AS (
  SELECT
    cc.target_code AS soc_code,
    cc.confidence::numeric(6,3) AS confidence
  FROM code_crosswalk cc
  JOIN input i
    ON cc.code_system = 'CIP'
   AND cc.source_code = i.student_cip
   AND cc.target_system = 'SOC'
),

cip_soc_to_naics AS (
  SELECT
    cs.soc_code,
    cc.target_code AS naics_code,
    LEAST(cs.confidence, cc.confidence::numeric(6,3)) AS confidence
  FROM cip_to_soc cs
  JOIN code_crosswalk cc
    ON cc.code_system = 'SOC'
   AND cc.source_code = cs.soc_code
   AND cc.target_system = 'NAICS'
),

naics_matches AS (
  SELECT
    v.uco_node_id,
    v.regulation_name,
    v.governing_agency,
    v.jurisdiction_level,
    v.jurisdiction_detail,
    v.state,
    v.verification_status,
    v.licensure_flag,
    v.enforcement_type,
    v.policy_action,
    v.risk_weight,
    v.cip AS matched_cip,
    v.soc AS matched_soc,
    v.naics AS matched_naics,
    'CIP_TO_NAICS'::text AS match_path,
    ctn.confidence AS match_confidence,
    v.verification_rank
  FROM v_state_licensure_candidates v
  JOIN cip_to_naics ctn
    ON v.naics = ctn.naics_code
  JOIN input i
    ON v.state = i.destination_state
  WHERE v.licensure_flag = true
),

soc_naics_matches AS (
  SELECT
    v.uco_node_id,
    v.regulation_name,
    v.governing_agency,
    v.jurisdiction_level,
    v.jurisdiction_detail,
    v.state,
    v.verification_status,
    v.licensure_flag,
    v.enforcement_type,
    v.policy_action,
    v.risk_weight,
    v.cip AS matched_cip,
    cstn.soc_code AS matched_soc,
    v.naics AS matched_naics,
    'CIP_TO_SOC_TO_NAICS'::text AS match_path,
    cstn.confidence AS match_confidence,
    v.verification_rank
  FROM v_state_licensure_candidates v
  JOIN cip_soc_to_naics cstn
    ON v.naics = cstn.naics_code
  JOIN input i
    ON v.state = i.destination_state
  WHERE v.licensure_flag = true
),

all_matches AS (
  SELECT * FROM direct_cip_matches
  UNION ALL
  SELECT * FROM naics_matches
  UNION ALL
  SELECT * FROM soc_naics_matches
),

deduped AS (
  SELECT
    i.student_cip,
    i.destination_state,
    am.*,
    ROW_NUMBER() OVER (
      PARTITION BY am.uco_node_id
      ORDER BY
        CASE am.match_path
          WHEN 'CIP_DIRECT' THEN 1
          WHEN 'CIP_TO_NAICS' THEN 2
          WHEN 'CIP_TO_SOC_TO_NAICS' THEN 3
          ELSE 9
        END,
        am.verification_rank ASC,
        am.match_confidence DESC,
        am.risk_weight DESC,
        am.uco_node_id ASC
    ) AS row_choice
  FROM all_matches am
  CROSS JOIN input i
)

SELECT
  student_cip,
  destination_state,
  uco_node_id,
  regulation_name,
  governing_agency,
  jurisdiction_level,
  jurisdiction_detail,
  state,
  verification_status,
  licensure_flag,
  enforcement_type,
  policy_action,
  risk_weight,
  matched_cip,
  matched_soc,
  matched_naics,
  match_path,
  match_confidence,
  verification_rank
FROM deduped
WHERE row_choice = 1
ORDER BY
  CASE match_path
    WHEN 'CIP_DIRECT' THEN 1
    WHEN 'CIP_TO_NAICS' THEN 2
    WHEN 'CIP_TO_SOC_TO_NAICS' THEN 3
    ELSE 9
  END,
  verification_rank ASC,
  match_confidence DESC,
  risk_weight DESC,
  uco_node_id ASC;
$$;

COMMENT ON FUNCTION fn_lookup_state_licensure_by_cip(TEXT, TEXT) IS
  'Returns state-specific licensure obligation matches for a student CIP using direct CIP, CIP->NAICS, and CIP->SOC->NAICS resolution.';

GRANT SELECT ON v_state_licensure_candidates TO ios_app;
GRANT SELECT ON v_state_licensure_candidates TO audit_reader;
GRANT SELECT ON v_state_licensure_candidates TO rag_reader;

GRANT EXECUTE ON FUNCTION fn_lookup_state_licensure_by_cip(TEXT, TEXT) TO ios_app;
GRANT EXECUTE ON FUNCTION fn_lookup_state_licensure_by_cip(TEXT, TEXT) TO audit_reader;
GRANT EXECUTE ON FUNCTION fn_lookup_state_licensure_by_cip(TEXT, TEXT) TO rag_reader;
