# Module 3: AI Governance Framework — SMEPro COS (IOS-Plus)

> **Version:** 1.0  
> **Date:** 2026-06-21  
> **Owner:** AI Governance Officer, Lamar University  
> **Frameworks:** NIST AI Risk Management Framework (AI RMF) 1.0, EU AI Act (2024–2026), Lamar AI Policy 1.0-2026  
> **Scope:** All AI models deployed, approved, or used within the institution, including vendor-hosted services (Microsoft Copilot, optional Claude API, etc.)

---

## Table of Contents

1. [Framework Alignment](#1-framework-alignment)
2. [Risk Classification](#2-risk-classification)
3. [Microsoft Copilot Governance](#3-microsoft-copilot-governance)
4. [Model Inventory](#4-model-inventory)
5. [Usage Monitoring](#5-usage-monitoring)
6. [Periodic Review](#6-periodic-review)
7. [Evidence Requirements](#7-evidence-requirements)
8. [Prohibited Uses](#8-prohibited-uses)
9. [Appendix: Control Mapping](#appendix-control-mapping)

---

## 1. Framework Alignment

The COS AI Governance module aligns with three complementary frameworks:

### 1.1 NIST AI Risk Management Framework (AI RMF) 1.0

| NIST Function | COS Implementation | Database Table |
|---------------|-------------------|----------------|
| **GOVERN** | Policies, roles, and procedures documented in Lamar AI Policy. AI Governance Officer accountable. | `ai_governance_framework`, `ai_governance_controls` |
| **MAP** | Model inventory with context, risk classification, and trustworthiness assessment. | `ai_model_inventory`, `ai_governance_risk_register` |
| **MEASURE** | Usage logging, bias detection metrics, accuracy tracking, human feedback loops. | `ai_model_usage_logs`, `ai_governance_controls` (MEASURE domain) |
| **MANAGE** | Risk treatment, remediation tracking, incident response, model suspension/decommissioning. | `ai_governance_risk_register`, `ai_governance_audit` |

### 1.2 EU AI Act (2024–2026)

| EU AI Act Concept | COS Mapping | Status |
|-------------------|-------------|--------|
| Risk-based classification | `ai_model_inventory.risk_classification` | ✓ Implemented |
| High-risk AI systems | Models with `risk_classification = 'high'` require human oversight, bias testing, and evidence of accuracy. | ✓ Implemented |
| General-purpose AI (GPAI) | GPT-4 / Copilot registered with transparency obligations. | ✓ Implemented |
| Prohibited AI practices | Real-time facial recognition, social scoring, subliminal manipulation blocked by policy. | ✓ Implemented |
| Transparency | Every query logged with user, role, context, and trace ID. | ✓ Implemented |
| Data governance | Pseudonymization, data quality controls, no training data retention. | ✓ Implemented |

> **Note:** EU AI Act is in DRAFT status within the COS framework until August 2026. Full compliance obligations will be assessed and implemented upon effective date.

### 1.3 Lamar AI Policy 1.0-2026

The Lamar AI Policy is the institutional authority that governs all AI use. It is composed of five domains:

| Domain | Policy Statement | Controls |
|--------|------------------|----------|
| **DATA** | All student PII must be pseudonymized before AI ingestion. | LAI-DATA-1 through LAI-DATA-3 |
| **MODEL** | Every AI model must be registered, risk-classified, and approved before deployment. | LAI-MODEL-1 through LAI-MODEL-2 |
| **USAGE** | Every AI query must be logged; cited-node-only responses required for student-facing outputs. | LAI-USAGE-1 through LAI-USAGE-2 |
| **AUDIT** | Quarterly control review and annual external audit required. | LAI-AUDIT-1 through LAI-AUDIT-2 |
| **INCIDENT** | AI-related incidents must be reported within 24 hours. | LAI-INCIDENT-1 |

---

## 2. Risk Classification

All AI models are classified into one of four risk categories, aligned with the EU AI Act and institutional risk appetite:

### 2.1 Risk Classification Definitions

| Classification | Definition | Examples | Human Oversight | Evidence Required |
|----------------|------------|----------|-----------------|-------------------|
| **Minimal** | No student data; low-stakes interactions; general knowledge queries. | Chatbots with no student data, FAQ bots, general-purpose search | None required | Basic model registration |
| **Limited** | Pseudonymized student data; medium-stakes interactions; institutional data but no PII. | Microsoft Copilot with SYN IDs, course recommendation engines, scheduling assistants | Review for high-stakes decisions | Model registration, risk assessment, control mapping |
| **High** | Raw or re-identifiable PII; high-stakes decisions affecting student outcomes. | Predictive persistence models, financial aid risk scoring, admissions prediction | Mandatory human-in-the-loop for all decisions | Full evidence package: risk assessment, bias testing, accuracy metrics, human oversight plan |
| **Unacceptable** | Prohibited by policy or regulation; no deployment permitted. | Real-time facial recognition, social scoring, subliminal manipulation, emotion inference in education | N/A (prohibited) | N/A |

### 2.2 Risk Classification Workflow

```
Vendor proposes model → AI Governance Officer assesses risk class →
  If Minimal: Register, basic evidence, deploy
  If Limited: Register, risk assessment, control mapping, evidence record, deploy
  If High: Register, full risk assessment, bias testing, human oversight plan,
           executive approval, evidence record, deploy with monitoring
  If Unacceptable: Reject, document in risk register, block vendor access
```

### 2.3 Database Enforcement

```sql
-- CHECK constraint on ai_model_inventory.risk_classification
CONSTRAINT chk_model_inventory_risk_classification
    CHECK (risk_classification IN ('minimal', 'limited', 'high', 'unacceptable'))

-- High-risk models require executive approval
check constraint: approved_by IS NOT NULL AND approved_at IS NOT NULL
-- (enforced by application layer trigger for high-risk inserts)
```

---

## 3. Microsoft Copilot Governance

Microsoft Copilot (Enterprise) is the primary AI model deployed within COS. It is classified as **Limited Risk** due to its use of pseudonymized student data and institutional context.

### 3.1 Tenant Isolation

| Control | Implementation | Verification |
|---------|----------------|--------------|
| Data isolation | Microsoft 365 tenant isolation configured; no data sharing across tenants | Microsoft Admin Center export quarterly |
| Training data exclusion | "Your data is not used to train Microsoft's foundation models" | Microsoft data processing agreement |
| Geo-residency | US datacenter only | Microsoft Trust Center documentation |
| Subprocessor control | Approved subprocessors only per Microsoft DPA Appendix C | Annual DPA review |

### 3.2 Usage Logging

Every Copilot interaction is logged in `ai_model_usage_logs` with:

| Field | Value | Example |
|-------|-------|---------|
| `model_id` | `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` | Microsoft Copilot (Enterprise) |
| `user_id` | SSO principal | `advisor.smith@lamar.edu` |
| `user_role` | Application role | `advisor` |
| `request_type` | Interaction type | `chat_completion` |
| `context_classification` | Data sensitivity | `internal` or `restricted` |
| `decision_outcome` | Summary of AI response | `Recommended MATH 2413; cited Banner degree audit` |
| `trace_id` | Distributed trace | `trace-abc-123-xyz` |

### 3.3 Cited-Node-Only Responses

All student-facing Copilot outputs must include authoritative citations:

| Requirement | Implementation | Verification |
|-------------|----------------|--------------|
| Web Grounding enabled | Copilot configured to cite web sources | Admin Center configuration |
| Institutional knowledge base | Banner, Blackboard, Concourse data indexed for Copilot | Connector-ingestion pipeline |
| No hallucinated claims | Output filter in trust-model flags uncited factual claims | Weekly random sample review |
| Human review for high-stakes | Advisor must review Copilot recommendations before student communication | Application workflow enforcement |

### 3.4 Copilot-Specific Controls

| Control ID | Name | Status | Evidence |
|------------|------|--------|----------|
| MS-COPILOT-1 | Tenant isolation; no training data use | IMPLEMENTED | Microsoft Admin Center export |
| MS-COPILOT-2 | Web Grounding; cited-node-only responses | IMPLEMENTED | Weekly output sample review |
| MS-COPILOT-3 | Usage logging with trace_id | IMPLEMENTED | `ai_model_usage_logs` query |
| MS-COPILOT-4 | Quarterly risk classification review | IMPLEMENTED | `ai_governance_controls` review date |
| MS-COPILOT-5 | No raw PII in prompts | IMPLEMENTED | Pseudonymization at connector-ingestion |

---

## 4. Model Inventory

Every AI model used within the institution must be registered in the `ai_model_inventory` table before deployment.

### 4.1 Required Fields

| Field | Description | Example |
|-------|-------------|---------|
| `model_name` | Vendor product name | `Microsoft Copilot (Enterprise)` |
| `vendor` | Organization providing the model | `Microsoft` |
| `version` | Specific version or deployment tag | `2026-Q1` |
| `deployment_status` | Current lifecycle state | `DEPLOYED` |
| `risk_classification` | Minimal / Limited / High / Unacceptable | `limited` |
| `framework_id` | Governing framework (Lamar AI Policy) | `11111111-1111-1111-1111-111111111111` |
| `approved_by` | Name or email of governance approver | `CIO, Lamar University` |
| `approved_at` | Timestamp of approval | `2026-01-15T00:00:00` |
| `evidence_record_id` | Signed evidence of approval | `h1111111-h111-h111-h111-h11111111111` |

### 4.2 Inventory Review Process

| Trigger | Action | Owner | Timeline |
|---------|--------|-------|----------|
| New vendor proposal | Complete risk assessment, register model | AI Governance Officer | 14 days |
| Vendor version update | Review changelog, assess risk impact, update version | AI Governance Officer | 7 days |
| Quarterly review | Validate all deployed models still appropriate | AI Governance Officer | Quarterly |
| Annual review | Full risk reassessment for all high-risk models | AI Governance Officer + External Auditor | Annually |
| Incident | Immediate suspension pending investigation | AI Governance Officer | 24 hours |

### 4.3 Current Inventory (Seed Data)

| Model | Vendor | Version | Risk Class | Status | Approved By |
|-------|--------|---------|------------|--------|-------------|
| Microsoft Copilot (Enterprise) | Microsoft | 2026-Q1 | Limited | DEPLOYED | CIO, Lamar University |

> **Placeholder:** Additional models (Claude API, Firecrawl NLP, custom predictive models) will be added as they are proposed and assessed.

---

## 5. Usage Monitoring

### 5.1 Logging Requirements

Every AI query must be logged with the following minimum fields:

| Field | Required | Purpose |
|-------|----------|---------|
| `model_id` | Yes | Link to model inventory |
| `user_id` | Yes | Accountability |
| `user_role` | Yes | Role-lens enforcement verification |
| `request_type` | Yes | Model interaction categorization |
| `context_classification` | Yes | Data sensitivity tracking |
| `decision_outcome` | Yes | AI output summary (for audit) |
| `timestamp` | Yes | Temporal analysis, incident reconstruction |
| `evidence_record_id` | Yes | Signed evidence of interaction |
| `trace_id` | Yes | End-to-end distributed tracing |
| `raw_request_hash` | Yes | Integrity verification (SHA-256 of sanitized request) |
| `raw_response_hash` | Yes | Integrity verification (SHA-256 of sanitized response) |

### 5.2 WORM Protection

`ai_model_usage_logs` is **strictly append-only** via PostgreSQL trigger:

- No UPDATE permitted
- No DELETE permitted
- Inserts only via application service account or authorized batch jobs

### 5.3 Monitoring Dashboards

| Dashboard | Data Source | Refresh | Audience |
|-----------|-------------|---------|----------|
| AI Governance Overview | `ai_model_inventory`, `ai_governance_controls`, `ai_governance_risk_register` | Hourly | AI Governance Officer, CISO |
| Usage Analytics | `ai_model_usage_logs` | Real-time | AI Governance Officer, Compliance |
| Risk Register | `ai_governance_risk_register` | Daily | AI Governance Officer, Executive |
| Audit Findings | `ai_governance_audit` | Daily | Internal Audit, External Auditor |
| Model Performance | `ai_model_usage_logs` + application metrics | 5 min | SRE, AI Governance Officer |

### 5.4 Alerting Thresholds

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| High-risk model query spike | `COUNT(*) WHERE risk_classification='high'` > 100/hour | Warning | Review for abnormal pattern |
| Unacceptable context classification | `context_classification='confidential'` for Limited model | Critical | Block query, alert Security |
| WORM violation attempt | `worm_violation_attempts_total` > 0 | Critical | PagerDuty + Security team |
| Missing evidence record | `evidence_record_id IS NULL` | High | Auto-create placeholder, alert Compliance |
| Model suspension bypass | Query to `deployment_status='SUSPENDED'` model | Critical | Block query, alert AI Governance Officer |

---

## 6. Periodic Review

### 6.1 Review Cadence

| Review Type | Frequency | Scope | Owner | Evidence |
|-------------|-----------|-------|-------|----------|
| Model risk assessment | Annual | All high-risk models | AI Governance Officer | `ai_governance_risk_register` |
| Control review | Quarterly | All `ai_governance_controls` | AI Governance Officer | `ai_governance_controls` status update |
| Usage log audit | Quarterly | 5% random sample of `ai_model_usage_logs` | Internal Audit | Audit report with findings |
| Vendor assessment | Annual | All active AI vendors | Procurement + Security | Vendor assessment matrix |
| External audit | Annual | Full AI governance posture | External Auditor | `ai_governance_audit` findings |
| Framework update | As needed | New regulations, vendor changes | AI Governance Officer | Updated `ai_governance_framework` version |

### 6.2 Review Workflow

```
Schedule review → Pull relevant data from COS →
  Assess compliance status → Identify gaps →
    Create remediation plan → Assign owner and due date →
      Update ai_governance_controls or ai_governance_audit →
        Sign evidence record → Close review cycle
```

### 6.3 Overdue Controls

Controls with `next_review_date < CURRENT_DATE` and `implementation_status IN ('NOT_IMPLEMENTED', 'PARTIAL')` are escalated:

1. Daily automated alert to AI Governance Officer
2. Weekly escalation to CISO if not addressed
3. Monthly escalation to CIO/CTO if critical controls remain overdue

---

## 7. Evidence Requirements

### 7.1 Evidence Types

| Evidence Type | Description | Storage | Retention |
|---------------|-------------|---------|-----------|
| Model Approval | Signed record of governance approval for model deployment | `ai_model_inventory.evidence_record_id` → Cloud Storage | 7 years |
| Risk Assessment | Documented risk analysis with likelihood, impact, and mitigations | `ai_governance_risk_register` + signed document | 7 years |
| Control Evidence | Proof of control implementation (screenshots, config exports, test results) | `ai_governance_controls.evidence_count` + attachments | 7 years |
| Usage Log | Immutable record of every AI interaction | `ai_model_usage_logs` (WORM PostgreSQL) | 7 years |
| Audit Finding | Signed audit report with remediation plan | `ai_governance_audit` (limited WORM) | 7 years |
| Incident Report | Documented AI-related incident with response actions | Evidence bucket + `ai_governance_audit` | 7 years |
| De-pseudonymization Approval | Dual-signed approval for reverse-mapping SYN → PIDM | Evidence bucket | 7 years |

### 7.2 Signing Process

All evidence records are signed with Ed25519 via Cloud KMS:

```
1. Generate payload (JSON canonicalized)
2. Hash payload (SHA-256)
3. Sign hash with Cloud KMS asymmetric key (cos-evidence-signing-key)
4. Store signature + payload in evidence bucket (CMEK, 7-year retention)
5. Store evidence_record_id in PostgreSQL with WORM protection
6. Verify signature on retrieval via public key endpoint
```

### 7.3 Verification

Evidence signatures can be verified by:

```bash
curl https://api.ioscos.com/.well-known/evidence-public-key
# Returns Ed25519 public key for signature verification
```

---

## 8. Prohibited Uses

The following AI uses are **prohibited** within the institution, regardless of risk classification or vendor:

### 8.1 Prohibited Use List

| # | Prohibited Use | Rationale | Detection |
|---|----------------|-----------|-----------|
| 1 | **Real-time facial recognition** | Violates student privacy, FERPA, and EU AI Act Art. 5 | Network monitoring, application policy enforcement |
| 2 | **Social scoring** | Automated scoring of students for social behavior, character, or trustworthiness | Application policy, audit of model outputs |
| 3 | **Subliminal manipulation** | AI designed to influence student behavior without conscious awareness | Application policy, output filtering |
| 4 | **Emotion inference in education** | Using AI to infer student emotional states for grading, admission, or disciplinary decisions | Application policy, model inventory review |
| 5 | **Predictive policing** | Using AI to identify students for disciplinary action based on behavioral patterns | Application policy, role-lens enforcement |
| 6 | **Automated grading without human review** | Final grades determined solely by AI without faculty oversight | Application workflow enforcement |
| 7 | **Admissions decisions without human review** | Admission or rejection determined solely by AI | Application workflow enforcement |
| 8 | **Surveillance of student communications** | Using AI to monitor private student communications (email, chat) without consent | Network monitoring, application policy |
| 9 | **Deepfake generation** | Creating synthetic media of students, faculty, or staff without consent | Content filtering, network monitoring |
| 10 | **Autonomous decision-making on financial aid** | Awarding or denying financial aid without human review | Application workflow enforcement |

### 8.2 Enforcement

| Layer | Control | Response |
|-------|---------|----------|
| Application | Role-lens policy engine blocks prohibited query types | 403 Forbidden, logged to `ai_model_usage_logs` |
| Network | Cloud Armor WAF blocks known prohibited API endpoints | 403 Forbidden, alert Security |
| Model | Model inventory prohibits deployment of models designed for prohibited uses | Registration rejection |
| Audit | Quarterly sample review of usage logs for prohibited use patterns | Findings in `ai_governance_audit` |
| Human | All faculty and staff trained on prohibited uses during onboarding | Training completion recorded |

### 8.3 Violation Response

| Severity | Response | Timeline |
|----------|----------|----------|
| Attempted (blocked) | Log, alert AI Governance Officer, no further action | Immediate |
| Successful (unauthorized) | Suspend model, revoke user access, investigate, document in `ai_governance_audit` | 24 hours |
| Repeated | Terminate user access, escalate to HR/Legal, update risk register | 48 hours |
| Institutional | External audit, regulatory notification, legal review | 72 hours |

---

## Appendix: Control Mapping

### A.1 NIST AI RMF → COS Controls

| NIST Control | COS Control ID | Implementation |
|--------------|----------------|----------------|
| GOVERN-1.1 | LAI-AUDIT-1 | Policies and procedures established, transparent to affected parties |
| GOVERN-1.2 | LAI-MODEL-1 | Roles and responsibilities defined (AI Governance Officer, CISO, etc.) |
| MAP-1.1 | MS-COPILOT-1 | Context established for Copilot deployment (tenant, data residency) |
| MAP-1.2 | LAI-MODEL-2 | Risk classification performed for all models |
| MEASURE-1.1 | LAI-USAGE-1 | Metrics and methods for trustworthiness (usage logs, accuracy tracking) |
| MEASURE-2.1 | MS-COPILOT-2 | AI system evaluated for trustworthy characteristics (cited-node responses) |
| MANAGE-1.1 | LAI-INCIDENT-1 | Risk treatment and resource allocation for AI incidents |
| MANAGE-2.1 | LAI-AUDIT-2 | Risk documentation and communication to relevant parties |

### A.2 EU AI Act → COS Controls

| EU AI Act Article | COS Control ID | Implementation |
|-------------------|----------------|----------------|
| Art. 5 (Prohibited) | Prohibited Uses List | Real-time facial recognition, social scoring, subliminal manipulation blocked |
| Art. 6 (High-risk) | LAI-MODEL-2 | High-risk models require human oversight and bias testing |
| Art. 10 (Data) | LAI-DATA-1 | Pseudonymization, data quality controls |
| Art. 13 (Transparency) | LAI-USAGE-2 | Cited-node-only responses, usage logging |
| Art. 14 (Oversight) | LAI-MODEL-2 | Human-in-the-loop for high-risk decisions |
| Art. 52 (GPAI) | MS-COPILOT-4 | General-purpose AI (Copilot) registered with transparency obligations |

### A.3 Lamar AI Policy → COS Controls

| Policy Domain | Control ID | Name | Status |
|---------------|------------|------|--------|
| DATA | LAI-DATA-1 | Pseudonymization required | IMPLEMENTED |
| DATA | LAI-DATA-2 | De-pseudonymization dual approval | IMPLEMENTED |
| DATA | LAI-DATA-3 | No training data retention; tenant isolation | IMPLEMENTED |
| MODEL | LAI-MODEL-1 | Model registration required | IMPLEMENTED |
| MODEL | LAI-MODEL-2 | High-risk annual re-assessment | IMPLEMENTED |
| USAGE | LAI-USAGE-1 | WORM usage logging | IMPLEMENTED |
| USAGE | LAI-USAGE-2 | Cited-node-only responses | IMPLEMENTED |
| AUDIT | LAI-AUDIT-1 | Quarterly control review | IMPLEMENTED |
| AUDIT | LAI-AUDIT-2 | Annual external audit | NOT_IMPLEMENTED |
| INCIDENT | LAI-INCIDENT-1 | 24-hour incident reporting | IMPLEMENTED |

### A.4 Microsoft Copilot → COS Controls

| Microsoft Control | COS Control ID | Implementation |
|-------------------|----------------|----------------|
| Tenant isolation | MS-COPILOT-1 | Verified via Admin Center quarterly |
| Web Grounding | MS-COPILOT-2 | Enabled; cited-node responses enforced |
| Usage logging | MS-COPILOT-3 | All queries logged in `ai_model_usage_logs` |
| Risk review | MS-COPILOT-4 | Quarterly control review in `ai_governance_controls` |
| PII protection | MS-COPILOT-5 | Pseudonymization at connector-ingestion |

---

*End of Module 3: AI Governance Framework — SMEPro COS (IOS-Plus)*
