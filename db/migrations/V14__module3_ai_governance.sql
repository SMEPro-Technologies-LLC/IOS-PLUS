-- ============================================================
-- SMEPro COS Module 3: AI Governance (Operator NFRD AI Governance)
-- PostgreSQL Schema — AI Model Inventory, Risk Register, and Evidence Chain
-- Date: 2026-06-21
-- Version: 2026.06.21-LAMAR-MOD3-1.0
-- ============================================================

CREATE SCHEMA IF NOT EXISTS module3_ai_governance;

-- ============================================================
-- 1. AI GOVERNANCE FRAMEWORK — NIST AI RMF, EU AI Act, Lamar AI Policy
-- ============================================================

DROP TABLE IF EXISTS module3_ai_governance.ai_governance_framework CASCADE;
CREATE TABLE module3_ai_governance.ai_governance_framework (
    framework_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    framework_name      VARCHAR(100) NOT NULL,       -- e.g., "NIST AI RMF", "EU AI Act", "Lamar AI Policy"
    version             VARCHAR(20) NOT NULL,        -- e.g., "1.0", "2.0-2024"
    effective_date      DATE NOT NULL,               -- when this framework version becomes binding
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    -- Metadata
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_framework_name_version UNIQUE (framework_name, version)
);

CREATE INDEX idx_framework_status ON module3_ai_governance.ai_governance_framework(status, effective_date);

COMMENT ON TABLE module3_ai_governance.ai_governance_framework IS
'Register of AI governance frameworks adopted by Lamar University. Each framework version is tracked with effective date and status. NIST AI RMF, EU AI Act, and Lamar AI Policy are the initial three frameworks.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_framework.framework_name IS
'Human-readable framework name. Must be one of: NIST AI RMF, EU AI Act, Lamar AI Policy, or future institutional additions.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_framework.version IS
'Framework version identifier. Format: major.minor-year for internal policy; vendor version for external frameworks.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_framework.effective_date IS
'Date on which this framework version becomes binding for all AI governance decisions. Cannot be retroactive.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_framework.status IS
'ACTIVE, DRAFT, SUPERSEDED, or ARCHIVED. Only one version per framework may be ACTIVE at a time.';

-- ============================================================
-- 2. AI MODEL INVENTORY — Every deployed or approved AI model
-- ============================================================

DROP TABLE IF EXISTS module3_ai_governance.ai_model_inventory CASCADE;
CREATE TABLE module3_ai_governance.ai_model_inventory (
    model_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name          VARCHAR(200) NOT NULL,       -- e.g., "Microsoft Copilot (Enterprise)"
    vendor              VARCHAR(100) NOT NULL,       -- e.g., "Microsoft", "Anthropic", "OpenAI"
    version             VARCHAR(50) NOT NULL,        -- vendor version or deployment tag
    deployment_status     VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, DEPLOYED, SUSPENDED, DECOMMISSIONED
    risk_classification   VARCHAR(20) NOT NULL,      -- minimal, limited, high, unacceptable
    framework_id        UUID NOT NULL,
    approved_by         VARCHAR(100),               -- name or email of governance approver
    approved_at         TIMESTAMP,                   -- timestamp of approval decision
    evidence_record_id  UUID,                        -- FK to evidence chain (external table)
    -- Metadata
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_model_inventory_framework
        FOREIGN KEY (framework_id) REFERENCES module3_ai_governance.ai_governance_framework(framework_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_model_inventory_risk_classification
        CHECK (risk_classification IN ('minimal', 'limited', 'high', 'unacceptable')),
    CONSTRAINT chk_model_inventory_deployment_status
        CHECK (deployment_status IN ('PENDING', 'APPROVED', 'DEPLOYED', 'SUSPENDED', 'DECOMMISSIONED'))
);

CREATE INDEX idx_model_inventory_vendor ON module3_ai_governance.ai_model_inventory(vendor);
CREATE INDEX idx_model_inventory_risk ON module3_ai_governance.ai_model_inventory(risk_classification, deployment_status);
CREATE INDEX idx_model_inventory_framework ON module3_ai_governance.ai_model_inventory(framework_id);

COMMENT ON TABLE module3_ai_governance.ai_model_inventory IS
'Complete inventory of every AI model deployed or approved for use within the institution. Every model must have a risk classification, an approved framework, and a signed evidence record before deployment.';

COMMENT ON COLUMN module3_ai_governance.ai_model_inventory.model_name IS
'Vendor product name or internal model identifier. Must be descriptive enough to distinguish variants (e.g., "Microsoft Copilot (Enterprise)" vs "Copilot Pro").';

COMMENT ON COLUMN module3_ai_governance.ai_model_inventory.risk_classification IS
'EU AI Act-style classification: minimal (chatbots with no student data), limited (Copilot with pseudonymized data), high (predictive models with PII), unacceptable (prohibited uses). Must be reviewed annually.';

COMMENT ON COLUMN module3_ai_governance.ai_model_inventory.deployment_status IS
'Lifecycle state: PENDING → APPROVED → DEPLOYED → SUSPENDED → DECOMMISSIONED. Suspended models retain logs but reject new requests.';

COMMENT ON COLUMN module3_ai_governance.ai_model_inventory.evidence_record_id IS
'Links to the signed evidence record (Ed25519 chain) that documents the approval decision, risk assessment, and required mitigations.';

-- ============================================================
-- 3. AI GOVERNANCE CONTROLS — Per-framework control mapping
-- ============================================================

DROP TABLE IF EXISTS module3_ai_governance.ai_governance_controls CASCADE;
CREATE TABLE module3_ai_governance.ai_governance_controls (
    control_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    framework_id            UUID NOT NULL,
    control_domain          VARCHAR(100) NOT NULL,   -- e.g., "GOVERN", "MAP", "MEASURE", "MANAGE" (NIST)
    control_name            VARCHAR(200) NOT NULL,   -- e.g., "GOVERN-1.1: Policies and procedures are established"
    control_description     TEXT NOT NULL,           -- full control text from framework
    implementation_status   VARCHAR(20) NOT NULL DEFAULT 'NOT_IMPLEMENTED', -- NOT_IMPLEMENTED, PARTIAL, IMPLEMENTED, NOT_APPLICABLE
    evidence_count          INTEGER DEFAULT 0,     -- number of evidence records attached
    last_review_date        DATE,                    -- most recent control review
    next_review_date        DATE,                    -- scheduled next review (typically quarterly)
    -- Metadata
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_controls_framework
        FOREIGN KEY (framework_id) REFERENCES module3_ai_governance.ai_governance_framework(framework_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_controls_implementation_status
        CHECK (implementation_status IN ('NOT_IMPLEMENTED', 'PARTIAL', 'IMPLEMENTED', 'NOT_APPLICABLE'))
);

CREATE INDEX idx_controls_framework ON module3_ai_governance.ai_governance_controls(framework_id);
CREATE INDEX idx_controls_domain ON module3_ai_governance.ai_governance_controls(control_domain, implementation_status);
CREATE INDEX idx_controls_next_review ON module3_ai_governance.ai_governance_controls(next_review_date);

COMMENT ON TABLE module3_ai_governance.ai_governance_controls IS
'Mapping of framework controls (NIST AI RMF functions, EU AI Act obligations, Lamar AI Policy requirements) to implementation status. Quarterly review cycle. Evidence count is derived from attached evidence records.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_controls.control_domain IS
'NIST AI RMF: GOVERN, MAP, MEASURE, MANAGE. EU AI Act: Chapter 1, Chapter 2, etc. Lamar AI Policy: Data, Model, Usage, Audit, Incident.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_controls.implementation_status IS
'NOT_IMPLEMENTED = no evidence exists; PARTIAL = some evidence exists but gaps remain; IMPLEMENTED = fully evidenced; NOT_APPLICABLE = control does not apply to institutional context.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_controls.evidence_count IS
'Derived count of evidence records linked to this control. Incremented by trigger on evidence attachment.';

-- ============================================================
-- 4. AI MODEL USAGE LOGS — Every query logged with evidence trace
-- ============================================================

DROP TABLE IF EXISTS module3_ai_governance.ai_model_usage_logs CASCADE;
CREATE TABLE module3_ai_governance.ai_model_usage_logs (
    log_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id                UUID NOT NULL,
    user_id                 VARCHAR(100) NOT NULL,     -- institution user ID (email or SSO principal)
    user_role               VARCHAR(100) NOT NULL,   -- e.g., "student", "faculty", "advisor", "admin"
    request_type            VARCHAR(50) NOT NULL,    -- e.g., "chat_completion", "embedding", "classification"
    context_classification  VARCHAR(20) NOT NULL,    -- public, internal, restricted, confidential
    decision_outcome        TEXT,                    -- summary of AI output or decision
    timestamp               TIMESTAMP NOT NULL DEFAULT NOW(),
    evidence_record_id      UUID,                    -- signed evidence record for this interaction
    trace_id                VARCHAR(50) UNIQUE,      -- distributed trace ID for end-to-end correlation
    -- Metadata
    raw_request_hash        VARCHAR(64),             -- SHA-256 hash of sanitized request (for integrity)
    raw_response_hash       VARCHAR(64),             -- SHA-256 hash of sanitized response (for integrity)
    CONSTRAINT fk_usage_logs_model
        FOREIGN KEY (model_id) REFERENCES module3_ai_governance.ai_model_inventory(model_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_usage_logs_context_classification
        CHECK (context_classification IN ('public', 'internal', 'restricted', 'confidential'))
);

CREATE INDEX idx_usage_logs_model_id ON module3_ai_governance.ai_model_usage_logs(model_id);
CREATE INDEX idx_usage_logs_timestamp ON module3_ai_governance.ai_model_usage_logs(timestamp);
CREATE INDEX idx_usage_logs_user ON module3_ai_governance.ai_model_usage_logs(user_id, timestamp);
CREATE INDEX idx_usage_logs_trace ON module3_ai_governance.ai_model_usage_logs(trace_id);
CREATE INDEX idx_usage_logs_evidence ON module3_ai_governance.ai_model_usage_logs(evidence_record_id);

COMMENT ON TABLE module3_ai_governance.ai_model_usage_logs IS
'WORM-protected (append-only) log of every AI model interaction. Every query is recorded with user, role, context classification, outcome, and evidence trace. Required for EU AI Act transparency obligations and NIST AI RMF measurement.';

COMMENT ON COLUMN module3_ai_governance.ai_model_usage_logs.context_classification IS
'public = general knowledge queries; internal = institutional data but no PII; restricted = pseudonymized student data; confidential = raw PII or regulated data. Models with higher risk classification may be restricted to lower context classes.';

COMMENT ON COLUMN module3_ai_governance.ai_model_usage_logs.trace_id IS
'Distributed trace ID (e.g., OpenTelemetry trace_id) linking this log entry to api-gateway, trust-model, and connector-ingestion logs for end-to-end forensics.';

COMMENT ON COLUMN module3_ai_governance.ai_model_usage_logs.raw_request_hash IS
'SHA-256 hash of the sanitized request payload. Used for integrity verification without storing raw PII in the WORM log.';

-- ============================================================
-- 5. AI GOVERNANCE AUDIT — Findings, severity, remediation tracking
-- ============================================================

DROP TABLE IF EXISTS module3_ai_governance.ai_governance_audit CASCADE;
CREATE TABLE module3_ai_governance.ai_governance_audit (
    audit_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    framework_id            UUID NOT NULL,
    auditor_id              VARCHAR(100) NOT NULL,     -- name or email of auditor
    audit_date              DATE NOT NULL,             -- date of audit activity
    findings                TEXT NOT NULL,             -- detailed description of finding
    severity                VARCHAR(20) NOT NULL,      -- CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL
    remediation_status        VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, IN_PROGRESS, RESOLVED, ACCEPTED_RISK
    due_date                DATE,                      -- remediation deadline
    evidence_record_id      UUID,                    -- signed evidence of audit finding / resolution
    -- Metadata
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_audit_framework
        FOREIGN KEY (framework_id) REFERENCES module3_ai_governance.ai_governance_framework(framework_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_audit_severity
        CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL')),
    CONSTRAINT chk_audit_remediation_status
        CHECK (remediation_status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK'))
);

CREATE INDEX idx_audit_framework ON module3_ai_governance.ai_governance_audit(framework_id);
CREATE INDEX idx_audit_severity ON module3_ai_governance.ai_governance_audit(severity, remediation_status);
CREATE INDEX idx_audit_due_date ON module3_ai_governance.ai_governance_audit(due_date);
CREATE INDEX idx_audit_evidence ON module3_ai_governance.ai_governance_audit(evidence_record_id);

COMMENT ON TABLE module3_ai_governance.ai_governance_audit IS
'WORM-protected (append-only) audit findings register. Each audit finding is tied to a framework, severity-rated, and tracked through remediation. Accepts risk only with documented evidence and executive approval.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_audit.severity IS
'CRITICAL = immediate suspension of model or system required; HIGH = must remediate within 7 days; MEDIUM = within 30 days; LOW = next quarterly review; INFORMATIONAL = no action required but documented.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_audit.remediation_status IS
'OPEN = no action started; IN_PROGRESS = remediation plan active; RESOLVED = verified fixed with evidence; ACCEPTED_RISK = executive sign-off with compensating controls documented.';

-- ============================================================
-- 6. AI GOVERNANCE RISK REGISTER — Model-level risk tracking
-- ============================================================

DROP TABLE IF EXISTS module3_ai_governance.ai_governance_risk_register CASCADE;
CREATE TABLE module3_ai_governance.ai_governance_risk_register (
    risk_id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id                UUID NOT NULL,
    risk_category           VARCHAR(100) NOT NULL,   -- e.g., "bias", "privacy", "security", "transparency", "availability"
    risk_description        TEXT NOT NULL,             -- detailed risk statement
    likelihood              INTEGER NOT NULL,          -- 1-5 scale (1 = rare, 5 = almost certain)
    impact                  INTEGER NOT NULL,          -- 1-5 scale (1 = negligible, 5 = catastrophic)
    risk_score              INTEGER GENERATED ALWAYS AS (likelihood * impact) STORED, -- 1-25
    mitigations             TEXT,                    -- description of implemented mitigations
    owner                   VARCHAR(100) NOT NULL,     -- responsible party (name or email)
    status                  VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, MITIGATED, ACCEPTED, CLOSED
    last_updated            TIMESTAMP DEFAULT NOW(),
    -- Metadata
    created_at              TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_risk_register_model
        FOREIGN KEY (model_id) REFERENCES module3_ai_governance.ai_model_inventory(model_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_risk_register_likelihood
        CHECK (likelihood BETWEEN 1 AND 5),
    CONSTRAINT chk_risk_register_impact
        CHECK (impact BETWEEN 1 AND 5),
    CONSTRAINT chk_risk_register_status
        CHECK (status IN ('OPEN', 'MITIGATED', 'ACCEPTED', 'CLOSED'))
);

CREATE INDEX idx_risk_register_model ON module3_ai_governance.ai_governance_risk_register(model_id);
CREATE INDEX idx_risk_register_score ON module3_ai_governance.ai_governance_risk_register(risk_score, status);
CREATE INDEX idx_risk_register_owner ON module3_ai_governance.ai_governance_risk_register(owner, status);

COMMENT ON TABLE module3_ai_governance.ai_governance_risk_register IS
'Model-level risk register aligned with NIST AI RMF Manage function and institutional risk appetite. Each risk is scored (likelihood x impact) and owned by a named individual. Annual review required for high-risk models.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_risk_register.risk_score IS
'Calculated as likelihood (1-5) multiplied by impact (1-5). Score >= 15 requires executive review and documented compensating controls. Score >= 20 requires model suspension pending mitigation.';

COMMENT ON COLUMN module3_ai_governance.ai_governance_risk_register.mitigations IS
'Description of implemented mitigations (e.g., "pseudonymization at ingestion", "human-in-the-loop review", "output filtering"). Must be updated when controls change.';

-- ============================================================
-- 7. WORM TRIGGERS — Append-only protection for usage_logs and audit
-- ============================================================

CREATE OR REPLACE FUNCTION module3_ai_governance.worm_protect_usage_logs()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'WORM_VIOLATION: ai_model_usage_logs is append-only. Updates are prohibited. Insert new record if needed.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'WORM_VIOLATION: ai_model_usage_logs is append-only. Deletions are prohibited.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION module3_ai_governance.worm_protect_audit()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Allow remediation_status and due_date to be updated (audit workflow), but not findings or severity
        IF OLD.findings <> NEW.findings OR OLD.severity <> NEW.severity OR OLD.auditor_id <> NEW.auditor_id THEN
            RAISE EXCEPTION 'WORM_VIOLATION: ai_governance_audit findings, severity, and auditor_id are immutable. Update only remediation_status and due_date.';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'WORM_VIOLATION: ai_governance_audit is append-only. Deletions are prohibited.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_worm_usage_logs ON module3_ai_governance.ai_model_usage_logs;
CREATE TRIGGER trg_worm_usage_logs
    BEFORE UPDATE OR DELETE ON module3_ai_governance.ai_model_usage_logs
    FOR EACH ROW
    EXECUTE FUNCTION module3_ai_governance.worm_protect_usage_logs();

DROP TRIGGER IF EXISTS trg_worm_audit ON module3_ai_governance.ai_governance_audit;
CREATE TRIGGER trg_worm_audit
    BEFORE UPDATE OR DELETE ON module3_ai_governance.ai_governance_audit
    FOR EACH ROW
    EXECUTE FUNCTION module3_ai_governance.worm_protect_audit();

COMMENT ON FUNCTION module3_ai_governance.worm_protect_usage_logs() IS
'WORM enforcement: ai_model_usage_logs is strictly append-only. No updates or deletions permitted. Ensures immutable AI interaction evidence chain.';

COMMENT ON FUNCTION module3_ai_governance.worm_protect_audit() IS
'WORM enforcement: ai_governance_audit is append-only with limited update. Only remediation_status and due_date may be changed. Findings, severity, and auditor_id are immutable.';

-- ============================================================
-- 8. SEED DATA — Lamar AI Policy, NIST AI RMF mapping, Microsoft Copilot controls
-- ============================================================

-- 8.1 Frameworks
INSERT INTO module3_ai_governance.ai_governance_framework
(framework_id, framework_name, version, effective_date, status)
VALUES
('11111111-1111-1111-1111-111111111111', 'Lamar AI Policy', '1.0-2026', '2026-01-01', 'ACTIVE'),
('22222222-2222-2222-2222-222222222222', 'NIST AI RMF', '1.0', '2026-01-01', 'ACTIVE'),
('33333333-3333-3333-3333-333333333333', 'EU AI Act', '2024-2026', '2026-08-01', 'DRAFT');

-- 8.2 Model Inventory: Microsoft Copilot (Enterprise)
INSERT INTO module3_ai_governance.ai_model_inventory
(model_id, model_name, vendor, version, deployment_status, risk_classification, framework_id, approved_by, approved_at)
VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Microsoft Copilot (Enterprise)', 'Microsoft', '2026-Q1', 'DEPLOYED', 'limited',
 '11111111-1111-1111-1111-111111111111', 'CIO, Lamar University', '2026-01-15T00:00:00');

-- 8.3 Controls: Lamar AI Policy — Data Domain
INSERT INTO module3_ai_governance.ai_governance_controls
(control_id, framework_id, control_domain, control_name, control_description, implementation_status, evidence_count, last_review_date, next_review_date)
VALUES
('b1111111-b111-b111-b111-b11111111111', '11111111-1111-1111-1111-111111111111', 'DATA', 'LAI-DATA-1', 'All student PII must be pseudonymized before ingestion into any AI system. SYN IDs are the only student identifiers in AI contexts.', 'IMPLEMENTED', 3, '2026-03-15', '2026-06-15'),
('b2222222-b222-b222-b222-b22222222222', '11111111-1111-1111-1111-111111111111', 'DATA', 'LAI-DATA-2', 'De-pseudonymization requires dual approval from Data Steward and Privacy Officer with signed evidence record.', 'IMPLEMENTED', 2, '2026-03-15', '2026-06-15'),
('b3333333-b333-b333-b333-b33333333333', '11111111-1111-1111-1111-111111111111', 'DATA', 'LAI-DATA-3', 'AI systems must not retain training data from institutional queries. Tenant isolation must be verified quarterly.', 'IMPLEMENTED', 4, '2026-03-15', '2026-06-15'),

-- Lamar AI Policy — Model Domain
('b4444444-b444-b444-b444-b44444444444', '11111111-1111-1111-1111-111111111111', 'MODEL', 'LAI-MODEL-1', 'Every AI model must be registered in the Model Inventory with vendor, version, risk classification, and approver before deployment.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('b5555555-b555-b555-b555-b55555555555', '11111111-1111-1111-1111-111111111111', 'MODEL', 'LAI-MODEL-2', 'High-risk models require annual re-assessment and evidence of bias testing before renewal.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),

-- Lamar AI Policy — Usage Domain
('b6666666-b666-b666-b666-b66666666666', '11111111-1111-1111-1111-111111111111', 'USAGE', 'LAI-USAGE-1', 'Every AI query must be logged with user, role, context classification, and trace ID. Logs are WORM-protected.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('b7777777-b777-b777-b777-b77777777777', '11111111-1111-1111-1111-111111111111', 'USAGE', 'LAI-USAGE-2', 'Cited-node-only responses are required for all student-facing AI outputs. Hallucinated or unsourced claims must be flagged.', 'IMPLEMENTED', 2, '2026-03-15', '2026-06-15'),

-- Lamar AI Policy — Audit Domain
('b8888888-b888-b888-b888-b88888888888', '11111111-1111-1111-1111-111111111111', 'AUDIT', 'LAI-AUDIT-1', 'Quarterly control review must be conducted with evidence of compliance for all active controls.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('b9999999-b999-b999-b999-b99999999999', '11111111-1111-1111-1111-111111111111', 'AUDIT', 'LAI-AUDIT-2', 'Annual external audit of AI governance posture with findings tracked in the risk register.', 'NOT_IMPLEMENTED', 0, '2026-03-15', '2026-09-15'),

-- Lamar AI Policy — Incident Domain
('baaaaaaa-baaa-baaa-baaa-baaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'INCIDENT', 'LAI-INCIDENT-1', 'AI-related incidents (bias, hallucination, privacy breach) must be reported within 24 hours and documented with evidence.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),

-- NIST AI RMF — GOVERN
('c1111111-c111-c111-c111-c11111111111', '22222222-2222-2222-2222-222222222222', 'GOVERN', 'GOVERN-1.1', 'Policies and procedures are established for AI risk management and are transparent to affected parties.', 'IMPLEMENTED', 2, '2026-03-15', '2026-06-15'),
('c2222222-c222-c222-c222-c22222222222', '22222222-2222-2222-2222-222222222222', 'GOVERN', 'GOVERN-1.2', 'Roles and responsibilities for AI risk management are defined and assigned.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),

-- NIST AI RMF — MAP
('c3333333-c333-c333-c333-c33333333333', '22222222-2222-2222-2222-222222222222', 'MAP', 'MAP-1.1', 'Context is established and understood for AI system deployment.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('c4444444-c444-c444-c444-c44444444444', '22222222-2222-2222-2222-222222222222', 'MAP', 'MAP-1.2', 'Categorization of AI capabilities, risk tolerances, and trustworthiness is performed.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),

-- NIST AI RMF — MEASURE
('c5555555-c555-c555-c555-c55555555555', '22222222-2222-2222-2222-222222222222', 'MEASURE', 'MEASURE-1.1', 'Appropriate methods and metrics are identified and applied to assess AI trustworthiness.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('c6666666-c666-c666-c666-c66666666666', '22222222-2222-2222-2222-222222222222', 'MEASURE', 'MEASURE-2.1', 'AI systems are evaluated for trustworthy characteristics.', 'PARTIAL', 1, '2026-03-15', '2026-06-15'),

-- NIST AI RMF — MANAGE
('c7777777-c777-c777-c777-c77777777777', '22222222-2222-2222-2222-222222222222', 'MANAGE', 'MANAGE-1.1', 'AI risks are treated and resources are allocated to maintain trustworthiness.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('c8888888-c888-c888-c888-c88888888888', '22222222-2222-2222-2222-222222222222', 'MANAGE', 'MANAGE-2.1', 'AI risks are documented and communicated to relevant parties.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),

-- Microsoft Copilot Governance Controls
('d1111111-d111-d111-d111-d11111111111', '11111111-1111-1111-1111-111111111111', 'USAGE', 'MS-COPILOT-1', 'Microsoft Copilot is configured with tenant isolation. No institutional data is used to train Microsoft foundation models.', 'IMPLEMENTED', 2, '2026-03-15', '2026-06-15'),
('d2222222-d222-d222-d222-d22222222222', '11111111-1111-1111-1111-111111111111', 'USAGE', 'MS-COPILOT-2', 'Copilot Web Grounding is enabled to cite authoritative sources. Responses must include source nodes for all factual claims.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('d3333333-d333-d333-d333-d33333333333', '11111111-1111-1111-1111-111111111111', 'USAGE', 'MS-COPILOT-3', 'Copilot usage is logged in the AI Model Usage Logs with user_id, role, context_classification, and trace_id.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('d4444444-d444-d444-d444-d44444444444', '11111111-1111-1111-1111-111111111111', 'MODEL', 'MS-COPILOT-4', 'Copilot risk classification is reviewed quarterly against Microsoft security and compliance updates.', 'IMPLEMENTED', 1, '2026-03-15', '2026-06-15'),
('d5555555-d555-d555-d555-d55555555555', '11111111-1111-1111-1111-111111111111', 'DATA', 'MS-COPILOT-5', 'Copilot interactions with student data are restricted to pseudonymized contexts. No raw PII is submitted to Copilot prompts.', 'IMPLEMENTED', 2, '2026-03-15', '2026-06-15');

-- 8.4 Risk Register: Microsoft Copilot
INSERT INTO module3_ai_governance.ai_governance_risk_register
(risk_id, model_id, risk_category, risk_description, likelihood, impact, risk_score, mitigations, owner, status)
VALUES
('e1111111-e111-e111-e111-e11111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'privacy', 'Microsoft may inadvertently store or process institutional data in non-tenant-isolated environments.', 2, 4, 8,
 'Tenant isolation verified via Microsoft Admin Center quarterly. No raw PII in prompts. Pseudonymization enforced at connector.', 'CISO, Lamar University', 'MITIGATED'),
('e2222222-e222-e222-e222-e22222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'transparency', 'Copilot may generate hallucinated or unsourced claims that are presented as factual to students or faculty.', 3, 3, 9,
 'Web Grounding enabled. Cited-node-only responses enforced. Human review for high-stakes outputs (advising, financial aid).', 'AI Governance Officer', 'MITIGATED'),
('e3333333-e333-e333-e333-e33333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'security', 'Prompt injection or adversarial inputs could expose sensitive data or manipulate model outputs.', 2, 4, 8,
 'Input validation at api-gateway. Output filtering in trust-model. Role-based context classification restricts data access.', 'Security Engineer', 'MITIGATED'),
('e4444444-e444-e444-e444-e44444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'availability', 'Microsoft Copilot service outage could disrupt student-facing and faculty-facing AI workflows.', 3, 2, 6,
 'Fallback to non-AI workflows documented. Status page monitoring. Degraded-mode operational procedures in incident response runbook.', 'SRE Lead', 'MITIGATED');

-- 8.5 Audit: Initial self-assessment
INSERT INTO module3_ai_governance.ai_governance_audit
(audit_id, framework_id, auditor_id, audit_date, findings, severity, remediation_status, due_date)
VALUES
('f1111111-f111-f111-f111-f11111111111', '11111111-1111-1111-1111-111111111111', 'AI Governance Officer', '2026-03-15',
 'Annual external audit of AI governance posture has not yet been conducted. Internal controls are implemented but independent verification is pending.', 'MEDIUM', 'IN_PROGRESS', '2026-09-15');

-- 8.6 Usage Logs: Sample interaction (for schema demonstration)
INSERT INTO module3_ai_governance.ai_model_usage_logs
(log_id, model_id, user_id, user_role, request_type, context_classification, decision_outcome, evidence_record_id, trace_id, raw_request_hash, raw_response_hash)
VALUES
('g1111111-g111-g111-g111-g11111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'advisor.smith@lamar.edu', 'advisor', 'chat_completion', 'internal',
 'Student SYN-12345 recommended to enroll in MATH 2413 based on degree audit and prior performance. Citation: Banner degree audit, Blackboard grade history.',
 'h1111111-h111-h111-h111-h11111111111', 'trace-abc-123-xyz',
 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
 'sha256:1111111111111111111111111111111111111111111111111111111111111111');

-- ============================================================
-- 9. VIEWS — Operational views for dashboards and CoPilot queries
-- ============================================================

-- High-risk models requiring annual review
CREATE OR REPLACE VIEW module3_ai_governance.v_high_risk_models AS
SELECT
    mi.model_id,
    mi.model_name,
    mi.vendor,
    mi.version,
    mi.risk_classification,
    mi.deployment_status,
    mi.approved_by,
    mi.approved_at,
    af.framework_name,
    COUNT(rr.risk_id) AS open_risk_count,
    MAX(rr.risk_score) AS max_risk_score
FROM module3_ai_governance.ai_model_inventory mi
JOIN module3_ai_governance.ai_governance_framework af ON mi.framework_id = af.framework_id
LEFT JOIN module3_ai_governance.ai_governance_risk_register rr
    ON mi.model_id = rr.model_id AND rr.status = 'OPEN'
WHERE mi.risk_classification = 'high'
GROUP BY mi.model_id, mi.model_name, mi.vendor, mi.version, mi.risk_classification, mi.deployment_status, mi.approved_by, mi.approved_at, af.framework_name;

COMMENT ON VIEW module3_ai_governance.v_high_risk_models IS
'High-risk models with open risk counts and maximum risk scores. Used by AI Governance Officer dashboard for annual review prioritization.';

-- Overdue controls requiring immediate review
CREATE OR REPLACE VIEW module3_ai_governance.v_overdue_controls AS
SELECT
    c.control_id,
    c.control_domain,
    c.control_name,
    c.implementation_status,
    c.last_review_date,
    c.next_review_date,
    c.evidence_count,
    af.framework_name,
    af.version
FROM module3_ai_governance.ai_governance_controls c
JOIN module3_ai_governance.ai_governance_framework af ON c.framework_id = af.framework_id
WHERE c.next_review_date < CURRENT_DATE
  AND c.implementation_status IN ('NOT_IMPLEMENTED', 'PARTIAL')
ORDER BY c.next_review_date ASC;

COMMENT ON VIEW module3_ai_governance.v_overdue_controls IS
'Controls that are past their next review date and not fully implemented. Escalated to AI Governance Officer for quarterly review action items.';

-- Audit findings requiring remediation
CREATE OR REPLACE VIEW module3_ai_governance.v_open_audit_findings AS
SELECT
    a.audit_id,
    a.audit_date,
    a.findings,
    a.severity,
    a.remediation_status,
    a.due_date,
    a.auditor_id,
    af.framework_name,
    CASE
        WHEN a.due_date < CURRENT_DATE THEN 'OVERDUE'
        WHEN a.due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'DUE_SOON'
        ELSE 'ON_TRACK'
    END AS urgency
FROM module3_ai_governance.ai_governance_audit a
JOIN module3_ai_governance.ai_governance_framework af ON a.framework_id = af.framework_id
WHERE a.remediation_status IN ('OPEN', 'IN_PROGRESS')
ORDER BY
    CASE a.severity
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW' THEN 4
        ELSE 5
    END,
    a.due_date ASC;

COMMENT ON VIEW module3_ai_governance.v_open_audit_findings IS
'Open and in-progress audit findings with urgency flag. Sorted by severity then due date. Consumed by governance dashboard and CoPilot compliance queries.';

-- ============================================================
-- 10. GRANTS — Role-based access for AI Governance schema
-- ============================================================

-- Read-only role for auditors and compliance officers
GRANT USAGE ON SCHEMA module3_ai_governance TO role_ai_governance_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA module3_ai_governance TO role_ai_governance_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA module3_ai_governance TO role_ai_governance_reader;

-- Write role for AI Governance Officer and system accounts
GRANT USAGE ON SCHEMA module3_ai_governance TO role_ai_governance_writer;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA module3_ai_governance TO role_ai_governance_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA module3_ai_governance TO role_ai_governance_writer;

-- Admin role for schema evolution (Flyway, DBA)
GRANT ALL PRIVILEGES ON SCHEMA module3_ai_governance TO role_ai_governance_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA module3_ai_governance TO role_ai_governance_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA module3_ai_governance TO role_ai_governance_admin;

-- Note: WORM triggers restrict UPDATE/DELETE on usage_logs and audit for ALL roles, including admin.
-- Only the WORM trigger functions themselves may bypass this, and they are schema-owned.

-- ============================================================
-- END OF MIGRATION
-- ============================================================