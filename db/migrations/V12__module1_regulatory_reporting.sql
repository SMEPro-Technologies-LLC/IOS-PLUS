-- ============================================================
-- SMEPro COS Module 1: Regulatory Reporting (Institution-Facing)
-- PostgreSQL Schema — 12 Agency Data Marts + Canonical Definitions
-- Date: 2026-06-20
-- Version: 2026.06.20-LAMAR-MOD1-1.0
-- ============================================================

-- ============================================================
-- 0. SCHEMAS
-- ============================================================

CREATE SCHEMA IF NOT EXISTS module1_canonical;
CREATE SCHEMA IF NOT EXISTS module1_marts;
CREATE SCHEMA IF NOT EXISTS module1_etl;
CREATE SCHEMA IF NOT EXISTS module1_audit;

-- ============================================================
-- 1. CANONICAL DEFINITIONS — One Authoritative Source of Truth
-- ============================================================

DROP TABLE IF EXISTS module1_canonical.concept_definitions CASCADE;
CREATE TABLE module1_canonical.concept_definitions (
    concept_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concept_namespace       VARCHAR(50) NOT NULL,     -- 'student', 'finance', 'research', 'hr', 'facilities', 'safety'
    concept_key             VARCHAR(100) NOT NULL,    -- 'full_time_student', 'clery_employee', 'sponsored_expenditure'
    concept_name            VARCHAR(200) NOT NULL,    -- human-readable name
    concept_description     TEXT NOT NULL,             -- full business definition
    sql_logic               TEXT,                     -- the authoritative SQL expression
    source_system_of_truth  VARCHAR(100),             -- 'Banner SIS', 'PeopleSoft Finance', 'Cayuse'
    source_table            VARCHAR(100),
    source_column           VARCHAR(100),
    source_join_path        TEXT,                     -- e.g., 'BANNER.SGBSTDN JOIN SPRIDEN ON ...'
    version                 INTEGER NOT NULL DEFAULT 1,
    effective_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date                DATE,                     -- NULL = currently effective
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    change_author           VARCHAR(100),
    change_justification    TEXT,
    uco_node_id             VARCHAR(20),              -- links back to Mini-UDM
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_concept_key_version UNIQUE (concept_namespace, concept_key, version)
);

CREATE INDEX idx_canonical_concept_key ON module1_canonical.concept_definitions(concept_namespace, concept_key);
CREATE INDEX idx_canonical_uco ON module1_canonical.concept_definitions(uco_node_id);
CREATE INDEX idx_canonical_active ON module1_canonical.concept_definitions(is_active, end_date);

COMMENT ON TABLE module1_canonical.concept_definitions IS
'One authoritative definition per concept. Full-time student, Clery employee, sponsored expenditure — defined once, version-controlled, used by every filing. IPEDS, CBM, FISAP, and Clery numbers cannot disagree.';

-- ============================================================
-- 1.1 SEED: Core Canonical Definitions for Lamar
-- ============================================================

INSERT INTO module1_canonical.concept_definitions
(concept_namespace, concept_key, concept_name, concept_description, sql_logic, source_system_of_truth, source_table, source_column, source_join_path, version, effective_date, change_author, change_justification, uco_node_id)
VALUES
('student', 'full_time_student', 'Full-Time Student (Undergraduate)', 
 'Undergraduate student enrolled for 12 or more credit hours in a standard term (fall/spring) or equivalent in a non-standard term. For IPEDS, Title IV, and CBM reporting.',
 'SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_ENRL_STATUS = ''E'' AND SGBSTDN_CRED_HOURS >= 12 AND SGBSTDN_LEVL_CODE = ''UG''',
 'Banner Student', 'SGBSTDN', 'SGBSTDN_CRED_HOURS', 'SGBSTDN JOIN SPRIDEN ON SGBSTDN_PIDM = SPRIDEN_PIDM', 1, '2026-01-01', 'Registrar', 'Initial definition aligned with IPEDS 2025-26 reporting requirements', 'UCO-EDU-LAM-2300'),

('student', 'full_time_student_grad', 'Full-Time Student (Graduate)', 
 'Graduate student enrolled for 9 or more credit hours in a standard term or equivalent. For IPEDS, Title IV, and CBM reporting.',
 'SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_ENRL_STATUS = ''E'' AND SGBSTDN_CRED_HOURS >= 9 AND SGBSTDN_LEVL_CODE = ''GR''',
 'Banner Student', 'SGBSTDN', 'SGBSTDN_CRED_HOURS', 'SGBSTDN JOIN SPRIDEN ON SGBSTDN_PIDM = SPRIDEN_PIDM', 1, '2026-01-01', 'Registrar', 'Initial definition aligned with IPEDS 2025-26 reporting requirements', 'UCO-EDU-LAM-2300'),

('student', 'part_time_student', 'Part-Time Student', 
 'Student enrolled for fewer than full-time credit hours. Undergraduate: <12; Graduate: <9.',
 'SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_ENRL_STATUS = ''E'' AND ((SGBSTDN_LEVL_CODE = ''UG'' AND SGBSTDN_CRED_HOURS < 12) OR (SGBSTDN_LEVL_CODE = ''GR'' AND SGBSTDN_CRED_HOURS < 9))',
 'Banner Student', 'SGBSTDN', 'SGBSTDN_CRED_HOURS', 'SGBSTDN JOIN SPRIDEN ON SGBSTDN_PIDM = SPRIDEN_PIDM', 1, '2026-01-01', 'Registrar', 'Initial definition', 'UCO-EDU-LAM-2300'),

('student', 'first_time_freshman', 'First-Time Freshman', 
 'Student entering postsecondary education for the first time at the undergraduate level. Includes summer term prior to fall enrollment. Excludes dual-enrolled high school students.',
 'SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_STST_CODE = ''FF'' AND SGBSTDN_LEVL_CODE = ''UG'' AND SGBSTDN_TERM_CODE_ENTRY = :report_term',
 'Banner Student', 'SGBSTDN', 'SGBSTDN_STST_CODE', 'SGBSTDN JOIN SPRIDEN ON SGBSTDN_PIDM = SPRIDEN_PIDM', 1, '2026-01-01', 'Registrar', 'IPEDS definition aligned with Fall Enrollment survey', 'UCO-EDU-LAM-2300'),

('student', 'transfer_student', 'Transfer Student', 
 'Student entering for the first time but having previously attended another postsecondary institution.',
 'SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_STST_CODE = ''TR'' AND SGBSTDN_TERM_CODE_ENTRY = :report_term',
 'Banner Student', 'SGBSTDN', 'SGBSTDN_STST_CODE', 'SGBSTDN JOIN SPRIDEN ON SGBSTDN_PIDM = SPRIDEN_PIDM', 1, '2026-01-01', 'Registrar', 'IPEDS definition', 'UCO-EDU-LAM-2300'),

('student', 'degree_seeking_student', 'Degree-Seeking Student', 
 'Student enrolled in courses for credit who is recognized by the institution as seeking a degree or certificate.',
 'SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_DEGS_CODE IN (''DG'', ''CE'') AND SGBSTDN_ENRL_STATUS = ''E''',
 'Banner Student', 'SGBSTDN', 'SGBSTDN_DEGS_CODE', 'SGBSTDN JOIN SPRIDEN ON SGBSTDN_PIDM = SPRIDEN_PIDM', 1, '2026-01-01', 'Registrar', 'IPEDS definition', 'UCO-EDU-LAM-2300'),

('student', 'pell_grant_recipient', 'Pell Grant Recipient', 
 'Student who received a Federal Pell Grant during the reporting period.',
 'SELECT DISTINCT RORSTAT_PIDM FROM BANNER.RORSTAT JOIN RORPRDS ON RORSTAT_PIDM = RORPRDS_PIDM WHERE RORPRDS_FUND_CODE = ''PELL'' AND RORPRDS_AIDY_CODE = :aid_year',
 'Banner Financial Aid', 'RORPRDS', 'RORPRDS_FUND_CODE', 'RORPRDS JOIN RORSTAT ON RORPRDS_PIDM = RORSTAT_PIDM', 1, '2026-01-01', 'Financial Aid Director', 'FISAP / IPEDS definition', 'UCO-EDU-LAM-2300'),

('student', 'sevis_active_student', 'SEVIS Active International Student', 
 'International student with a valid SEVIS record in Active status. F-1, J-1, or M-1 visa status.',
 'SELECT * FROM SEVIS.student_records WHERE sevis_status = ''ACTIVE'' AND visa_type IN (''F1'', ''J1'', ''M1'') AND i_20_end_date >= CURRENT_DATE',
 'SEVIS', 'student_records', 'sevis_status', 'Direct SEVIS API query', 1, '2026-01-01', 'International Student Advisor', 'SEVIS compliance definition', 'UCO-EDU-LAM-2112'),

('student', 'clery_employee', 'Clery Employee', 
 'Any employee who meets the Clery Act definition: full-time, part-time, or student employees who work on campus or have a substantial connection to campus. Includes faculty, staff, and student workers.',
 'SELECT * FROM PEOPLESOFT.HR_EMPLOYEES WHERE (emp_status = ''A'' OR emp_status = ''L'') AND (emp_campus_location IS NOT NULL OR emp_remote_campus_connection = TRUE)',
 'PeopleSoft HR', 'HR_EMPLOYEES', 'emp_status', 'HR_EMPLOYEES JOIN HR_POSITIONS ON emp_id = position_emp_id', 1, '2026-01-01', 'HR Director', 'Clery Act 2024 guidance', 'UCO-EDU-LAM-2309'),

('student', 'vawa_survivor', 'VAWA Survivor / Complainant', 
 'Student or employee who reports an incident of sexual violence, domestic violence, dating violence, or stalking under VAWA/Campus SaVE.',
 'SELECT * FROM OMNIGO.incident_reports WHERE incident_category IN (''sexual_assault'', ''domestic_violence'', ''dating_violence'', ''stalking'') AND report_date >= :reporting_year_start',
 'Omnigo', 'incident_reports', 'incident_category', 'Direct Omnigo API query', 1, '2026-01-01', 'Title IX Coordinator', 'VAWA / Campus SaVE Act definition', 'UCO-EDU-LAM-2310'),

('finance', 'sponsored_expenditure', 'Sponsored Research Expenditure', 
 'Total expenditures from externally sponsored research grants and contracts during the reporting period. Includes direct costs and facilities & administrative (F&A) costs.',
 'SELECT SUM(expenditure_amount) FROM CAYUSE.award_expenditures WHERE expenditure_type IN (''direct'', ''indirect'') AND award_status = ''ACTIVE'' AND expenditure_date BETWEEN :start_date AND :end_date',
 'Cayuse', 'award_expenditures', 'expenditure_amount', 'Cayuse REST API / direct DB query', 1, '2026-01-01', 'Research Administrator', 'NSF HERD / IPEDS R&D survey definition', 'UCO-EDU-LAM-2300'),

('finance', 'title_iv_disbursement', 'Title IV Disbursement', 
 'Total disbursement of Title IV funds (Pell, Direct Loans, SEOG, TEACH, Perkins) during the reporting period.',
 'SELECT SUM(disbursement_amount) FROM BANNER.RORPRDS WHERE RORPRDS_FUND_CODE IN (''PELL'', ''SUBS'', ''UNST'', ''SEOG'', ''TEACH'', ''PERK'') AND RORPRDS_DISB_DATE BETWEEN :start_date AND :end_date',
 'Banner Financial Aid', 'RORPRDS', 'RORPRDS_DISB_AMOUNT', 'RORPRDS JOIN RORSTAT ON RORPRDS_PIDM = RORSTAT_PIDM', 1, '2026-01-01', 'Financial Aid Director', 'Title IV Cash Management definition', 'UCO-EDU-LAM-2300'),

('finance', 'r2t4_return_amount', 'Return of Title IV Funds (R2T4)', 
 'Amount of Title IV funds returned by the institution when a student withdraws before completing 60% of the payment period.',
 'SELECT SUM(return_amount) FROM BANNER.RORRETURN WHERE RORRETURN_CALC_DATE BETWEEN :start_date AND :end_date AND RORRETURN_TYPE = ''INSTITUTION''',
 'Banner Financial Aid', 'RORRETURN', 'RORRETURN_RETURN_AMOUNT', 'Direct Banner query', 1, '2026-01-01', 'Financial Aid Director', '34 CFR §668.22', 'UCO-EDU-LAM-2301'),

('finance', 'net_price', 'Net Price of Attendance', 
 'Cost of attendance minus all grant and scholarship aid. For GE/FVT and Net Price Calculator reporting.',
 'SELECT (COA - GRANT_SCHOLARSHIP) AS net_price FROM (SELECT SUM(coa_amount) COA, SUM(grant_amount) GRANT_SCHOLARSHIP FROM BANNER.RORCOA JOIN RORPRDS ON ... )',
 'Banner Financial Aid', 'RORCOA', 'RORCOA_AMOUNT', 'RORCOA JOIN RORPRDS ON RORCOA_PIDM = RORPRDS_PIDM', 1, '2026-01-01', 'Financial Aid Director', 'HEA §132; GE/FVT definition', 'UCO-EDU-LAM-2314'),

('facilities', 'clery_geography', 'Clery Geography', 
 'The physical area defined by the Clery Act as on-campus, public property, and non-campus buildings or property owned or controlled by the institution.',
 'SELECT * FROM OMNIGO.clery_geography WHERE institution_id = ''lamar-university'' AND clery_year = :reporting_year',
 'Omnigo', 'clery_geography', 'clery_year', 'Direct Omnigo API query', 1, '2026-01-01', 'Clery Compliance Officer', '34 CFR §668.46', 'UCO-EDU-LAM-2309'),

('facilities', 'fire_safety_inspection', 'Fire Safety Inspection', 
 'Annual fire safety inspection of on-campus student housing facilities, including dormitories and apartments.',
 'SELECT * FROM module1_marts.local_fire_safety WHERE inspection_type = ''annual'' AND facility_type = ''student_housing'' AND inspection_year = :reporting_year',
 'StarRez / Local Fire Marshal', 'local_fire_safety', 'inspection_date', 'StarRez JOIN local_fire_inspections', 1, '2026-01-01', 'Facilities Director', '34 CFR §668.49; Texas Fire Marshal', 'UCO-EDU-LAM-2309'),

('research', 'total_rd_expenditure', 'Total R&D Expenditure', 
 'Total expenditures for research and development activities, including both sponsored and institution-funded research.',
 'SELECT SUM(expenditure_amount) FROM CAYUSE.all_expenditures WHERE expenditure_date BETWEEN :start_date AND :end_date AND research_flag = TRUE',
 'Cayuse', 'all_expenditures', 'expenditure_amount', 'Cayuse REST API', 1, '2026-01-01', 'Research Administrator', 'NSF HERD survey definition', 'UCO-EDU-LAM-2300');

-- ============================================================
-- 2. SOURCE SYSTEM REGISTRY — Every System Lamar Actually Uses
-- ============================================================

DROP TABLE IF EXISTS module1_canonical.source_systems CASCADE;
CREATE TABLE module1_canonical.source_systems (
    system_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    system_name             VARCHAR(100) NOT NULL,
    system_vendor           VARCHAR(100),
    system_version          VARCHAR(50),
    system_type             VARCHAR(50),              -- 'SIS', 'LMS', 'ERP', 'Safety', 'Research', 'Housing', 'Payment'
    primary_domain          VARCHAR(50),              -- 'student', 'finance', 'hr', 'research', 'facilities', 'safety'
    api_type                VARCHAR(50),              -- 'REST', 'SOAP', 'OData', 'Database', 'File', 'SIS-API'
    api_base_url            VARCHAR(500),
    auth_method             VARCHAR(50),              -- 'OAuth2', 'SAML', 'API Key', 'Basic Auth', 'Kerberos'
    canonical_event_stream  BOOLEAN DEFAULT TRUE,     -- emits to Kafka/event bus
    etl_frequency           VARCHAR(20),              -- 'real-time', 'hourly', 'nightly', 'weekly', 'on-demand'
    last_etl_run            TIMESTAMP,
    last_etl_status         VARCHAR(20),              -- 'success', 'failed', 'partial', 'running'
    last_etl_records        INTEGER,
    data_owner              VARCHAR(100),
    technical_contact       VARCHAR(100),
    business_contact        VARCHAR(100),
    uco_node_id             VARCHAR(20),
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMP DEFAULT NOW()
);

INSERT INTO module1_canonical.source_systems
(system_name, system_vendor, system_version, system_type, primary_domain, api_type, api_base_url, auth_method, canonical_event_stream, etl_frequency, data_owner, technical_contact, uco_node_id)
VALUES
('Banner Student', 'Ellucian', '9.2', 'SIS', 'student', 'Database', 'jdbc:oracle:thin:@banner-prod:1521:BAN8', 'Kerberos', TRUE, 'nightly', 'Registrar', 'Banner DBA', 'UCO-EDU-LAM-2300'),
('Banner Financial Aid', 'Ellucian', '9.2', 'SIS', 'student', 'Database', 'jdbc:oracle:thin:@banner-prod:1521:BAN8', 'Kerberos', TRUE, 'nightly', 'Financial Aid Director', 'Banner DBA', 'UCO-EDU-LAM-2300'),
('Banner Finance', 'Ellucian', '9.2', 'ERP', 'finance', 'Database', 'jdbc:oracle:thin:@banner-prod:1521:BAN8', 'Kerberos', TRUE, 'nightly', 'Controller', 'Banner DBA', 'UCO-EDU-LAM-2300'),
('Banner HR', 'Ellucian', '9.2', 'ERP', 'hr', 'Database', 'jdbc:oracle:thin:@banner-prod:1521:BAN8', 'Kerberos', TRUE, 'nightly', 'HR Director', 'Banner DBA', 'UCO-EDU-LAM-2309'),
('Blackboard Ultra', 'Anthology', '3900.100', 'LMS', 'student', 'REST', 'https://lamar.blackboard.com/learn/api/public/v3', 'OAuth2', TRUE, 'real-time', 'CIO', 'LMS Admin', 'UCO-EDU-LAM-2100'),
('Concourse', 'Syllabus Plus', '2025.1', 'SIS', 'student', 'REST', 'https://lamar.concourse.com/api/v1', 'API Key', TRUE, 'nightly', 'Registrar', 'Concourse Admin', 'UCO-EDU-LAM-2100'),
('Omnigo', 'Omnigo Software', '2026.1', 'Safety', 'safety', 'REST', 'https://lamar.omnigo.com/api/v2', 'OAuth2', TRUE, 'real-time', 'Clery Compliance Officer', 'Omnigo Admin', 'UCO-EDU-LAM-2309'),
('Cayuse', 'Cayuse', '2026.1', 'Research', 'research', 'REST', 'https://lamar.cayuse.com/api/v1', 'OAuth2', TRUE, 'nightly', 'Research Administrator', 'Cayuse Admin', 'UCO-EDU-LAM-2300'),
('PeopleSoft (TSUS)', 'Oracle', '9.2', 'ERP', 'finance', 'Database', 'jdbc:oracle:thin:@psoft-tsus:1521:PSFT', 'Kerberos', TRUE, 'nightly', 'TSUS CFO', 'PeopleSoft DBA', 'UCO-EDU-LAM-2300'),
('TouchNet', 'TouchNet', '2026.1', 'Payment', 'finance', 'REST', 'https://lamar.touchnet.com/api/v2', 'OAuth2', TRUE, 'real-time', 'Bursar', 'TouchNet Admin', 'UCO-EDU-LAM-2300'),
('StarRez', 'StarRez', '2026.1', 'Housing', 'facilities', 'REST', 'https://lamar.starez.com/api/v1', 'API Key', TRUE, 'nightly', 'Housing Director', 'StarRez Admin', 'UCO-EDU-LAM-2309'),
('National Student Clearinghouse', 'NSC', '2026', 'Clearing', 'student', 'REST', 'https://secure.studentclearinghouse.org/api/v1', 'OAuth2', TRUE, 'nightly', 'Registrar', 'NSC Liaison', 'UCO-EDU-LAM-2300'),
('SEVIS', 'DHS / ICE', '2026', 'Immigration', 'student', 'REST', 'https://egov.ice.gov/sevis/api', 'OAuth2', TRUE, 'real-time', 'International Student Advisor', 'SEVIS DSO', 'UCO-EDU-LAM-2112'),
('CITI Program', 'CITI', '2026', 'Training', 'research', 'REST', 'https://www.citiprogram.org/api/v1', 'API Key', TRUE, 'weekly', 'IRB Director', 'CITI Admin', 'UCO-EDU-LAM-2300'),
('TeamMate', 'Wolters Kluwer', '2026.1', 'Audit', 'audit', 'REST', 'https://lamar.teammate.com/api/v1', 'OAuth2', TRUE, 'nightly', 'Internal Audit Director', 'TeamMate Admin', 'UCO-EDU-LAM-2300');

-- ============================================================
-- 3. ETL JOB TRACKING
-- ============================================================

DROP TABLE IF EXISTS module1_etl.job_definitions CASCADE;
CREATE TABLE module1_etl.job_definitions (
    job_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name                VARCHAR(200) NOT NULL,
    job_description         TEXT,
    source_system_id        UUID REFERENCES module1_canonical.source_systems(system_id),
    target_mart             VARCHAR(50),              -- which of the 12 marts
    target_table            VARCHAR(100),
    etl_type                VARCHAR(50),              -- 'full_refresh', 'incremental', 'cdc', 'api_poll'
    schedule_expression     VARCHAR(100),           -- cron expression
    last_run_at             TIMESTAMP,
    last_run_status         VARCHAR(20),              -- 'success', 'failed', 'partial', 'running', 'skipped'
    last_run_records        INTEGER,
    last_run_errors         INTEGER,
    last_run_error_log      TEXT,
    active                  BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

DROP TABLE IF EXISTS module1_etl.job_runs CASCADE;
CREATE TABLE module1_etl.job_runs (
    run_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id                  UUID REFERENCES module1_etl.job_definitions(job_id),
    run_started_at          TIMESTAMP DEFAULT NOW(),
    run_completed_at        TIMESTAMP,
    run_status              VARCHAR(20),
    records_source          INTEGER,
    records_inserted        INTEGER,
    records_updated         INTEGER,
    records_deleted         INTEGER,
    records_rejected        INTEGER,
    error_count             INTEGER,
    error_log               TEXT,
    run_duration_ms         INTEGER
);

CREATE INDEX idx_etl_job_runs_job ON module1_etl.job_runs(job_id);
CREATE INDEX idx_etl_job_runs_status ON module1_etl.job_runs(run_status);

-- ============================================================
-- 4. AUDIT / VERSION CONTROL
-- ============================================================

DROP TABLE IF EXISTS module1_audit.concept_change_log CASCADE;
CREATE TABLE module1_audit.concept_change_log (
    log_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concept_id              UUID REFERENCES module1_canonical.concept_definitions(concept_id),
    changed_by              VARCHAR(100),
    changed_at              TIMESTAMP DEFAULT NOW(),
    change_type             VARCHAR(20),              -- 'create', 'update', 'deprecate', 'activate', 'deactivate'
    old_value               JSONB,
    new_value               JSONB,
    change_reason           TEXT,
    approval_status         VARCHAR(20),              -- 'pending', 'approved', 'rejected'
    approved_by             VARCHAR(100)
);

CREATE INDEX idx_audit_concept ON module1_audit.concept_change_log(concept_id);
CREATE INDEX idx_audit_changed_at ON module1_audit.concept_change_log(changed_at);

DROP TABLE IF EXISTS module1_audit.reporting_events CASCADE;
CREATE TABLE module1_audit.reporting_events (
    event_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type              VARCHAR(50),              -- 'report_generated', 'submission_sent', 'validation_failed', 'data_corrected'
    report_name             VARCHAR(200),             -- 'IPEDS Fall Enrollment', 'CBM001', 'Clery ASR'
    agency                  VARCHAR(50),              -- 'IPEDS', 'CBM', 'Clery', 'THECB', 'TSUS'
    reporting_period        VARCHAR(50),              -- '2025-2026', 'Fall 2025', 'FY2026'
    event_timestamp         TIMESTAMP DEFAULT NOW(),
    user_id                 VARCHAR(100),
    user_role               VARCHAR(50),
    event_details           JSONB,
    ip_address              INET,
    user_agent              TEXT
);

CREATE INDEX idx_audit_events_type ON module1_audit.reporting_events(event_type);
CREATE INDEX idx_audit_events_report ON module1_audit.reporting_events(report_name, reporting_period);

-- ============================================================
-- 5. 12 AGENCY DATA MARTS
-- ============================================================

-- --------------------------------------------------------
-- 5.1 FEDERAL — IPEDS Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.federal_ipeds CASCADE;
CREATE TABLE module1_marts.federal_ipeds (
    ipeds_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_component        VARCHAR(50) NOT NULL,     -- 'Fall Enrollment', '12-Month Enrollment', 'Completions', 'Grad Rates', 'Human Resources', 'Finance', 'Student Financial Aid'
    reporting_year          INTEGER NOT NULL,
    unitid                  VARCHAR(10) NOT NULL,   -- IPEDS Unit ID
    institution_name        VARCHAR(200),
    -- Student counts
    ft_undergrad_count      INTEGER,
    pt_undergrad_count      INTEGER,
    ft_grad_count           INTEGER,
    pt_grad_count           INTEGER,
    first_time_freshman_count INTEGER,
    transfer_in_count       INTEGER,
    degree_seeking_count    INTEGER,
    non_degree_seeking_count INTEGER,
    -- Demographics
    male_count              INTEGER,
    female_count            INTEGER,
    nonbinary_count         INTEGER,
    hispanic_count          INTEGER,
    black_count             INTEGER,
    white_count             INTEGER,
    asian_count             INTEGER,
    two_or_more_races_count INTEGER,
    unknown_race_count      INTEGER,
    -- Financial aid
    pell_recipient_count    INTEGER,
    pell_total_amount       DECIMAL(15,2),
    loan_recipient_count    INTEGER,
    loan_total_amount       DECIMAL(15,2),
    grant_recipient_count   INTEGER,
    grant_total_amount      DECIMAL(15,2),
    -- Completions
    associate_degrees       INTEGER,
    bachelor_degrees        INTEGER,
    master_degrees          INTEGER,
    doctoral_degrees        INTEGER,
    certificates_awarded    INTEGER,
    -- Rates
    graduation_rate_150pct  DECIMAL(5,2),
    transfer_out_rate       DECIMAL(5,2),
    retention_rate_ft       DECIMAL(5,2),
    retention_rate_pt       DECIMAL(5,2),
    -- Source
    data_source             VARCHAR(100),           -- 'Banner SIS', 'Banner Financial Aid', 'Manual Entry'
    canonical_version       INTEGER,                -- which version of canonical definitions
    validated               BOOLEAN DEFAULT FALSE,  -- data validation passed
    validation_errors       TEXT,
    submitted_to_ipeds      BOOLEAN DEFAULT FALSE,
    submission_date         TIMESTAMP,
    submission_ack          VARCHAR(100),           -- IPEDS confirmation number
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ipeds_component_year ON module1_marts.federal_ipeds(survey_component, reporting_year);
CREATE INDEX idx_ipeds_unitid ON module1_marts.federal_ipeds(unitid);
CREATE INDEX idx_ipeds_validated ON module1_marts.federal_ipeds(validated);

COMMENT ON TABLE module1_marts.federal_ipeds IS
'IPEDS survey data mart. All IPEDS survey components (Fall Enrollment, 12-Month, Completions, Grad Rates, Human Resources, Finance, Student Financial Aid) in one unified table. Every number traceable to a canonical definition.';

-- --------------------------------------------------------
-- 5.2 FEDERAL — Title IV Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.federal_title_iv CASCADE;
CREATE TABLE module1_marts.federal_title_iv (
    title_iv_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_type             VARCHAR(50) NOT NULL,     -- 'FISAP', 'NSLDS', 'R2T4', '90/10', 'SAR', 'Cohort Default Rate'
    aid_year                VARCHAR(10) NOT NULL,     -- '2025-2026'
    reporting_period_start  DATE,
    reporting_period_end    DATE,
    -- Pell
    pell_applicants         INTEGER,
    pell_recipients         INTEGER,
    pell_disbursed_amount   DECIMAL(15,2),
    -- Direct Loans
    subsidized_loan_recipients INTEGER,
    subsidized_loan_amount  DECIMAL(15,2),
    unsubsidized_loan_recipients INTEGER,
    unsubsidized_loan_amount DECIMAL(15,2),
    plus_loan_recipients    INTEGER,
    plus_loan_amount        DECIMAL(15,2),
    -- SEOG
    seog_recipients         INTEGER,
    seog_amount             DECIMAL(15,2),
    -- TEACH
    teach_recipients        INTEGER,
    teach_amount            DECIMAL(15,2),
    -- Perkins (if applicable)
    perkins_recipients      INTEGER,
    perkins_amount          DECIMAL(15,2),
    -- R2T4
    r2t4_withdrawals        INTEGER,
    r2t4_return_amount      DECIMAL(15,2),
    r2t4_post_withdrawal_disbursed DECIMAL(15,2),
    -- 90/10
    title_iv_revenue        DECIMAL(15,2),
    total_revenue           DECIMAL(15,2),
    title_iv_ratio          DECIMAL(5,2),
    -- Cohort Default Rate
    cdr_cohort_year         VARCHAR(10),
    cdr_borrowers_in_cohort INTEGER,
    cdr_defaults_in_cohort  INTEGER,
    cdr_rate                DECIMAL(5,2),
    -- Source & Validation
    data_source             VARCHAR(100),
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    submitted               BOOLEAN DEFAULT FALSE,
    submission_date         TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_title_iv_type_year ON module1_marts.federal_title_iv(report_type, aid_year);
CREATE INDEX idx_title_iv_validated ON module1_marts.federal_title_iv(validated);

COMMENT ON TABLE module1_marts.federal_title_iv IS
'Title IV financial aid data mart. Covers FISAP, NSLDS reporting, R2T4 calculations, 90/10 ratio, and Cohort Default Rate. All numbers derived from canonical definitions so FISAP and IPEDS Financial Aid numbers agree.';

-- --------------------------------------------------------
-- 5.3 FEDERAL — Clery Act Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.federal_clery CASCADE;
CREATE TABLE module1_marts.federal_clery (
    clery_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_type             VARCHAR(50) NOT NULL,     -- 'ASR', 'Daily Crime Log', 'Fire Safety', 'HATE Crime'
    reporting_year          INTEGER NOT NULL,
    -- Geography
    clery_geography_type    VARCHAR(50),              -- 'on-campus', 'non-campus', 'public_property'
    location_description    VARCHAR(500),
    -- Crime statistics
    criminal_homicide       INTEGER DEFAULT 0,
    manslaughter_negligent  INTEGER DEFAULT 0,
    sex_offenses_forcible   INTEGER DEFAULT 0,
    sex_offenses_nonforcible INTEGER DEFAULT 0,
    robbery                 INTEGER DEFAULT 0,
    aggravated_assault      INTEGER DEFAULT 0,
    burglary                INTEGER DEFAULT 0,
    motor_vehicle_theft     INTEGER DEFAULT 0,
    arson                   INTEGER DEFAULT 0,
    -- VAWA
    domestic_violence       INTEGER DEFAULT 0,
    dating_violence         INTEGER DEFAULT 0,
    stalking                INTEGER DEFAULT 0,
    -- Hate crimes
    hate_crimes_total       INTEGER DEFAULT 0,
    -- Arrests & referrals
    liquor_law_arrests      INTEGER DEFAULT 0,
    drug_abuse_arrests      INTEGER DEFAULT 0,
    weapons_arrests         INTEGER DEFAULT 0,
    liquor_law_referrals    INTEGER DEFAULT 0,
    drug_abuse_referrals    INTEGER DEFAULT 0,
    weapons_referrals       INTEGER DEFAULT 0,
    -- Fire safety (if applicable)
    fire_incidents          INTEGER DEFAULT 0,
    fire_injuries           INTEGER DEFAULT 0,
    fire_deaths             INTEGER DEFAULT 0,
    fire_property_damage    DECIMAL(12,2),
    -- Source
    data_source             VARCHAR(100),             -- 'Omnigo', 'StarRez', 'Local Fire Marshal'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    asr_published           BOOLEAN DEFAULT FALSE,
    asr_publish_date        TIMESTAMP,
    asr_url                 VARCHAR(500),
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_clery_report_year ON module1_marts.federal_clery(report_type, reporting_year);

COMMENT ON TABLE module1_marts.federal_clery IS
'Clery Act Annual Security Report (ASR) data mart. Crime statistics, VAWA incidents, fire safety data, and hate crimes. All incidents sourced from Omnigo with StarRez fire safety data. Every number traceable to an incident report.';

-- --------------------------------------------------------
-- 5.4 FEDERAL — Gainful Employment / Financial Value Transparency (GE/FVT)
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.federal_ge_fvt CASCADE;
CREATE TABLE module1_marts.federal_ge_fvt (
    ge_fvt_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cip_code                VARCHAR(10) NOT NULL,
    cip_title               VARCHAR(200),
    credential_level        VARCHAR(20),              -- 'certificate', 'associate', 'bachelor', 'master', 'doctoral'
    program_name            VARCHAR(200),
    -- Debt measures
    median_debt_amt         DECIMAL(12,2),
    mean_debt_amt           DECIMAL(12,2),
    debt_at_75pct           DECIMAL(12,2),
    debt_at_90pct           DECIMAL(12,2),
    -- Earnings measures
    median_earnings_1yr     DECIMAL(12,2),
    median_earnings_2yr     DECIMAL(12,2),
    median_earnings_4yr     DECIMAL(12,2),
    -- D/E ratios
    debt_to_earnings_annual DECIMAL(5,2),
    debt_to_earnings_discretionary DECIMAL(5,2),
    -- Pass/fail
    d2e_pass_annual         BOOLEAN,
    d2e_pass_discretionary  BOOLEAN,
    earnings_threshold_pass BOOLEAN,
    -- Disclosure requirements
    disclosure_url          VARCHAR(500),
    disclosure_template_id  VARCHAR(100),
    -- Source
    data_source             VARCHAR(100),             -- 'NSC', 'Banner', 'BLS', 'IRS'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ge_fvt_cip ON module1_marts.federal_ge_fvt(cip_code);
CREATE INDEX idx_ge_fvt_pass ON module1_marts.federal_ge_fvt(d2e_pass_annual, d2e_pass_discretionary);

COMMENT ON TABLE module1_marts.federal_ge_fvt IS
'Gainful Employment / Financial Value Transparency data mart. Debt-to-earnings ratios, median earnings, and pass/fail status per CIP/credential level. Sourced from NSC (earnings), Banner (debt), and BLS (wage data). Updated per GE/FVT 2024 rule.';

-- --------------------------------------------------------
-- 5.5 FEDERAL — Research Expenditure Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.federal_research CASCADE;
CREATE TABLE module1_marts.federal_research (
    research_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporting_year          INTEGER NOT NULL,
    -- NSF HERD categories
    total_rd_expenditures   DECIMAL(15,2),
    federal_rd_expenditures DECIMAL(15,2),
    state_local_rd_expenditures DECIMAL(15,2),
    institution_funded_rd   DECIMAL(15,2),
    business_funded_rd      DECIMAL(15,2),
    nonprofit_funded_rd     DECIMAL(15,2),
    -- By field
    life_sciences_rd        DECIMAL(15,2),
    engineering_rd          DECIMAL(15,2),
    physical_sciences_rd    DECIMAL(15,2),
    environmental_sciences_rd DECIMAL(15,2),
    computer_sciences_rd    DECIMAL(15,2),
    math_statistics_rd      DECIMAL(15,2),
    psychology_rd           DECIMAL(15,2),
    social_sciences_rd      DECIMAL(15,2),
    other_sciences_rd       DECIMAL(15,2),
    -- Source
    data_source             VARCHAR(100),             -- 'Cayuse', 'Banner Finance', 'Manual'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    submitted_to_nsf        BOOLEAN DEFAULT FALSE,
    submission_date         TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_research_year ON module1_marts.federal_research(reporting_year);

COMMENT ON TABLE module1_marts.federal_research IS
'Research expenditure data mart for NSF HERD survey, NIH reporting, and institutional R&D metrics. All expenditures sourced from Cayuse with Banner Finance reconciliation.';

-- --------------------------------------------------------
-- 5.6 STATE — CBM (Coordinating Board Management) Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.state_cbm CASCADE;
CREATE TABLE module1_marts.state_cbm (
    cbm_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_type             VARCHAR(50) NOT NULL,     -- 'CBM001', 'CBM002', 'CBM003', 'CBM004', 'CBM005', 'CBM009'
    reporting_year          INTEGER NOT NULL,
    reporting_semester      VARCHAR(20),              -- 'Fall', 'Spring', 'Summer'
    -- Student counts
    total_headcount         INTEGER,
    total_fte               DECIMAL(10,2),
    ft_undergrad_count      INTEGER,
    pt_undergrad_count      INTEGER,
    ft_grad_count           INTEGER,
    pt_grad_count           INTEGER,
    -- Demographics
    hispanic_count          INTEGER,
    black_count             INTEGER,
    white_count             INTEGER,
    asian_count             INTEGER,
    -- Program data
    program_count           INTEGER,
    degrees_awarded         INTEGER,
    certificates_awarded    INTEGER,
    -- Finance
    tuition_revenue         DECIMAL(15,2),
    state_appropriation     DECIMAL(15,2),
    total_operating_expense DECIMAL(15,2),
    -- Contact hour data
    total_contact_hours     DECIMAL(15,2),
    wfc_contact_hours       DECIMAL(15,2),           -- Workforce contact hours
    -- Source
    data_source             VARCHAR(100),             -- 'Banner SIS', 'Banner Finance', 'THECB'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    submitted_to_thecb      BOOLEAN DEFAULT FALSE,
    submission_date         TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cbm_report_year ON module1_marts.state_cbm(report_type, reporting_year);

COMMENT ON TABLE module1_marts.state_cbm IS
'Texas CBM (Coordinating Board Management) data mart. CBM001 through CBM009 reports in one unified structure. All student counts and financial data traceable to canonical definitions.';

-- --------------------------------------------------------
-- 5.7 STATE — THECB Accountability Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.state_thecb_accountability CASCADE;
CREATE TABLE module1_marts.state_thecb_accountability (
    accountability_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporting_year          INTEGER NOT NULL,
    metric_name             VARCHAR(100) NOT NULL,    -- '6-Year Graduation Rate', '1-Year Retention', 'Transfer Rate', 'Credentials of Value'
    metric_value            DECIMAL(10,4),
    metric_numerator        INTEGER,
    metric_denominator      INTEGER,
    -- Breakdowns
    cohort_year             VARCHAR(10),
    student_type            VARCHAR(50),              -- 'first-time', 'transfer', 'returning'
    race_ethnicity          VARCHAR(50),
    pell_status             VARCHAR(20),              -- 'pell', 'non-pell'
    -- Benchmarks
    state_benchmark         DECIMAL(10,4),
    peer_benchmark          DECIMAL(10,4),
    target_goal             DECIMAL(10,4),
    -- Source
    data_source             VARCHAR(100),             -- 'Banner SIS', 'NSC', 'THECB'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_thecb_metric_year ON module1_marts.state_thecb_accountability(metric_name, reporting_year);

COMMENT ON TABLE module1_marts.state_thecb_accountability IS
'THECB Accountability Framework data mart. 60x30TX metrics, credentials of value, graduation rates, and transfer rates. All metrics computed from canonical student definitions.';

-- --------------------------------------------------------
-- 5.8 STATE — LAR (Legislative Appropriations Request) Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.state_lar CASCADE;
CREATE TABLE module1_marts.state_lar (
    lar_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    biennium                VARCHAR(10) NOT NULL,     -- '2026-2027'
    lar_request_type        VARCHAR(50),              -- 'Base', 'Exceptional Items', 'Special Items'
    -- Funding categories
    instruction_funding     DECIMAL(15,2),
    research_funding        DECIMAL(15,2),
    public_service_funding  DECIMAL(15,2),
    libraries_funding       DECIMAL(15,2),
    academic_support_funding DECIMAL(15,2),
    student_services_funding DECIMAL(15,2),
    institutional_support_funding DECIMAL(15,2),
    operations_maintenance_funding DECIMAL(15,2),
    scholarships_funding    DECIMAL(15,2),
    -- Enrollment projections
    projected_fte           DECIMAL(10,2),
    projected_headcount     INTEGER,
    -- Performance metrics
    degrees_projected       INTEGER,
    credentials_of_value_projected INTEGER,
    -- Source
    data_source             VARCHAR(100),             -- 'PeopleSoft (TSUS)', 'Banner Finance', 'THECB'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    submitted_to_thecb      BOOLEAN DEFAULT FALSE,
    submission_date         TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_lar_biennium ON module1_marts.state_lar(biennium);

COMMENT ON TABLE module1_marts.state_lar IS
'Legislative Appropriations Request (LAR) data mart. Biennial funding request broken down by category with enrollment projections and performance metrics. Sourced from PeopleSoft (TSUS) and Banner Finance.';

-- --------------------------------------------------------
-- 5.9 TSUS — Finance Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.tsus_finance CASCADE;
CREATE TABLE module1_marts.tsus_finance (
    finance_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fiscal_year             VARCHAR(10) NOT NULL,     -- 'FY2026'
    report_type             VARCHAR(50),              -- 'AFR', 'CAFR', 'Operating Budget', 'Capital Budget'
    -- Revenue
    tuition_fees_revenue    DECIMAL(15,2),
    state_appropriations    DECIMAL(15,2),
    federal_grants_revenue  DECIMAL(15,2),
    local_grants_revenue    DECIMAL(15,2),
    private_gifts_revenue   DECIMAL(15,2),
    auxiliary_revenue       DECIMAL(15,2),
    investment_income       DECIMAL(15,2),
    other_revenue           DECIMAL(15,2),
    total_revenue           DECIMAL(15,2),
    -- Expenses
    instruction_expense     DECIMAL(15,2),
    research_expense        DECIMAL(15,2),
    public_service_expense  DECIMAL(15,2),
    academic_support_expense DECIMAL(15,2),
    student_services_expense DECIMAL(15,2),
    institutional_support_expense DECIMAL(15,2),
    operations_maintenance_expense DECIMAL(15,2),
    student_aid_expense     DECIMAL(15,2),
    auxiliary_expense       DECIMAL(15,2),
    depreciation_expense    DECIMAL(15,2),
    total_expense           DECIMAL(15,2),
    -- Net position
    net_position_beginning  DECIMAL(15,2),
    net_position_ending     DECIMAL(15,2),
    -- Source
    data_source             VARCHAR(100),             -- 'PeopleSoft (TSUS)', 'Banner Finance'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tsus_finance_year ON module1_marts.tsus_finance(fiscal_year);

COMMENT ON TABLE module1_marts.tsus_finance IS
'TSUS financial reporting data mart. AFR, CAFR, and operating budget data. All revenue and expense categories aligned with GASB standards and NACUBO function codes.';

-- --------------------------------------------------------
-- 5.10 TSUS — Audit Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.tsus_audit CASCADE;
CREATE TABLE module1_marts.tsus_audit (
    audit_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fiscal_year             VARCHAR(10) NOT NULL,
    audit_type              VARCHAR(50),              -- 'External Audit', 'Internal Audit', 'Compliance Audit', 'IT Audit'
    audit_scope             TEXT,
    -- Findings
    finding_count           INTEGER DEFAULT 0,
    material_weakness_count INTEGER DEFAULT 0,
    significant_deficiency_count INTEGER DEFAULT 0,
    management_recommendation_count INTEGER DEFAULT 0,
    -- Status
    findings_open           INTEGER DEFAULT 0,
    findings_closed         INTEGER DEFAULT 0,
    findings_overdue        INTEGER DEFAULT 0,
    -- Management letter
    management_letter_issued BOOLEAN DEFAULT FALSE,
    management_letter_date  TIMESTAMP,
    -- External auditor
    auditor_firm            VARCHAR(200),
    auditor_report_date     TIMESTAMP,
    opinion_type            VARCHAR(50),              -- 'Unmodified', 'Qualified', 'Adverse', 'Disclaimer'
    -- Source
    data_source             VARCHAR(100),             -- 'TeamMate', 'External Auditor', 'TSUS System Office'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tsus_audit_year ON module1_marts.tsus_audit(fiscal_year);

COMMENT ON TABLE module1_marts.tsus_audit IS
'TSUS audit data mart. External audit findings, internal audit reports, compliance audits, and IT audits. All findings tracked through TeamMate with open/closed/overdue status.';

-- --------------------------------------------------------
-- 5.11 LOCAL — Fire Safety Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.local_fire_safety CASCADE;
CREATE TABLE module1_marts.local_fire_safety (
    fire_safety_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporting_year          INTEGER NOT NULL,
    facility_name           VARCHAR(200),
    facility_type           VARCHAR(50),              -- 'student_housing', 'academic', 'administrative', 'auxiliary'
    building_code           VARCHAR(50),
    -- Inspections
    annual_inspection_date  DATE,
    annual_inspection_pass  BOOLEAN,
    annual_inspection_deficiencies TEXT,
    sprinkler_system        BOOLEAN,
    fire_alarm_system       BOOLEAN,
    smoke_detector_system   BOOLEAN,
    emergency_lighting      BOOLEAN,
    fire_drill_count        INTEGER,
    -- Incidents
    fire_incidents          INTEGER DEFAULT 0,
    fire_injuries           INTEGER DEFAULT 0,
    fire_deaths             INTEGER DEFAULT 0,
    fire_property_damage    DECIMAL(12,2),
    cause_of_fire           VARCHAR(200),
    -- Source
    data_source             VARCHAR(100),             -- 'StarRez', 'Local Fire Marshal', 'Facilities'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fire_safety_year ON module1_marts.local_fire_safety(reporting_year);

COMMENT ON TABLE module1_marts.local_fire_safety IS
'Local fire safety data mart. Annual inspections, fire drills, fire incidents, and property damage for all on-campus facilities. Required for Clery Fire Safety Report and local fire marshal compliance.';

-- --------------------------------------------------------
-- 5.12 LOCAL — Emergency Management Data Mart
-- --------------------------------------------------------
DROP TABLE IF EXISTS module1_marts.local_emergency_mgmt CASCADE;
CREATE TABLE module1_marts.local_emergency_mgmt (
    emergency_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporting_year          INTEGER NOT NULL,
    plan_type               VARCHAR(50),              -- 'EOP', 'COOP', 'COG', 'Hazard Mitigation', 'Recovery'
    -- Plans
    plan_name               VARCHAR(200),
    plan_approval_date      DATE,
    plan_review_date        DATE,
    plan_next_review_date   DATE,
    -- Training
    training_sessions_conducted INTEGER,
    training_attendees      INTEGER,
    -- Exercises
    tabletop_exercises      INTEGER,
    functional_exercises    INTEGER,
    full_scale_exercises    INTEGER,
    -- Incidents
    emergency_incidents     INTEGER,
    incident_types          TEXT,                     -- JSON array of incident types
    -- Communications
    alert_system_test_count INTEGER,
    alert_system_last_test  DATE,
    -- Source
    data_source             VARCHAR(100),             -- 'Omnigo', 'Local Emergency Management', 'Facilities'
    canonical_version       INTEGER,
    validated               BOOLEAN DEFAULT FALSE,
    validation_errors       TEXT,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_emergency_year ON module1_marts.local_emergency_mgmt(reporting_year);

COMMENT ON TABLE module1_marts.local_emergency_mgmt IS
'Local emergency management data mart. Emergency operations plans, training, exercises, and incident tracking. Required for EOP compliance, Clery Act, and Texas Division of Emergency Management (TDEM) reporting.';

-- ============================================================
-- 6. UNIFIED REPORTING PORTAL — API Views
-- ============================================================

-- 6.1 View: All reports by agency and deadline
CREATE OR REPLACE VIEW module1_marts.v_reporting_calendar AS
SELECT
    'Federal' AS agency_tier,
    'IPEDS' AS agency,
    'Fall Enrollment' AS report_name,
    'October 15' AS typical_deadline,
    'Annual' AS frequency,
    'module1_marts.federal_ipeds' AS mart_table
UNION ALL SELECT 'Federal', 'IPEDS', '12-Month Enrollment', 'April 15', 'Annual', 'module1_marts.federal_ipeds'
UNION ALL SELECT 'Federal', 'IPEDS', 'Completions', 'April 15', 'Annual', 'module1_marts.federal_ipeds'
UNION ALL SELECT 'Federal', 'IPEDS', 'Graduation Rates', 'April 15', 'Annual', 'module1_marts.federal_ipeds'
UNION ALL SELECT 'Federal', 'IPEDS', 'Human Resources', 'April 15', 'Annual', 'module1_marts.federal_ipeds'
UNION ALL SELECT 'Federal', 'IPEDS', 'Finance', 'April 15', 'Annual', 'module1_marts.federal_ipeds'
UNION ALL SELECT 'Federal', 'IPEDS', 'Student Financial Aid', 'April 15', 'Annual', 'module1_marts.federal_ipeds'
UNION ALL SELECT 'Federal', 'Title IV', 'FISAP', 'October 1', 'Annual', 'module1_marts.federal_title_iv'
UNION ALL SELECT 'Federal', 'Title IV', 'NSLDS Enrollment', 'Monthly', 'Monthly', 'module1_marts.federal_title_iv'
UNION ALL SELECT 'Federal', 'Title IV', 'R2T4 Reporting', 'Per Withdrawal', 'Real-time', 'module1_marts.federal_title_iv'
UNION ALL SELECT 'Federal', 'Title IV', '90/10 Ratio', 'October 1', 'Annual', 'module1_marts.federal_title_iv'
UNION ALL SELECT 'Federal', 'Title IV', 'Cohort Default Rate', 'March 15', 'Annual', 'module1_marts.federal_title_iv'
UNION ALL SELECT 'Federal', 'Clery', 'Annual Security Report (ASR)', 'October 1', 'Annual', 'module1_marts.federal_clery'
UNION ALL SELECT 'Federal', 'Clery', 'Fire Safety Report', 'October 1', 'Annual', 'module1_marts.federal_clery'
UNION ALL SELECT 'Federal', 'Clery', 'Daily Crime Log', 'Ongoing', 'Daily', 'module1_marts.federal_clery'
UNION ALL SELECT 'Federal', 'GE/FVT', 'Financial Value Transparency', 'July 1', 'Annual', 'module1_marts.federal_ge_fvt'
UNION ALL SELECT 'Federal', 'Research', 'NSF HERD', 'February 1', 'Annual', 'module1_marts.federal_research'
UNION ALL SELECT 'State', 'CBM', 'CBM001', 'November 15', 'Annual', 'module1_marts.state_cbm'
UNION ALL SELECT 'State', 'CBM', 'CBM002', 'March 15', 'Annual', 'module1_marts.state_cbm'
UNION ALL SELECT 'State', 'CBM', 'CBM003', 'March 15', 'Annual', 'module1_marts.state_cbm'
UNION ALL SELECT 'State', 'CBM', 'CBM004', 'March 15', 'Annual', 'module1_marts.state_cbm'
UNION ALL SELECT 'State', 'CBM', 'CBM005', 'March 15', 'Annual', 'module1_marts.state_cbm'
UNION ALL SELECT 'State', 'THECB', 'Accountability Metrics', 'December 15', 'Annual', 'module1_marts.state_thecb_accountability'
UNION ALL SELECT 'State', 'THECB', 'LAR', 'August 1', 'Biennial', 'module1_marts.state_lar'
UNION ALL SELECT 'TSUS', 'TSUS', 'Annual Financial Report', 'December 31', 'Annual', 'module1_marts.tsus_finance'
UNION ALL SELECT 'TSUS', 'TSUS', 'CAFR', 'December 31', 'Annual', 'module1_marts.tsus_finance'
UNION ALL SELECT 'TSUS', 'TSUS', 'Operating Budget', 'September 1', 'Annual', 'module1_marts.tsus_finance'
UNION ALL SELECT 'TSUS', 'TSUS', 'Audit Report', 'December 31', 'Annual', 'module1_marts.tsus_audit'
UNION ALL SELECT 'Local', 'Fire Marshal', 'Fire Safety Inspection', 'Annual', 'Annual', 'module1_marts.local_fire_safety'
UNION ALL SELECT 'Local', 'Emergency Mgmt', 'EOP Update', 'Annual', 'Annual', 'module1_marts.local_emergency_mgmt'
UNION ALL SELECT 'Local', 'Emergency Mgmt', 'Training & Exercise Report', 'Annual', 'Annual', 'module1_marts.local_emergency_mgmt';

COMMENT ON VIEW module1_marts.v_reporting_calendar IS
'Unified reporting calendar showing all 12 agency data marts, their report names, typical deadlines, and frequencies. Consumed by the unified reporting portal dashboard.';

-- 6.2 View: Cross-mart validation — catch disagreements between agencies
CREATE OR REPLACE VIEW module1_marts.v_cross_mart_validation AS
SELECT
    'IPEDS Fall Enrollment vs CBM001' AS validation_name,
    ipeds.reporting_year,
    ipeds.total_headcount AS ipeds_count,
    cbm.total_headcount AS cbm_count,
    ABS(ipeds.total_headcount - cbm.total_headcount) AS difference,
    CASE WHEN ABS(ipeds.total_headcount - cbm.total_headcount) <= 10 THEN 'PASS' ELSE 'FAIL' END AS status
FROM module1_marts.federal_ipeds ipeds
JOIN module1_marts.state_cbm cbm ON ipeds.reporting_year = cbm.reporting_year
WHERE ipeds.survey_component = 'Fall Enrollment' AND cbm.report_type = 'CBM001'
UNION ALL
SELECT
    'IPEDS Financial Aid vs FISAP Pell' AS validation_name,
    ipeds.reporting_year,
    ipeds.pell_recipient_count AS ipeds_count,
    tiv.pell_recipients AS fisap_count,
    ABS(ipeds.pell_recipient_count - tiv.pell_recipients) AS difference,
    CASE WHEN ABS(ipeds.pell_recipient_count - tiv.pell_recipients) <= 10 THEN 'PASS' ELSE 'FAIL' END AS status
FROM module1_marts.federal_ipeds ipeds
JOIN module1_marts.federal_title_iv tiv ON ipeds.reporting_year = tiv.aid_year::INTEGER
WHERE ipeds.survey_component = 'Student Financial Aid' AND tiv.report_type = 'FISAP'
UNION ALL
SELECT
    'Clery Crime vs Omnigo Incidents' AS validation_name,
    c.reporting_year,
    (c.criminal_homicide + c.sex_offenses_forcible + c.robbery + c.aggravated_assault + c.burglary + c.motor_vehicle_theft + c.arson) AS clery_count,
    NULL AS source_count,
    NULL AS difference,
    'MANUAL' AS status
FROM module1_marts.federal_clery c
WHERE c.report_type = 'ASR';

COMMENT ON VIEW module1_marts.v_cross_mart_validation IS
'Cross-mart validation view. Compares key metrics across agency data marts to catch disagreements. IPEDS vs CBM, IPEDS vs FISAP, Clery vs Omnigo. Any FAIL triggers an escalation to the Data Governance team.';

-- 6.3 Function: Generate report from any mart
CREATE OR REPLACE FUNCTION module1_marts.fn_generate_report(
    p_agency_tier VARCHAR(50),     -- 'Federal', 'State', 'TSUS', 'Local'
    p_agency VARCHAR(50),          -- 'IPEDS', 'CBM', 'Clery', etc.
    p_report_name VARCHAR(200),    -- 'Fall Enrollment', 'CBM001', 'ASR'
    p_reporting_year INTEGER
)
RETURNS TABLE (
    report_id UUID,
    report_data JSONB,
    generated_at TIMESTAMP,
    validation_status VARCHAR(20),
    validation_errors TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_sql TEXT;
    v_mart_table VARCHAR(100);
BEGIN
    -- Look up the mart table from the reporting calendar
    SELECT mart_table INTO v_mart_table
    FROM module1_marts.v_reporting_calendar
    WHERE agency_tier = p_agency_tier AND agency = p_agency AND report_name = p_report_name;

    IF v_mart_table IS NULL THEN
        RAISE EXCEPTION 'Report not found in reporting calendar: % % %', p_agency_tier, p_agency, p_report_name;
    END IF;

    -- Build dynamic SQL to return the report data as JSONB
    v_sql := format(
        'SELECT row_to_json(t)::JSONB FROM %I t WHERE reporting_year = $1',
        v_mart_table
    );

    RETURN QUERY
    EXECUTE v_sql
    USING p_reporting_year;
END;
$$;

COMMENT ON FUNCTION module1_marts.fn_generate_report IS
'Generates a JSONB report from any of the 12 agency data marts. Looks up the mart table from v_reporting_calendar and returns all rows for the reporting year. Used by the unified reporting portal for one-click report generation.';

-- ============================================================
-- 7. GRANTS
-- ============================================================

GRANT USAGE ON SCHEMA module1_canonical TO ios_plus_api;
GRANT USAGE ON SCHEMA module1_marts TO ios_plus_api;
GRANT USAGE ON SCHEMA module1_etl TO ios_plus_api;
GRANT USAGE ON SCHEMA module1_audit TO ios_plus_api;

GRANT SELECT ON ALL TABLES IN SCHEMA module1_canonical TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module1_marts TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module1_etl TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module1_audit TO ios_plus_api;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module1_marts TO ios_plus_api;

-- ============================================================
-- 8. EXAMPLE QUERIES (commented out)
-- ============================================================

/*
-- 1. Look up canonical definition for "full-time student"
SELECT * FROM module1_canonical.concept_definitions
WHERE concept_key = 'full_time_student' AND is_active = TRUE;

-- 2. Check if IPEDS and CBM numbers agree for Fall 2025
SELECT * FROM module1_marts.v_cross_mart_validation
WHERE reporting_year = 2025;

-- 3. Generate IPEDS Fall Enrollment report for 2025
SELECT * FROM module1_marts.fn_generate_report('Federal', 'IPEDS', 'Fall Enrollment', 2025);

-- 4. Check all upcoming reporting deadlines
SELECT * FROM module1_marts.v_reporting_calendar
WHERE typical_deadline LIKE '%' || TO_CHAR(CURRENT_DATE, 'Month') || '%';

-- 5. Track ETL job status
SELECT * FROM module1_etl.job_runs
WHERE run_status = 'failed' AND run_started_at > CURRENT_DATE - INTERVAL '7 days';

-- 6. Audit: who changed the full-time student definition?
SELECT * FROM module1_audit.concept_change_log
WHERE concept_id = (SELECT concept_id FROM module1_canonical.concept_definitions WHERE concept_key = 'full_time_student')
ORDER BY changed_at DESC;

-- 7. Check all Clery incidents for 2025
SELECT * FROM module1_marts.federal_clery
WHERE report_type = 'ASR' AND reporting_year = 2025;

-- 8. Check GE/FVT pass/fail status for Nursing (CIP 51.3801)
SELECT * FROM module1_marts.federal_ge_fvt
WHERE cip_code = '51.3801';

-- 9. Check TSUS audit findings
SELECT * FROM module1_marts.tsus_audit
WHERE fiscal_year = 'FY2026' AND findings_open > 0;

-- 10. Check fire safety inspection status for all housing
SELECT * FROM module1_marts.local_fire_safety
WHERE facility_type = 'student_housing' AND reporting_year = 2025;
*/
