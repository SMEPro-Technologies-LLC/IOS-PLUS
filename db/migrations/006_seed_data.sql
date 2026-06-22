-- IOS+ Platform — Seed Data
-- PostgreSQL 16+
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Compliance Rules
-- ------------------------------------------------------------
INSERT INTO compliance_rules (id, name, dimension, condition, effect, priority, sector, active)
VALUES
    (uuid_generate_v4(), 'HIPAA Privacy Rule', 'regulatory', '{"regulation": "HIPAA", "type": "privacy"}', 'deny', 10, 'healthcare', TRUE),
    (uuid_generate_v4(), 'PCI-DSS Data Encryption', 'security', '{"standard": "PCI-DSS", "requirement": "encryption_at_rest"}', 'deny', 20, 'finance', TRUE),
    (uuid_generate_v4(), 'GDPR Right to Deletion', 'privacy', '{"regulation": "GDPR", "article": "17"}', 'require_approval', 30, 'all', TRUE),
    (uuid_generate_v4(), 'SOX Financial Controls', 'regulatory', '{"act": "SOX", "section": "404"}', 'require_approval', 15, 'finance', TRUE),
    (uuid_generate_v4(), 'FERPA Student Privacy', 'privacy', '{"regulation": "FERPA"}', 'deny', 25, 'education', TRUE),
    (uuid_generate_v4(), 'Operational Backup Policy', 'operational', '{"requirement": "daily_backup", "rpo": "24h"}', 'allow', 100, 'all', TRUE),
    (uuid_generate_v4(), 'AI Ethics Review', 'ethical', '{"technology": "AI", "review_required": true}', 'require_approval', 50, 'all', TRUE),
    (uuid_generate_v4(), 'Energy Sector CIP', 'sector_specific', '{"standard": "NERC-CIP", "version": "6"}', 'deny', 5, 'energy', TRUE),
    (uuid_generate_v4(), 'Government Data Classification', 'security', '{"classification": "CONFIDENTIAL", "clearance_required": true}', 'deny', 10, 'government', TRUE),
    (uuid_generate_v4(), 'Healthcare Access Logging', 'operational', '{"sector": "healthcare", "log_access": true}', 'allow', 90, 'healthcare', TRUE)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- UCO Nodes: CIP (Healthcare Education)
-- ------------------------------------------------------------
INSERT INTO uco_nodes (id, type, code, title, description, parent_id, metadata)
VALUES
    (uuid_generate_v4(), 'CIP', '51.3801', 'Registered Nursing/Registered Nurse', 'Programs preparing individuals to practice as registered nurses in various settings.', NULL, '{"level": "detailed", "family": "51.38"}'),
    (uuid_generate_v4(), 'CIP', '51.3802', 'Nursing Administration', 'Programs focusing on nursing leadership and healthcare administration.', NULL, '{"level": "detailed", "family": "51.38"}'),
    (uuid_generate_v4(), 'CIP', '51.3803', 'Adult Health Nursing', 'Programs focusing on care for adult and geriatric patients.', NULL, '{"level": "detailed", "family": "51.38"}'),
    (uuid_generate_v4(), 'CIP', '51.3804', 'Pediatric Nursing', 'Programs focusing on nursing care for infants, children, and adolescents.', NULL, '{"level": "detailed", "family": "51.38"}'),
    (uuid_generate_v4(), 'CIP', '51.3805', 'Psychiatric/Mental Health Nursing', 'Programs focusing on mental health and psychiatric nursing.', NULL, '{"level": "detailed", "family": "51.38"}')
ON CONFLICT (type, code) DO NOTHING;

-- ------------------------------------------------------------
-- UCO Nodes: NAICS (Healthcare Industry)
-- ------------------------------------------------------------
INSERT INTO uco_nodes (id, type, code, title, description, parent_id, metadata)
VALUES
    (uuid_generate_v4(), 'NAICS', '621111', 'Offices of Physicians', 'Establishments of health practitioners having the degree of M.D. or D.O.', NULL, '{"level": "6-digit", "sector": "healthcare"}'),
    (uuid_generate_v4(), 'NAICS', '621330', 'Offices of Mental Health Practitioners', 'Establishments of independent mental health practitioners.', NULL, '{"level": "6-digit", "sector": "healthcare"}'),
    (uuid_generate_v4(), 'NAICS', '621410', 'Family Planning Centers', 'Establishments providing family planning services.', NULL, '{"level": "6-digit", "sector": "healthcare"}'),
    (uuid_generate_v4(), 'NAICS', '621420', 'Outpatient Mental Health Centers', 'Establishments providing outpatient mental health counseling.', NULL, '{"level": "6-digit", "sector": "healthcare"}'),
    (uuid_generate_v4(), 'NAICS', '621511', 'Medical Laboratories', 'Establishments providing analytic or diagnostic services.', NULL, '{"level": "6-digit", "sector": "healthcare"}')
ON CONFLICT (type, code) DO NOTHING;

-- ------------------------------------------------------------
-- UCO Nodes: SOC (Healthcare Occupations)
-- ------------------------------------------------------------
INSERT INTO uco_nodes (id, type, code, title, description, parent_id, metadata)
VALUES
    (uuid_generate_v4(), 'SOC', '29-1141', 'Registered Nurses', 'Assess patient health problems and needs; develop and implement nursing care plans.', NULL, '{"level": "detailed", "group": "29-1140"}'),
    (uuid_generate_v4(), 'SOC', '29-1171', 'Nurse Practitioners', 'Diagnose and treat acute, episodic, or chronic illness.', NULL, '{"level": "detailed", "group": "29-1170"}'),
    (uuid_generate_v4(), 'SOC', '29-1181', 'Audiologists', 'Assess and treat persons with hearing and related disorders.', NULL, '{"level": "detailed", "group": "29-1180"}'),
    (uuid_generate_v4(), 'SOC', '29-1199', 'Health Diagnosing and Treating Practitioners', 'All other health diagnosing and treating practitioners.', NULL, '{"level": "detailed", "group": "29-1190"}'),
    (uuid_generate_v4(), 'SOC', '29-2052', 'Pharmacy Technicians', 'Prepare medications under the direction of a pharmacist.', NULL, '{"level": "detailed", "group": "29-2050"}')
ON CONFLICT (type, code) DO NOTHING;

-- ------------------------------------------------------------
-- UCO Crosswalks: CIP -> NAICS
-- ------------------------------------------------------------
INSERT INTO uco_crosswalk (id, source_type, source_code, target_type, target_code, match_type, confidence)
VALUES
    (uuid_generate_v4(), 'CIP', '51.3801', 'NAICS', '621111', 'exact', 0.95),
    (uuid_generate_v4(), 'CIP', '51.3801', 'NAICS', '621330', 'exact', 0.90),
    (uuid_generate_v4(), 'CIP', '51.3801', 'NAICS', '621511', 'fuzzy', 0.75),
    (uuid_generate_v4(), 'CIP', '51.3805', 'NAICS', '621330', 'exact', 0.92),
    (uuid_generate_v4(), 'CIP', '51.3805', 'NAICS', '621420', 'exact', 0.88)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- UCO Crosswalks: CIP -> SOC
-- ------------------------------------------------------------
INSERT INTO uco_crosswalk (id, source_type, source_code, target_type, target_code, match_type, confidence)
VALUES
    (uuid_generate_v4(), 'CIP', '51.3801', 'SOC', '29-1141', 'exact', 0.98),
    (uuid_generate_v4(), 'CIP', '51.3801', 'SOC', '29-1171', 'fuzzy', 0.85),
    (uuid_generate_v4(), 'CIP', '51.3805', 'SOC', '29-1141', 'fuzzy', 0.80),
    (uuid_generate_v4(), 'CIP', '51.3805', 'SOC', '29-1199', 'derived', 0.70)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- UCO Crosswalks: SOC -> NAICS
-- ------------------------------------------------------------
INSERT INTO uco_crosswalk (id, source_type, source_code, target_type, target_code, match_type, confidence)
VALUES
    (uuid_generate_v4(), 'SOC', '29-1141', 'NAICS', '621111', 'exact', 0.95),
    (uuid_generate_v4(), 'SOC', '29-1141', 'NAICS', '621330', 'fuzzy', 0.82),
    (uuid_generate_v4(), 'SOC', '29-1171', 'NAICS', '621111', 'exact', 0.93),
    (uuid_generate_v4(), 'SOC', '29-1171', 'NAICS', '621410', 'fuzzy', 0.78),
    (uuid_generate_v4(), 'SOC', '29-2052', 'NAICS', '621511', 'exact', 0.90)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- Obligation Metadata: State Licensure Requirements
-- ------------------------------------------------------------
INSERT INTO uco_obligation_metadata (id, state, naics_code, soc_code, enforcement_type, title, authority, effective_date, metadata)
VALUES
    -- California
    (uuid_generate_v4(), 'CA', '621111', '29-1141', 'license', 'California RN License', 'California Board of Registered Nursing', '2020-01-01', '{"renewal_period": "2 years", "continuing_education_hours": 30}'),
    (uuid_generate_v4(), 'CA', '621330', '29-1171', 'license', 'California NP License', 'California Board of Registered Nursing', '2020-01-01', '{"renewal_period": "2 years", "collaborative_agreement": true}'),
    (uuid_generate_v4(), 'CA', '621511', '29-2052', 'certification', 'California Pharmacy Technician Certification', 'California State Board of Pharmacy', '2021-01-01', '{"renewal_period": "2 years", "exam_required": true}'),

    -- Texas
    (uuid_generate_v4(), 'TX', '621111', '29-1141', 'license', 'Texas RN License', 'Texas Board of Nursing', '2019-01-01', '{"renewal_period": "2 years", "jurisprudence_exam": true}'),
    (uuid_generate_v4(), 'TX', '621330', '29-1171', 'license', 'Texas NP License', 'Texas Board of Nursing', '2019-01-01', '{"renewal_period": "2 years", "prescriptive_authority": true}'),
    (uuid_generate_v4(), 'TX', '621511', '29-2052', 'registration', 'Texas Pharmacy Technician Registration', 'Texas State Board of Pharmacy', '2020-01-01', '{"renewal_period": "1 year", "background_check": true}'),

    -- Florida
    (uuid_generate_v4(), 'FL', '621111', '29-1141', 'license', 'Florida RN License', 'Florida Board of Nursing', '2018-01-01', '{"renewal_period": "2 years", "continuing_education_hours": 24}'),
    (uuid_generate_v4(), 'FL', '621330', '29-1171', 'license', 'Florida NP License', 'Florida Board of Nursing', '2018-01-01', '{"renewal_period": "2 years", "controlled_substance": true}'),
    (uuid_generate_v4(), 'FL', '621511', '29-2052', 'certification', 'Florida Pharmacy Technician Registration', 'Florida Board of Pharmacy', '2022-01-01', '{"renewal_period": "2 years", "exam_required": true}')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- Sample Audit Events for Testing
-- ------------------------------------------------------------
INSERT INTO audit_events (id, table_name, operation, record_id, old_data, new_data, actor_id, actor_type, session_id, ip_address, user_agent, timestamp)
VALUES
    (uuid_generate_v4(), 'compliance_rules', 'INSERT', uuid_generate_v4(), NULL, '{"name": "HIPAA Privacy Rule"}', uuid_generate_v4(), 'system', 'test-session-001', '192.168.1.1'::INET, 'IOS-Platform/1.0', NOW() - INTERVAL '1 day'),
    (uuid_generate_v4(), 'compliance_rules', 'UPDATE', uuid_generate_v4(), '{"active": true}', '{"active": false}', uuid_generate_v4(), 'admin', 'test-session-002', '192.168.1.2'::INET, 'Mozilla/5.0 Admin', NOW() - INTERVAL '2 hours'),
    (uuid_generate_v4(), 'audit_events', 'ACCESS_DENIED', uuid_generate_v4(), NULL, '{"reason": "unauthorized_access"}', uuid_generate_v4(), 'anonymous', 'test-session-003', '10.0.0.1'::INET, 'Unknown/0.0', NOW() - INTERVAL '30 minutes'),
    (uuid_generate_v4(), 'evidence_records', 'INSERT', uuid_generate_v4(), NULL, '{"decision": "allow", "rule": "PCI-DSS"}', uuid_generate_v4(), 'policy_engine', 'test-session-004', '127.0.0.1'::INET, 'PolicyEngine/2.1', NOW() - INTERVAL '5 minutes')
ON CONFLICT DO NOTHING;

COMMIT;
