-- ============================================================
-- SMEPro COS Module 2: Objectives (Student-Facing)
-- PostgreSQL Schema — Operational Intelligence Engine
-- UC-01 Predictive Persistence through UC-08 Continuous Compliance
-- Date: 2026-06-20
-- Version: 2026.06.20-LAMAR-MOD2-1.0
-- ============================================================

CREATE SCHEMA IF NOT EXISTS module2_analytics;
CREATE SCHEMA IF NOT EXISTS module2_advisor;
CREATE SCHEMA IF NOT EXISTS module2_registrar;
CREATE SCHEMA IF NOT EXISTS module2_accreditation;
CREATE SCHEMA IF NOT EXISTS module2_faculty;
CREATE SCHEMA IF NOT EXISTS module2_enrollment;
CREATE SCHEMA IF NOT EXISTS module2_compliance_monitor;

-- ============================================================
-- UC-01: PREDICTIVE PERSISTENCE
-- Weekly 0–100 activity composite; Green/Yellow/Red tiers
-- ============================================================

DROP TABLE IF EXISTS module2_analytics.student_activity_signals CASCADE;
CREATE TABLE module2_analytics.student_activity_signals (
    signal_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_syn_id          VARCHAR(20) NOT NULL,       -- synthetic ID (no PII)
    banner_pidm             VARCHAR(20),               -- internal join key (hashed)
    reporting_week          DATE NOT NULL,              -- Sunday of reporting week
    -- Banner signals
    banner_login_count      INTEGER DEFAULT 0,
    banner_page_views       INTEGER DEFAULT 0,
    banner_transactions     INTEGER DEFAULT 0,
    -- Blackboard Ultra signals
    bb_login_count          INTEGER DEFAULT 0,
    bb_time_in_course_min   INTEGER DEFAULT 0,
    bb_content_views        INTEGER DEFAULT 0,
    bb_assignment_submissions INTEGER DEFAULT 0,
    bb_discussion_posts     INTEGER DEFAULT 0,
    bb_gradebook_views      INTEGER DEFAULT 0,
    -- Concourse signals
    concourse_syllabus_views INTEGER DEFAULT 0,
    concourse_assignment_views INTEGER DEFAULT 0,
    -- TouchNet signals
    touchnet_payment_activity INTEGER DEFAULT 0,       -- 1=made payment, 0=none
    -- StarRez signals
    starrez_housing_status   VARCHAR(20),               -- 'active', 'checkin_pending', 'checked_out'
    -- Composite score
    composite_score         INTEGER,                    -- 0–100 calculated
    risk_tier               VARCHAR(10),                -- 'GREEN', 'YELLOW', 'RED'
    tier_change             VARCHAR(10),               -- 'new', 'improved', 'worsened', 'stable'
    -- Top 3 factors (stored as JSON)
    top_factors             JSONB,                     -- [{"factor":"bb_login_count","weight":0.35,"z_score":-2.1},...]
    -- Metadata
    calculated_at           TIMESTAMP DEFAULT NOW(),
    model_version           VARCHAR(20) DEFAULT 'v1.0',
    data_sources            VARCHAR(200)               -- 'Banner,Blackboard,Concourse,TouchNet,StarRez'
);

CREATE INDEX idx_persistence_student_week ON module2_analytics.student_activity_signals(student_syn_id, reporting_week);
CREATE INDEX idx_persistence_tier ON module2_analytics.student_activity_signals(risk_tier, reporting_week);
CREATE INDEX idx_persistence_composite ON module2_analytics.student_activity_signals(composite_score);

COMMENT ON TABLE module2_analytics.student_activity_signals IS
'UC-01: Weekly 0–100 activity composite on Banner + Blackboard + Concourse + TouchNet + StarRez signals. Green/Yellow/Red tiers with top-3 factors per student. Model version tracked for reproducibility.';

-- Advisor digest view: all RED-tier students this week, ranked by composite score
CREATE OR REPLACE VIEW module2_advisor.v_red_tier_digest AS
SELECT
    sas.student_syn_id,
    sas.reporting_week,
    sas.composite_score,
    sas.risk_tier,
    sas.tier_change,
    sas.top_factors,
    sas.data_sources,
    -- Lookup student program from canonical data (via SYN ID)
    (SELECT cip_code FROM module1_marts.federal_ipeds WHERE ft_undergrad_count > 0 LIMIT 1) AS cip_code, -- placeholder join
    -- Advisor assignment (from Banner/HR)
    (SELECT advisor_id FROM module2_advisor.student_advisor_assignment WHERE student_syn_id = sas.student_syn_id) AS assigned_advisor_id
FROM module2_analytics.student_activity_signals sas
WHERE sas.risk_tier = 'RED'
  AND sas.reporting_week = (SELECT MAX(reporting_week) FROM module2_analytics.student_activity_signals)
ORDER BY sas.composite_score ASC;

COMMENT ON VIEW module2_advisor.v_red_tier_digest IS
'UC-01: Weekly digest of all RED-tier students, ranked by composite score (lowest first). Consumed by advisor dashboard and CoPilot for proactive outreach.';

-- Advisor assignment table
DROP TABLE IF EXISTS module2_advisor.student_advisor_assignment CASCADE;
CREATE TABLE module2_advisor.student_advisor_assignment (
    assignment_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_syn_id          VARCHAR(20) NOT NULL,
    advisor_id              VARCHAR(20) NOT NULL,
    advisor_name            VARCHAR(100),
    advisor_email           VARCHAR(100),
    assignment_type         VARCHAR(20),               -- 'primary', 'secondary', 'program_specific'
    assigned_at             TIMESTAMP DEFAULT NOW(),
    effective_until         DATE,
    is_active               BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_advisor_assignment_student ON module2_advisor.student_advisor_assignment(student_syn_id);
CREATE INDEX idx_advisor_assignment_advisor ON module2_advisor.student_advisor_assignment(advisor_id);

-- Advisor action log (interventions, outreach, notes)
DROP TABLE IF EXISTS module2_advisor.advisor_action_log CASCADE;
CREATE TABLE module2_advisor.advisor_action_log (
    action_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_syn_id          VARCHAR(20) NOT NULL,
    advisor_id              VARCHAR(20) NOT NULL,
    action_type             VARCHAR(50),               -- 'email', 'phone_call', 'meeting', 'referral', 'alert_raised'
    action_timestamp        TIMESTAMP DEFAULT NOW(),
    action_notes            TEXT,
    follow_up_required      BOOLEAN DEFAULT FALSE,
    follow_up_date          DATE,
    outcome                 VARCHAR(50),               -- 'student_responsive', 'no_response', 'referred', 'escalated'
    uco_node_id             VARCHAR(20)
);

CREATE INDEX idx_advisor_action_student ON module2_advisor.advisor_action_log(student_syn_id);

-- ============================================================
-- UC-02: TRANSCRIPT CROSSWALK
-- Confidence-scored equivalency engine; registrar one-click actions
-- ============================================================

DROP TABLE IF EXISTS module2_registrar.transcript_crosswalk_queue CASCADE;
CREATE TABLE module2_registrar.transcript_crosswalk_queue (
    queue_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_syn_id          VARCHAR(20) NOT NULL,
    source_institution      VARCHAR(200),              -- e.g., 'San Jacinto College'
    source_institution_code VARCHAR(20),               -- e.g., 'SJC' or IPEDS unitid
    transfer_term           VARCHAR(20),               -- e.g., 'Fall 2025'
    -- Source course
    source_course_code      VARCHAR(20),               -- e.g., 'BIOL 1406'
    source_course_title     VARCHAR(200),
    source_credit_hours     DECIMAL(4,2),
    source_grade            VARCHAR(5),                -- e.g., 'A', 'B+', 'CR'
    -- Proposed Lamar equivalency
    proposed_lamar_cip      VARCHAR(10),
    proposed_lamar_course   VARCHAR(20),               -- e.g., 'BIOL 1306'
    proposed_lamar_title    VARCHAR(200),
    proposed_credit_hours   DECIMAL(4,2),
    -- Confidence score
    confidence_score        DECIMAL(5,2),              -- 0.00–1.00
    confidence_factors      JSONB,                     -- [{"factor":"title_similarity","score":0.92},...]
    -- NLP match details
    nlp_match_method        VARCHAR(50),               -- 'cosine_similarity', 'BERT_embedding', 'exact_match'
    nlp_similarity_score    DECIMAL(5,4),
    -- Registrar action
    registrar_action        VARCHAR(20),               -- 'PENDING', 'APPROVED', 'MODIFIED', 'REJECTED'
    registrar_id            VARCHAR(20),
    registrar_notes         TEXT,
    action_timestamp        TIMESTAMP,
    -- Banner Ethos write-back status
    ethos_writeback_status  VARCHAR(20),               -- 'pending', 'success', 'failed', 'not_needed'
    ethos_writeback_log     TEXT,
    -- Metadata
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_crosswalk_queue_student ON module2_registrar.transcript_crosswalk_queue(student_syn_id);
CREATE INDEX idx_crosswalk_queue_confidence ON module2_registrar.transcript_crosswalk_queue(confidence_score);
CREATE INDEX idx_crosswalk_queue_action ON module2_registrar.transcript_crosswalk_queue(registrar_action);
CREATE INDEX idx_crosswalk_queue_pending ON module2_registrar.transcript_crosswalk_queue(registrar_action) WHERE registrar_action = 'PENDING';

COMMENT ON TABLE module2_registrar.transcript_crosswalk_queue IS
'UC-02: Confidence-scored equivalency engine for transfer credit evaluation. NLP match against Lamar course catalog; registrar one-click Approve/Modify/Reject; Banner Ethos write-back tracked. Targets 47-day transcript turnaround.';

-- Equivalency rule library (canonical rules for common transfers)
DROP TABLE IF EXISTS module2_registrar.equivalency_rules CASCADE;
CREATE TABLE module2_registrar.equivalency_rules (
    rule_id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_institution_code VARCHAR(20) NOT NULL,
    source_course_code      VARCHAR(20) NOT NULL,
    source_course_title     VARCHAR(200),
    lamar_course_code       VARCHAR(20) NOT NULL,
    lamar_course_title      VARCHAR(200),
    lamar_cip               VARCHAR(10),
    credit_hours_map        DECIMAL(4,2),              -- source → lamar (may differ)
    grade_minimum           VARCHAR(5),                -- e.g., 'C' — minimum grade for transfer
    confidence_baseline     DECIMAL(5,2),              -- baseline confidence when rule matches
    rule_type               VARCHAR(20),               -- 'articulation', 'common_course_number', 'faculty_reviewed'
    effective_date          DATE DEFAULT CURRENT_DATE,
    expiration_date         DATE,
    is_active               BOOLEAN DEFAULT TRUE,
    reviewed_by             VARCHAR(100),
    review_date             DATE,
    CONSTRAINT uq_equivalency_rule UNIQUE (source_institution_code, source_course_code, lamar_course_code, effective_date)
);

CREATE INDEX idx_equivalency_source ON module2_registrar.equivalency_rules(source_institution_code, source_course_code);

-- ============================================================
-- UC-03: ACCREDITATION GAP ANALYSIS
-- NLP match against SACSCOC / AACSB / ABET standards
-- ============================================================

DROP TABLE IF EXISTS module2_accreditation.standards_library CASCADE;
CREATE TABLE module2_accreditation.standards_library (
    standard_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    accrediting_body        VARCHAR(20) NOT NULL,      -- 'SACSCOC', 'AACSB', 'ABET', 'ACEN', 'CCNE'
    standard_code           VARCHAR(20) NOT NULL,       -- e.g., 'SACSCOC-CR-2.7', 'AACSB-Std-9'
    standard_title          VARCHAR(200),
    standard_description    TEXT,
    standard_criteria       TEXT,                      -- full text of the standard
    standard_version        VARCHAR(20),                 -- e.g., 'SACSCOC 2023 Principles'
    effective_date          DATE,
    is_active               BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_standards_body ON module2_accreditation.standards_library(accrediting_body);
CREATE INDEX idx_standards_code ON module2_accreditation.standards_library(standard_code);

-- Evidence inventory (what Lamar has for each standard)
DROP TABLE IF EXISTS module2_accreditation.evidence_inventory CASCADE;
CREATE TABLE module2_accreditation.evidence_inventory (
    evidence_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    standard_id             UUID REFERENCES module2_accreditation.standards_library(standard_id),
    evidence_title          VARCHAR(200),
    evidence_description    TEXT,
    evidence_type           VARCHAR(50),               -- 'policy', 'report', 'minutes', 'assessment', 'survey', 'data_file'
    evidence_location       VARCHAR(500),              -- URL or file path
    evidence_owner          VARCHAR(100),              -- department / office
    evidence_date           DATE,                      -- date of the evidence document
    nlp_match_score         DECIMAL(5,4),              -- how well this evidence matches the standard text
    nlp_match_method        VARCHAR(50),               -- 'tfidf', 'BERT', 'OpenAI_embedding'
    -- Gap verdict
    gap_verdict             VARCHAR(20),               -- 'MET', 'PARTIALLY_MET', 'NOT_MET', 'EVIDENCE_MISSING'
    gap_rationale           TEXT,                      -- assist-only narrative
    -- Metadata
    reviewed_by             VARCHAR(100),
    review_date             DATE,
    next_review_date        DATE,
    created_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_evidence_standard ON module2_accreditation.evidence_inventory(standard_id);
CREATE INDEX idx_evidence_verdict ON module2_accreditation.evidence_inventory(gap_verdict);

-- Accreditation gap heat map view
CREATE OR REPLACE VIEW module2_accreditation.v_gap_heat_map AS
SELECT
    sl.accrediting_body,
    sl.standard_code,
    sl.standard_title,
    COUNT(ei.evidence_id) FILTER (WHERE ei.gap_verdict = 'MET') AS met_count,
    COUNT(ei.evidence_id) FILTER (WHERE ei.gap_verdict = 'PARTIALLY_MET') AS partial_count,
    COUNT(ei.evidence_id) FILTER (WHERE ei.gap_verdict = 'NOT_MET') AS not_met_count,
    COUNT(ei.evidence_id) FILTER (WHERE ei.gap_verdict = 'EVIDENCE_MISSING') AS missing_count,
    CASE
        WHEN COUNT(ei.evidence_id) FILTER (WHERE ei.gap_verdict = 'NOT_MET') > 0 THEN 'RED'
        WHEN COUNT(ei.evidence_id) FILTER (WHERE ei.gap_verdict = 'EVIDENCE_MISSING') > 0 THEN 'ORANGE'
        WHEN COUNT(ei.evidence_id) FILTER (WHERE ei.gap_verdict = 'PARTIALLY_MET') > 0 THEN 'YELLOW'
        ELSE 'GREEN'
    END AS heat_map_color
FROM module2_accreditation.standards_library sl
LEFT JOIN module2_accreditation.evidence_inventory ei ON sl.standard_id = ei.standard_id
WHERE sl.is_active = TRUE
GROUP BY sl.accrediting_body, sl.standard_code, sl.standard_title
ORDER BY sl.accrediting_body, sl.standard_code;

COMMENT ON VIEW module2_accreditation.v_gap_heat_map IS
'UC-03: Evidence heat map showing MET / PARTIALLY_MET / NOT_MET / EVIDENCE_MISSING counts per accreditation standard. Heat map color: RED=Not Met, ORANGE=Missing Evidence, YELLOW=Partially Met, GREEN=Met. Consumed by accreditation dashboard and CoPilot.';

-- ============================================================
-- UC-04: OUTCOME ALIGNMENT AUDITOR
-- Three-way CLO ↔ Syllabus ↔ Blackboard check
-- ============================================================

DROP TABLE IF EXISTS module2_accreditation.course_learning_outcomes CASCADE;
CREATE TABLE module2_accreditation.course_learning_outcomes (
    clo_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_code             VARCHAR(20) NOT NULL,      -- e.g., 'ACCT 2301'
    course_title            VARCHAR(200),
    clo_number              INTEGER,                     -- CLO-1, CLO-2, etc.
    clo_statement           TEXT,                        -- "Students will be able to..."
    program_code            VARCHAR(20),                 -- link to program (CIP prefix)
    bloom_taxonomy_level    VARCHAR(20),                 -- 'Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'
    assessment_method       VARCHAR(200),                -- how this CLO is assessed
    weight_in_final_grade   DECIMAL(5,2),                -- % of final grade
    effective_term          VARCHAR(20),
    is_active               BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_clo_course ON module2_accreditation.course_learning_outcomes(course_code);
CREATE INDEX idx_clo_program ON module2_accreditation.course_learning_outcomes(program_code);

-- Syllabus content (extracted from Concourse/Brightspace)
DROP TABLE IF EXISTS module2_accreditation.syllabus_content CASCADE;
CREATE TABLE module2_accreditation.syllabus_content (
    syllabus_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_code             VARCHAR(20) NOT NULL,
    term_code               VARCHAR(20) NOT NULL,
    instructor_id           VARCHAR(20),
    syllabus_text           TEXT,                        -- full syllabus text (for NLP)
    extracted_clo_text      TEXT,                        -- CLO section extracted by NLP
    extracted_assessment_text TEXT,                      -- Assessment section extracted
    extracted_grade_weights TEXT,                        -- Grade breakdown extracted
    concourse_url           VARCHAR(500),
    extracted_at            TIMESTAMP DEFAULT NOW(),
    extraction_confidence   DECIMAL(5,4)
);

CREATE INDEX idx_syllabus_course_term ON module2_accreditation.syllabus_content(course_code, term_code);

-- Blackboard gradebook alignment (extracted via Ultra APIs)
DROP TABLE IF EXISTS module2_accreditation.bb_gradebook_alignment CASCADE;
CREATE TABLE module2_accreditation.bb_gradebook_alignment (
    alignment_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_code             VARCHAR(20) NOT NULL,
    term_code               VARCHAR(20) NOT NULL,
    clo_id                  UUID REFERENCES module2_accreditation.course_learning_outcomes(clo_id),
    bb_column_name          VARCHAR(200),              -- Gradebook column name
    bb_column_type          VARCHAR(50),               -- 'assignment', 'test', 'discussion', 'manual'
    bb_points_possible      DECIMAL(8,2),
    bb_weight_in_total      DECIMAL(5,2),              -- % of final grade in BB
    syllabus_weight_expected  DECIMAL(5,2),              -- % from syllabus
    -- Alignment flags
    clo_mapped              BOOLEAN,                     -- is this gradebook column mapped to a CLO?
    assessment_type_match     BOOLEAN,                     -- does BB column type match syllabus assessment method?
    weight_match            BOOLEAN,                     -- does BB weight match syllabus weight within ±2%?
    -- Verdict
    alignment_flag          VARCHAR(50),               -- 'OK', 'MISSING_CLO', 'GHOST_ASSESSMENT', 'WEIGHT_MISMATCH'
    flag_description          TEXT,
    reviewed_by             VARCHAR(100),
    reviewed_at             TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bb_align_course ON module2_accreditation.bb_gradebook_alignment(course_code, term_code);
CREATE INDEX idx_bb_align_flag ON module2_accreditation.bb_gradebook_alignment(alignment_flag);

-- Three-way alignment check view
CREATE OR REPLACE VIEW module2_accreditation.v_three_way_alignment AS
SELECT
    clo.course_code,
    clo.course_title,
    clo.clo_number,
    clo.clo_statement,
    clo.assessment_method AS syllabus_assessment,
    clo.weight_in_final_grade AS syllabus_weight,
    bb.bb_column_name,
    bb.bb_column_type,
    bb.bb_weight_in_total AS bb_weight,
    bb.alignment_flag,
    bb.flag_description,
    CASE
        WHEN bb.alignment_flag = 'OK' THEN '✅ Aligned'
        WHEN bb.alignment_flag = 'MISSING_CLO' THEN '❌ CLO not mapped to any gradebook column'
        WHEN bb.alignment_flag = 'GHOST_ASSESSMENT' THEN '⚠️ Gradebook column not mapped to any CLO'
        WHEN bb.alignment_flag = 'WEIGHT_MISMATCH' THEN '⚠️ Syllabus weight differs from Blackboard weight'
        ELSE '⚠️ Review needed'
    END AS copilot_status
FROM module2_accreditation.course_learning_outcomes clo
LEFT JOIN module2_accreditation.bb_gradebook_alignment bb
    ON clo.course_code = bb.course_code AND clo.clo_id = bb.clo_id
WHERE clo.is_active = TRUE;

COMMENT ON VIEW module2_accreditation.v_three_way_alignment IS
'UC-04: Three-way CLO ↔ Syllabus ↔ Blackboard alignment check. Flags: MISSING_CLO (CLO not in gradebook), GHOST_ASSESSMENT (gradebook column not mapped to CLO), WEIGHT_MISMATCH (syllabus vs Blackboard weights differ). Rolls up to AACSB Assurance of Learning.';

-- ============================================================
-- UC-05: GRADING LOAD ANALYZER
-- Grading Load Index (GLI) = Weight × Items × Rubric × Enrollment
-- ============================================================

DROP TABLE IF EXISTS module2_faculty.grading_load_index CASCADE;
CREATE TABLE module2_faculty.grading_load_index (
    gli_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_code             VARCHAR(20) NOT NULL,
    term_code               VARCHAR(20) NOT NULL,
    instructor_id           VARCHAR(20) NOT NULL,
    instructor_name         VARCHAR(100),
    -- GLI components
    enrollment_count        INTEGER,                     -- number of students
    assignment_items_count  INTEGER,                     -- total gradable items
    exam_items_count        INTEGER,
    discussion_items_count  INTEGER,
    project_items_count     INTEGER,
    -- Rubric complexity
    rubric_use_rate         DECIMAL(5,2),                -- % of items with rubrics
    rubric_avg_criteria     DECIMAL(5,2),                -- average criteria per rubric
    -- Calculated GLI
    weight_factor           DECIMAL(8,2),                -- course credit hours × level multiplier
    items_factor            INTEGER,                     -- total gradable items
    rubric_factor           DECIMAL(8,2),                -- rubric complexity score
    enrollment_factor       INTEGER,                     -- student count
    gli_score               DECIMAL(12,2),               -- Weight × Items × Rubric × Enrollment
    gli_category            VARCHAR(20),                 -- 'LOW', 'MODERATE', 'HIGH', 'EXTREME'
    -- GA allocation
    ga_hours_allocated      DECIMAL(6,2),
    ga_hours_recommended    DECIMAL(6,2),                -- calculated from GLI
    ga_allocation_gap       DECIMAL(6,2),                -- recommended - allocated
    -- Crunch week flag
    crunch_week_flag        BOOLEAN DEFAULT FALSE,       -- TRUE if >30% of items due in same week
    -- Year-over-year
    prior_term_gli          DECIMAL(12,2),
    yoy_change_pct          DECIMAL(5,2),
    escalation_flag         BOOLEAN DEFAULT FALSE,       -- TRUE if YoY increase >20%
    calculated_at           TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_gli_course_term ON module2_faculty.grading_load_index(course_code, term_code);
CREATE INDEX idx_gli_instructor ON module2_faculty.grading_load_index(instructor_id);
CREATE INDEX idx_gli_category ON module2_faculty.grading_load_index(gli_category);

COMMENT ON TABLE module2_faculty.grading_load_index IS
'UC-05: Grading Load Index = Weight × Items × Rubric × Enrollment. Tracks faculty grading burden per course-section. GA-hour allocation recommendations and crunch-week heat map. Year-over-year escalation flags for >20% increase.';

-- Crunch week heat map view
CREATE OR REPLACE VIEW module2_faculty.v_crunch_week_heatmap AS
SELECT
    course_code,
    term_code,
    instructor_id,
    instructor_name,
    enrollment_count,
    assignment_items_count,
    gli_score,
    gli_category,
    crunch_week_flag,
    yoy_change_pct,
    escalation_flag,
    CASE
        WHEN gli_category = 'EXTREME' THEN '🔴 EXTREME'
        WHEN gli_category = 'HIGH' THEN '🟠 HIGH'
        WHEN gli_category = 'MODERATE' THEN '🟡 MODERATE'
        ELSE '🟢 LOW'
    END AS copilot_status
FROM module2_faculty.grading_load_index
WHERE term_code = (SELECT MAX(term_code) FROM module2_faculty.grading_load_index)
ORDER BY gli_score DESC;

COMMENT ON VIEW module2_faculty.v_crunch_week_heatmap IS
'UC-05: Crunch-week heat map showing courses with extreme grading load. Consumed by department chairs and dean for workload balancing and GA allocation decisions.';

-- ============================================================
-- UC-06: AI-GRADER ASSIGNMENT
-- Complexity-weighted, tier-routed grading
-- ============================================================

DROP TABLE IF EXISTS module2_faculty.ai_grader_routing CASCADE;
CREATE TABLE module2_faculty.ai_grader_routing (
    routing_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_code             VARCHAR(20) NOT NULL,
    term_code               VARCHAR(20) NOT NULL,
    section_id              VARCHAR(20),
    instructor_id           VARCHAR(20),
    -- AI grader tier
    ai_grader_tier          VARCHAR(20),               -- 'NONE', 'AVA_FEEDBACK', 'AUTO_GRADE_L1', 'AUTO_GRADE_L2', 'HUMAN_REVIEW'
    -- Routing logic
    complexity_score          DECIMAL(8,2),              -- derived from GLI rubric + enrollment
    class_size                INTEGER,
    assignment_type_mix       JSONB,                     -- {"mcq":0.4, "essay":0.3, "project":0.2, "code":0.1}
    recommended_tier          VARCHAR(20),               -- calculated from complexity + mix
    -- Human-in-the-loop
    lead_professor_id         VARCHAR(20),
    lead_professor_review     BOOLEAN DEFAULT TRUE,      -- final grade authority always human
    ava_feedback_enabled      BOOLEAN DEFAULT FALSE,     -- Anthropic AVA Assisted Feedback
    auto_grade_subject_to_review BOOLEAN DEFAULT FALSE,
    -- Blackboard integration
    bb_course_id              VARCHAR(50),
    bb_integration_status     VARCHAR(20),               -- 'connected', 'pending', 'error'
    -- Cost / budget tracking
    estimated_ai_cost_per_student DECIMAL(8,2),        -- $ per student for AI grading
    estimated_annual_savings  DECIMAL(12,2),            -- vs Instructional Connections line
    -- Metadata
    approved_by_chair       VARCHAR(100),
    approved_at             TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ai_routing_course ON module2_faculty.ai_grader_routing(course_code, term_code);
CREATE INDEX idx_ai_routing_tier ON module2_faculty.ai_grader_routing(ai_grader_tier);

COMMENT ON TABLE module2_faculty.ai_grader_routing IS
'UC-06: AI-Grader Assignment routing table. Complexity-weighted tier assignment (NONE → AVA_FEEDBACK → AUTO_GRADE_L1 → AUTO_GRADE_L2 → HUMAN_REVIEW). Lead Professor retains final-grade authority. Blackboard-first (Ultra + AVA Assisted Feedback). Estimated savings vs Instructional Connections ($1.2M–$1.5M/yr illustrative).';

-- ============================================================
-- UC-07: ENROLLMENT FUNNEL DIAGNOSTICS
-- Stage conversion and cycle time from application to census
-- ============================================================

DROP TABLE IF EXISTS module2_enrollment.funnel_stages CASCADE;
CREATE TABLE module2_enrollment.funnel_stages (
    funnel_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_syn_id          VARCHAR(20) NOT NULL,
    entry_cohort_year       VARCHAR(10),               -- e.g., 'Fall 2025'
    -- Stage timestamps (NULL = never reached or not yet)
    application_received_at   TIMESTAMP,
    application_complete_at TIMESTAMP,
    admission_decision_at     TIMESTAMP,
    deposit_paid_at         TIMESTAMP,
    fafsa_received_at       TIMESTAMP,
    financial_aid_package_at TIMESTAMP,
    orientation_registered_at TIMESTAMP,
    registration_complete_at TIMESTAMP,
    housing_assigned_at     TIMESTAMP,
    census_date_at          TIMESTAMP,                 -- official enrollment
    -- Stage durations (calculated in hours)
    app_to_decision_hours   INTEGER,
    decision_to_deposit_hours INTEGER,
    deposit_to_reg_hours    INTEGER,
    reg_to_census_hours     INTEGER,
    total_funnel_hours      INTEGER,
    -- Dropout flags
    dropped_at_stage        VARCHAR(50),               -- stage where student was lost
    dropped_reason          VARCHAR(200),              -- e.g., 'financial_aid_gap', 'housing_unavailable', 'competitor_enrolled'
    -- Source tracking
    lead_source             VARCHAR(50),               -- 'website', 'nsc', 'referral', 'counselor', 'event'
    -- Metadata
    created_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_funnel_student ON module2_enrollment.funnel_stages(student_syn_id);
CREATE INDEX idx_funnel_cohort ON module2_enrollment.funnel_stages(entry_cohort_year);
CREATE INDEX idx_funnel_dropped ON module2_enrollment.funnel_stages(dropped_at_stage);

COMMENT ON TABLE module2_enrollment.funnel_stages IS
'UC-07: Enrollment funnel stage tracking from application to census. Stage timestamps from Banner Admissions, Banner FA, TouchNet, StarRez, and registration timestamps. Identifies where, when, and why students are lost between application and census.';

-- Funnel conversion metrics view
CREATE OR REPLACE VIEW module2_enrollment.v_funnel_conversion AS
SELECT
    entry_cohort_year,
    COUNT(*) AS total_applications,
    COUNT(application_complete_at) AS completed_applications,
    COUNT(admission_decision_at) AS admitted,
    COUNT(deposit_paid_at) AS deposited,
    COUNT(registration_complete_at) AS registered,
    COUNT(census_date_at) AS enrolled,
    -- Conversion rates
    ROUND(COUNT(admission_decision_at)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) AS app_to_admit_pct,
    ROUND(COUNT(deposit_paid_at)::NUMERIC / NULLIF(COUNT(admission_decision_at), 0) * 100, 2) AS admit_to_deposit_pct,
    ROUND(COUNT(registration_complete_at)::NUMERIC / NULLIF(COUNT(deposit_paid_at), 0) * 100, 2) AS deposit_to_reg_pct,
    ROUND(COUNT(census_date_at)::NUMERIC / NULLIF(COUNT(registration_complete_at), 0) * 100, 2) AS reg_to_census_pct,
    -- Cycle times
    ROUND(AVG(total_funnel_hours)::NUMERIC, 1) AS avg_total_hours,
    ROUND(AVG(app_to_decision_hours)::NUMERIC, 1) AS avg_app_to_decision_hours,
    -- Dropout reasons
    (SELECT JSONB_OBJECT_AGG(dropped_reason, cnt) FROM (
        SELECT dropped_reason, COUNT(*) AS cnt
        FROM module2_enrollment.funnel_stages fs2
        WHERE fs2.entry_cohort_year = fs.entry_cohort_year AND dropped_reason IS NOT NULL
        GROUP BY dropped_reason
    ) sub) AS dropout_reasons
FROM module2_enrollment.funnel_stages fs
GROUP BY entry_cohort_year
ORDER BY entry_cohort_year DESC;

COMMENT ON VIEW module2_enrollment.v_funnel_conversion IS
'UC-07: Enrollment funnel conversion metrics by cohort. Stage conversion rates, cycle times, and dropout reasons. Consumed by admissions dashboard and CoPilot for enrollment strategy.';

-- ============================================================
-- UC-08: CONTINUOUS COMPLIANCE MONITORING
-- 24/7/365 watch of regulatory sources via agent swarm
-- ============================================================

DROP TABLE IF EXISTS module2_compliance_monitor.regulatory_sources CASCADE;
CREATE TABLE module2_compliance_monitor.regulatory_sources (
    source_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_name             VARCHAR(200) NOT NULL,      -- e.g., 'Federal Register', 'Texas Register', 'IPEDS Alerts'
    source_url              VARCHAR(500) NOT NULL,
    source_type             VARCHAR(50),               -- 'federal_register', 'state_register', 'agency_rss', 'court_docket', 'news_api'
    agency_tier             VARCHAR(50),               -- 'Federal', 'State', 'TSUS', 'Local'
    agency                  VARCHAR(50),               -- 'IPEDS', 'FSA', 'Clery', 'THECB', 'TCEQ', etc.
    check_frequency_minutes INTEGER DEFAULT 60,        -- how often to poll
    last_check_at           TIMESTAMP,
    last_check_status       VARCHAR(20),               -- 'success', 'error', 'timeout'
    last_content_hash       VARCHAR(64),               -- SHA-256 of last fetched content
    is_active               BOOLEAN DEFAULT TRUE,
    uco_node_ids_affected   VARCHAR(200)[]              -- which UCO nodes this source could impact
);

CREATE INDEX idx_reg_sources_active ON module2_compliance_monitor.regulatory_sources(is_active);
CREATE INDEX idx_reg_sources_agency ON module2_compliance_monitor.regulatory_sources(agency);

-- Detected changes log
DROP TABLE IF EXISTS module2_compliance_monitor.detected_changes CASCADE;
CREATE TABLE module2_compliance_monitor.detected_changes (
    change_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id               UUID REFERENCES module2_compliance_monitor.regulatory_sources(source_id),
    detected_at             TIMESTAMP DEFAULT NOW(),
    change_type             VARCHAR(50),               -- 'new_rule', 'rule_amended', 'rule_withdrawn', 'guidance_issued', 'court_decision'
    change_title            VARCHAR(500),
    change_summary          TEXT,
    change_url              VARCHAR(500),
    original_content_hash   VARCHAR(64),
    new_content_hash        VARCHAR(64),
    -- Impact mapping via UDM
    impacted_uco_nodes      VARCHAR(200)[],
    impact_assessment       TEXT,                      -- auto-generated by LLM
    impact_severity         VARCHAR(20),               -- 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
    -- Human review workflow
    human_review_required   BOOLEAN DEFAULT TRUE,
    review_status           VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'escalated'
    reviewed_by             VARCHAR(100),
    reviewed_at             TIMESTAMP,
    review_notes            TEXT,
    -- Deployment tracking
    deployed_to_trace       BOOLEAN DEFAULT FALSE,     -- deployed to Trace chain
    deployed_at             TIMESTAMP,
    deployment_tx_hash      VARCHAR(100)               -- blockchain transaction hash
);

CREATE INDEX idx_changes_detected ON module2_compliance_monitor.detected_changes(detected_at);
CREATE INDEX idx_changes_review ON module2_compliance_monitor.detected_changes(review_status);
CREATE INDEX idx_changes_severity ON module2_compliance_monitor.detected_changes(impact_severity);

COMMENT ON TABLE module2_compliance_monitor.detected_changes IS
'UC-08: 24/7/365 regulatory change detection. Each change is impact-mapped by the COS Universal Decoding Matrix, human-reviewed, and deployed on the Trace chain. Consumed by compliance dashboard and agent swarm alerts.';

-- Active alerts view (pending human review)
CREATE OR REPLACE VIEW module2_compliance_monitor.v_pending_compliance_alerts AS
SELECT
    dc.change_id,
    dc.detected_at,
    dc.change_type,
    dc.change_title,
    dc.change_summary,
    dc.impact_severity,
    dc.impacted_uco_nodes,
    rs.source_name,
    rs.agency,
    dc.human_review_required,
    dc.review_status,
    CASE
        WHEN dc.impact_severity = 'CRITICAL' THEN '🔴 CRITICAL — Review within 4 hours'
        WHEN dc.impact_severity = 'HIGH' THEN '🟠 HIGH — Review within 24 hours'
        WHEN dc.impact_severity = 'MEDIUM' THEN '🟡 MEDIUM — Review within 72 hours'
        ELSE '🟢 LOW — Review within 7 days'
    END AS copilot_action
FROM module2_compliance_monitor.detected_changes dc
JOIN module2_compliance_monitor.regulatory_sources rs ON dc.source_id = rs.source_id
WHERE dc.review_status = 'pending'
  AND rs.is_active = TRUE
ORDER BY
    CASE dc.impact_severity
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        ELSE 4
    END,
    dc.detected_at DESC;

COMMENT ON VIEW module2_compliance_monitor.v_pending_compliance_alerts IS
'UC-08: Dashboard of pending compliance alerts requiring human review. Severity-ranked with CoPilot action recommendations. CRITICAL alerts require review within 4 hours.';

-- ============================================================
-- GRANTS
-- ============================================================

GRANT USAGE ON SCHEMA module2_analytics TO ios_plus_api;
GRANT USAGE ON SCHEMA module2_advisor TO ios_plus_api;
GRANT USAGE ON SCHEMA module2_registrar TO ios_plus_api;
GRANT USAGE ON SCHEMA module2_accreditation TO ios_plus_api;
GRANT USAGE ON SCHEMA module2_faculty TO ios_plus_api;
GRANT USAGE ON SCHEMA module2_enrollment TO ios_plus_api;
GRANT USAGE ON SCHEMA module2_compliance_monitor TO ios_plus_api;

GRANT SELECT ON ALL TABLES IN SCHEMA module2_analytics TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module2_advisor TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module2_registrar TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module2_accreditation TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module2_faculty TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module2_enrollment TO ios_plus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA module2_compliance_monitor TO ios_plus_api;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module2_analytics TO ios_plus_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module2_advisor TO ios_plus_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module2_registrar TO ios_plus_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module2_accreditation TO ios_plus_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module2_faculty TO ios_plus_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module2_enrollment TO ios_plus_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA module2_compliance_monitor TO ios_plus_api;

-- ============================================================
-- EXAMPLE QUERIES (commented out)
-- ============================================================

/*
-- UC-01: Get this week's RED-tier students for advisor outreach
SELECT * FROM module2_advisor.v_red_tier_digest;

-- UC-01: Get advisor action history for a student
SELECT * FROM module2_advisor.advisor_action_log
WHERE student_syn_id = 'SYN-12345' ORDER BY action_timestamp DESC;

-- UC-02: Pending transcript evaluations
SELECT * FROM module2_registrar.transcript_crosswalk_queue
WHERE registrar_action = 'PENDING' ORDER BY confidence_score DESC;

-- UC-02: High-confidence auto-approvals (confidence > 0.95)
SELECT * FROM module2_registrar.transcript_crosswalk_queue
WHERE confidence_score > 0.95 AND registrar_action = 'PENDING';

-- UC-03: Accreditation gap heat map
SELECT * FROM module2_accreditation.v_gap_heat_map
WHERE accrediting_body = 'SACSCOC';

-- UC-03: Evidence missing for a specific standard
SELECT * FROM module2_accreditation.evidence_inventory
WHERE gap_verdict = 'EVIDENCE_MISSING';

-- UC-04: Three-way alignment issues
SELECT * FROM module2_accreditation.v_three_way_alignment
WHERE alignment_flag != 'OK';

-- UC-05: Extreme grading load courses this term
SELECT * FROM module2_faculty.v_crunch_week_heatmap
WHERE gli_category = 'EXTREME';

-- UC-05: Faculty with year-over-year escalation
SELECT * FROM module2_faculty.grading_load_index
WHERE escalation_flag = TRUE;

-- UC-06: AI-grader routing recommendations
SELECT * FROM module2_faculty.ai_grader_routing
WHERE recommended_tier != ai_grader_tier;

-- UC-07: Current cohort funnel conversion
SELECT * FROM module2_enrollment.v_funnel_conversion
WHERE entry_cohort_year = 'Fall 2025';

-- UC-07: Where are students dropping out?
SELECT dropped_at_stage, dropped_reason, COUNT(*) AS cnt
FROM module2_enrollment.funnel_stages
WHERE entry_cohort_year = 'Fall 2025' AND dropped_at_stage IS NOT NULL
GROUP BY dropped_at_stage, dropped_reason
ORDER BY cnt DESC;

-- UC-08: Pending compliance alerts
SELECT * FROM module2_compliance_monitor.v_pending_compliance_alerts;

-- UC-08: Changes detected in the last 7 days
SELECT * FROM module2_compliance_monitor.detected_changes
WHERE detected_at > CURRENT_DATE - INTERVAL '7 days';
*/