# EDU Reporter — Specification Document

## Version: v2.0 | Status: Implementation-Ready | Date: 2026-01-21

## Purpose

EDU Reporter is the **buyer-visible reporting surface** of the IOS+ platform. It is the unified interface where faculty, advisors, registrars, compliance officers, and administrators consume the outputs of the IOS+ engine. Every number, chart, and alert in EDU Reporter is backed by **traceable evidence** — one click away from the signed audit record that produced it.

**Core principle:** EDU Reporter is the *surface*. IOS+ is the *engine* underneath.

---

## Architecture Position

```
┌────────────────────────────────────────────┐
│  EDU REPORTER — Product Layer                │
│  ├─ Dashboards (7 buyer-visible UCs)        │
│  ├─ Monitored Filings (5 federal/state)     │
│  ├─ Operational Views (3 real-time)        │
│  └─ Evidence Drill-Down (universal)        │
└────────────────────────────────────────────┘
              ↑
┌────────────────────────────────────────────┐
│  IOS+ Engine — On Premises                  │
│  ├─ Execution Layer (APIs, scoring, jobs)  │
│  ├─ Governance Layer (RBAC, audit, policy) │
│  └─ Trust Layer (canonical, UDM, evidence) │
└────────────────────────────────────────────┘
```

---

## User Personas & Role Lenses

EDU Reporter implements **role-lens governance**: the same data presents differently depending on who is viewing it.

| Persona | Role Lens | Primary Dashboards | PII Access |
|---------|-----------|-------------------|------------|
| **Academic Advisor** | Advisor | UC-01 (Predictive Persistence), UC-02 (Transcript) | Section-level: assigned students only, pseudonymized by default |
| **Faculty** | Faculty Aggregate | UC-04 (Alignment), UC-05 (Grading Load) | Aggregate only: course-level, no individual student PII |
| **Department Chair** | Managerial | UC-06 (Allied Health), UC-03 (Accreditation) | Department-level aggregates, program KPIs |
| **Registrar** | Authoritative | UC-02 (Transcript), Operational Views | Full records with controlled de-pseudonymization |
| **Compliance Officer** | Audit | UC-03 (Accreditation), UC-08 (Watchtower), Evidence Access | Audit trail only, no student data |
| **Dean** | Executive | All dashboards, summary roll-ups | College-level aggregates with trend analysis |
| **Student** | Self-Service (future) | Degree-plan-to-licensure, SAP status | Own record only |

---

## Dashboards: The 7 Use Cases

### UC-01: Predictive Persistence Dashboard

**Purpose:** Early warning system for at-risk students

**Primary Users:** Academic advisors, retention coordinators

**Data Model:**
```sql
-- Source: v_student_risk_score (materialized view refreshed every 6 hours)
CREATE MATERIALIZED VIEW v_student_risk_score AS
SELECT 
    s.syn_id,
    s.section_id,
    s.gpa,
    s.credit_hours_attempted,
    s.credit_hours_completed,
    (s.credit_hours_completed::float / NULLIF(s.credit_hours_attempted, 0)) AS completion_rate,
    b.days_since_login,
    b.assignments_submitted_rate,
    b.time_on_task_hours,
    -- Risk score: composite of academic + engagement factors
    CASE 
        WHEN s.gpa < 2.0 AND b.days_since_login > 7 THEN 'CRITICAL'
        WHEN s.gpa < 2.5 OR b.assignments_submitted_rate < 0.7 THEN 'HIGH'
        WHEN s.gpa < 3.0 AND b.time_on_task_hours < 10 THEN 'ELEVATED'
        ELSE 'LOW'
    END AS risk_tier,
    NOW() AS refreshed_at
FROM canonical_students s
LEFT JOIN blackboard_engagement b ON s.syn_id = b.syn_id
WHERE s.enrollment_status = 'ACTIVE';
```

**Dashboard Components:**
1. **Risk Summary Cards** — Count of students by tier: CRITICAL (red), HIGH (orange), ELEVATED (yellow), LOW (green)
2. **Intervention Queue** — Sortable, filterable table: student SYN ID, risk tier, GPA, last login, days since assignment submission, recommended action
3. **Trend Chart** — Risk tier distribution over time (last 6 weeks)
4. **Section Breakdown** — Risk by course section (advisor sees only assigned sections)
5. **Evidence Link** — Every risk score has a trace ID linking to the scoring job evidence record

**Evidence Drill-Down:**
- Click any risk score → shows: source signals (Banner GPA, Blackboard engagement), scoring formula version, timestamp, job trace ID
- Click "Why?" → resolves to: "GPA 1.85 (Banner) + 12 days since login (Blackboard) + 3/10 assignments submitted = CRITICAL"

**API Endpoint:** `GET /v1/reports/predictive-persistence?advisor_id={id}&section_filter={filter}`

---

### UC-02: Transcript Evaluation Dashboard

**Purpose:** Accelerated transcript evaluation with confidence scoring

**Primary Users:** Registrars, transfer evaluators, admissions

**Data Model:**
```sql
-- Source: v_transcript_evaluation_queue
CREATE VIEW v_transcript_evaluation_queue AS
SELECT 
    te.id,
    te.student_syn_id,
    te.source_institution,
    te.source_course_code,
    te.source_course_title,
    te.source_credits,
    te.grade,
    -- Catalog matching via UDM
    m.lamar_course_code,
    m.lamar_course_title,
    m.match_confidence,
    m.match_type, -- 'direct', 'title_similarity', 'crosswalk', 'manual'
    te.evaluator_assigned,
    te.status, -- 'pending', 'proposed', 'approved', 'rejected', 'appealed'
    te.approver_id,
    te.approved_at,
    te.evidence_record_id
FROM transcript_evaluations te
LEFT JOIN catalog_matches m ON te.id = m.evaluation_id
WHERE te.status IN ('pending', 'proposed')
ORDER BY m.match_confidence DESC, te.received_at ASC;
```

**Dashboard Components:**
1. **Queue Summary** — Total pending, average turnaround time, auto-match rate
2. **Evaluation Table** — Incoming course | Source institution | Proposed Lamar equivalent | Confidence band (visual: green ≥ 0.85, yellow 0.60–0.84, red < 0.60) | Status | One-click approve/reject
3. **Confidence Distribution** — Histogram of match confidence scores
4. **Institution Breakdown** — Match quality by source institution
5. **Timeline** — Average turnaround over time (target: 2 days)

**Evidence Drill-Down:**
- Click any match → shows: matching algorithm (title similarity, CIP crosswalk, manual prior), confidence score breakdown, comparable prior approvals, evidence record with trace ID
- Click "Approve" → writes to student record, creates evidence record, logs approver identity

**API Endpoint:** `GET /v1/reports/transcript-evaluation?status={pending|proposed}&sort=confidence`

---

### UC-03: Accreditation Gap Analysis Dashboard

**Purpose:** Continuous readiness tracking for SACSCOC, ABET, AACSB

**Primary Users:** Compliance officers, accreditation coordinators, department chairs

**Data Model:**
```sql
-- Source: v_accreditation_readiness
CREATE VIEW v_accreditation_readiness AS
SELECT 
    a.standard_id,
    a.standard_body, -- 'SACSCOC', 'ABET', 'AACSB'
    a.standard_title,
    a.criterion_text,
    a.evidence_required,
    -- Evidence mapping
    e.evidence_count,
    e.last_evidence_date,
    e.evidence_quality_score, -- 0-1 based on completeness, recency, relevance
    -- Gap scoring
    CASE 
        WHEN e.evidence_count = 0 THEN 'RED'
        WHEN e.evidence_quality_score < 0.6 THEN 'YELLOW'
        WHEN e.last_evidence_date < NOW() - INTERVAL '1 year' THEN 'YELLOW'
        ELSE 'GREEN'
    END AS readiness_status,
    a.assigned_owner,
    a.next_review_date
FROM accreditation_standards a
LEFT JOIN (
    SELECT standard_id, 
           COUNT(*) AS evidence_count,
           MAX(created_at) AS last_evidence_date,
           AVG(quality_score) AS evidence_quality_score
    FROM accreditation_evidence
    GROUP BY standard_id
) e ON a.standard_id = e.standard_id;
```

**Dashboard Components:**
1. **Readiness Heat Map** — Grid: standards (rows) × criteria (columns), color-coded: GREEN (ready), YELLOW (needs attention), RED (gap)
2. **Gap Summary** — Count of RED and YELLOW gaps by accreditor and department
3. **Evidence Inventory** — 414 existing SACSCOC files indexed, searchable, filterable by standard, date, owner
4. **Action Items** — Assigned tasks with due dates, owners, status
5. **Trend** — Readiness score over time (last 12 months)

**Evidence Drill-Down:**
- Click any cell in heat map → shows: standard text, required evidence type, existing evidence files, gap explanation, owner, due date
- Click "Upload Evidence" → routes to evidence upload with automatic standard tagging

**API Endpoint:** `GET /v1/reports/accreditation-readiness?body={SACSCOC|ABET|AACSB}&dept={id}`

---

### UC-04: Course Outcome Alignment Dashboard

**Purpose:** Detect instructional drift between approved CLOs and actual assessments

**Primary Users:** Faculty, department chairs, SACSCOC reviewers

**Data Model:**
```sql
-- Source: v_course_alignment_status
CREATE VIEW v_course_alignment_status AS
SELECT 
    c.course_code,
    c.course_title,
    c.section_id,
    c.instructor_id,
    -- CLOs from Concourse (syllabus of record)
    conc.clo_count AS approved_clos,
    conc.clo_list AS approved_clo_text,
    -- Assessments from Blackboard
    bb.assessment_count AS actual_assessments,
    bb.assessment_list AS actual_assessment_names,
    -- Alignment scoring
    a.aligned_count,
    a.misaligned_count,
    a.missing_assessment_count,
    a.excess_assessment_count,
    a.alignment_score, -- aligned / (aligned + misaligned + missing)
    CASE 
        WHEN a.alignment_score >= 0.85 THEN 'ALIGNED'
        WHEN a.alignment_score >= 0.60 THEN 'DRIFTING'
        ELSE 'MISALIGNED'
    END AS alignment_status,
    a.last_analyzed_at
FROM courses c
LEFT JOIN concourse_clos conc ON c.course_code = conc.course_code
LEFT JOIN blackboard_assessments bb ON c.section_id = bb.section_id
LEFT JOIN clo_assessment_alignment a ON c.course_code = a.course_code AND c.section_id = a.section_id;
```

**Dashboard Components:**
1. **Alignment Overview** — Course grid: each cell shows alignment status (green/orange/red), alignment score
2. **Drift Alerts** — Courses flagged as DRIFTING or MISALIGNED with specific mismatches
3. **CLO Detail View** — For a selected course: approved CLOs (from Concourse) vs. actual assessments (from Blackboard), line-by-line mapping with match confidence
4. **Department Roll-Up** — Average alignment score by department, trend over semesters
5. **Correction Workflow** — "Correct Drift" button routes to syllabus update workflow

**Evidence Drill-Down:**
- Click any drift alert → shows: CLO text, assessment text, similarity score, reason for mismatch, recommended action, evidence trace ID
- Example: "CLO #3: 'Students will analyze patient data' → Assessment: 'Multiple choice quiz' (no analysis required) → Similarity: 0.23 → MISALIGNED"

**API Endpoint:** `GET /v1/reports/course-alignment?dept={id}&semester={term}`

---

### UC-05: Grading Load Analysis Dashboard

**Purpose:** Quantitative workload measurement for fair grading support allocation

**Primary Users:** Deans, department chairs, academic operations

**Data Model:**
```sql
-- Source: v_grading_load_index
CREATE VIEW v_grading_load_index AS
SELECT 
    c.course_code,
    c.course_title,
    c.section_id,
    c.instructor_id,
    c.enrollment_count,
    c.modality, -- 'online', 'hybrid', 'in-person'
    -- Assessment structure from Blackboard
    a.total_assessments,
    a.essay_count,
    a.project_count,
    a.exam_count,
    a.rubric_complexity_score, -- average rubric criteria count
    a.auto_graded_count,
    a.manual_graded_count,
    -- Grading Load Index formula
    (
        (a.manual_graded_count * c.enrollment_count * 15) + -- minutes per manual item
        (a.essay_count * c.enrollment_count * 45) + -- essays take longer
        (a.rubric_complexity_score * c.enrollment_count * 5) -- complex rubrics
    ) / 60.0 AS estimated_grading_hours,
    -- Normalized index (0-100, relative to department average)
    (
        (
            (a.manual_graded_count * c.enrollment_count * 15) +
            (a.essay_count * c.enrollment_count * 45) +
            (a.rubric_complexity_score * c.enrollment_count * 5)
        ) / 60.0
    ) / dept.avg_grading_hours * 100 AS grading_load_index,
    c.ta_hours_assigned,
    c.grader_hours_assigned
FROM courses c
LEFT JOIN assessment_structure a ON c.section_id = a.section_id
CROSS JOIN LATERAL (
    SELECT AVG(
        (a2.manual_graded_count * c2.enrollment_count * 15 +
         a2.essay_count * c2.enrollment_count * 45 +
         a2.rubric_complexity_score * c2.enrollment_count * 5) / 60.0
    ) AS avg_grading_hours
    FROM courses c2
    LEFT JOIN assessment_structure a2 ON c2.section_id = a2.section_id
    WHERE c2.department_id = c.department_id
) dept;
```

**Dashboard Components:**
1. **Load Index Rankings** — Courses sorted by Grading Load Index (highest first), with enrollment and assigned support hours
2. **Support Allocation Gap** — Courses where `estimated_grading_hours > assigned_hours` (red flag)
3. **Department Comparison** — Average load index by department, modality breakdown
4. **Workload Heat Map** — Semester calendar view: color intensity = grading load per week
5. **Scenario Planner** — "What if enrollment increases by 20%?" → recalculates estimated hours

**Evidence Drill-Down:**
- Click any load index → shows: formula breakdown, assessment counts, rubric complexity scores, enrollment, comparison to department average, evidence trace ID
- Click "Request Support" → routes to dean approval workflow with auditable justification

**API Endpoint:** `GET /v1/reports/grading-load?dept={id}&semester={term}`

---

### UC-06: Allied Health Programmatic Dashboard

**Purpose:** One governed view replacing 10 disconnected coordinator spreadsheets

**Primary Users:** Allied health department chairs, program coordinators, NCLEX compliance officers

**Data Model:**
```sql
-- Source: v_allied_health_program_status
CREATE VIEW v_allied_health_program_status AS
SELECT 
    p.program_id,
    p.program_name,
    p.accreditor, -- 'ACEN', 'CCNE', 'CAPTE', etc.
    p.cip_code,
    -- Licensure exam tracking
    e.exam_type, -- 'NCLEX-RN', 'NCLEX-PN', 'PTA', 'OTA', etc.
    e.cohort_year,
    e.cohort_size,
    e.pass_count,
    e.fail_count,
    (e.pass_count::float / NULLIF(e.cohort_size, 0)) * 100 AS pass_rate,
    -- Threshold comparison
    t.required_pass_rate,
    t.threshold_type, -- 'minimum', 'target', 'exemplary'
    CASE 
        WHEN (e.pass_count::float / NULLIF(e.cohort_size, 0)) < t.required_pass_rate - 0.05 THEN 'CRITICAL'
        WHEN (e.pass_count::float / NULLIF(e.cohort_size, 0)) < t.required_pass_rate THEN 'WARNING'
        ELSE 'SATISFACTORY'
    END AS threshold_status,
    -- Outcome metrics
    o.employment_rate_6mo,
    o.employment_rate_12mo,
    o.student_satisfaction_score,
    -- Accreditation status
    a.last_site_visit_date,
    a.next_site_visit_date,
    a.findings_count,
    a.findings_resolved_count
FROM allied_health_programs p
LEFT JOIN licensure_exam_results e ON p.program_id = e.program_id
LEFT JOIN program_thresholds t ON p.program_id = t.program_id AND e.exam_type = t.exam_type
LEFT JOIN program_outcomes o ON p.program_id = o.program_id AND e.cohort_year = o.cohort_year
LEFT JOIN accreditation_status a ON p.program_id = a.program_id;
```

**Dashboard Components:**
1. **Program Cards** — One card per program: name, accreditor, current NCLEX pass rate, threshold status (green/yellow/red), next site visit date
2. **Threshold Alert Panel** — Programs approaching or below threshold, with trend arrows
3. **Cohort Comparison** — Pass rate by cohort year, trend line, benchmark comparison
4. **Outcome Summary** — Employment rates, student satisfaction, program completion rates
5. **Accreditation Tracker** — Site visit dates, findings status, action items
6. **Licensure Lookup** — Degree-plan-to-state-licensure mapping (UC-08 integration)

**Evidence Drill-Down:**
- Click any pass rate → shows: cohort breakdown, individual exam results (pseudonymized), comparison to state/national averages, evidence trace ID
- Click "NCLEX Alert" → shows: specific threshold being approached, historical trend, recommended intervention, evidence from UDM

**API Endpoint:** `GET /v1/reports/allied-health?program={id}&cohort={year}`

---

### UC-08: Regulatory Watchtower Dashboard

**Purpose:** Automated regulatory change detection with human approval

**Primary Users:** Compliance officers, regulatory affairs, institutional research

**Data Model:**
```sql
-- Source: v_regulatory_changes_pending
CREATE VIEW v_regulatory_changes_pending AS
SELECT 
    rc.id,
    rc.source_name, -- 'IPEDS', 'CBM', 'Clery', 'SACSCOC', 'NCSBN'
    rc.change_type, -- 'new_standard', 'amended_standard', 'threshold_change', 'deadline_change'
    rc.affected_standard_id,
    rc.change_summary,
    rc.detected_at,
    rc.detected_by, -- 'firecrawl', 'api_poll', 'manual_entry'
    -- Impact assessment
    i.impact_scope, -- 'all_programs', 'specific_programs', 'reporting_only'
    i.affected_programs,
    i.affected_reports,
    i.urgency, -- 'critical', 'high', 'medium', 'low'
    -- Approval status
    rc.status, -- 'pending_review', 'approved', 'rejected', 'deployed', 'superseded'
    rc.reviewer_id,
    rc.reviewed_at,
    rc.approval_notes,
    rc.deployed_at,
    rc.evidence_record_id
FROM regulatory_changes rc
LEFT JOIN change_impact_assessment i ON rc.id = i.change_id
WHERE rc.status = 'pending_review'
ORDER BY i.urgency DESC, rc.detected_at DESC;
```

**Dashboard Components:**
1. **Alert Inbox** — Pending regulatory changes, sorted by urgency, with source, summary, and impact scope
2. **Change Timeline** — Calendar of upcoming deadlines, effective dates, review milestones
3. **Impact Matrix** — Cross-reference: which standards changed → which programs affected → which reports impacted
4. **Approval Queue** — Changes awaiting review: click to approve, reject, or request more info
5. **Deployed Changes Log** — History of approved changes with deployment date, evidence trace
6. **Monitoring Sources** — Status of each monitored source (last poll, health, change count)

**Evidence Drill-Down:**
- Click any alert → shows: original source text, diff from previous version, impact assessment, affected programs, recommended action, evidence trace ID
- Click "Approve" → triggers update to UDM, policy rules, and affected dashboards; logs approver identity

**API Endpoint:** `GET /v1/reports/regulatory-watchtower?status={pending|approved}&urgency={critical|high|medium|low}`

---

## Monitored Filings

EDU Reporter automates tracking and reporting for 5 critical federal and state filings:

| Filing | Frequency | Data Source | EDU Reporter Output | Status |
|--------|-----------|-------------|---------------------|--------|
| **IPEDS** | Annual, Fall, Spring, Winter | Banner enrollment, finance, completions | Pre-filled submission forms, validation checks, evidence package | Planned |
| **CBM** | Annual, state-dependent | Banner enrollment, budget, outcomes | State-specific report generation, submission tracker | Planned |
| **NSLDS** | Monthly, ad-hoc | Banner enrollment status, roster | Enrollment verification reports, roster submission | Planned |
| **FISAP** | Annual | Banner financial aid, expenditures | Fiscal operations report, audit trail | Planned |
| **Clery** | Annual, ongoing | Campus safety data, incident logs | Crime statistics, geographic compliance, narrative | Planned |

**Monitored Filing Pipeline:**
```
Data Source (Banner) → Normalization → COS+ Audit Tables → Report Templates → 
Pre-filled Forms → Human Review → Evidence Logging → Submission → 
Confirmation Tracking → Evidence Archive
```

**Key Feature:** Every filing is pre-populated from the canonical layer, validated against rules, and backed by an evidence package. No manual data entry from spreadsheets.

---

## Operational Views

### Degree-Plan-to-Licensure Lookup

**Purpose:** Show students and advisors what licensure requirements exist for their degree plan in any destination state.

**Data Flow:**
```
Student CIP (from Banner) → UDM Traversal (CIP → SOC → NAICS → State) → 
Licensure Requirements → Confidence + Risk Ranking → Display
```

**Interface:**
- Student selects: current degree plan (CIP auto-populated), destination state
- System returns: required licenses/certifications, issuing authority, confidence score, risk assessment, reciprocity notes
- **Evidence:** Every lookup is logged with student SYN ID, CIP, state, results, timestamp

**API:** `GET /v1/compliance/licensure/state-lookup?student_cip={cip}&destination_state={state}`

### SAP Monitoring

**Purpose:** Real-time Satisfactory Academic Progress tracking with early warning.

**Data Model:**
```sql
SELECT syn_id, gpa, completion_rate, 
       CASE WHEN gpa >= 2.0 AND completion_rate >= 0.67 THEN 'SATISFACTORY'
            WHEN gpa >= 1.5 AND completion_rate >= 0.5 THEN 'WARNING'
            ELSE 'UNSATISFACTORY' END AS sap_status
FROM v_student_academic_standing;
```

**Dashboard:** SAP status distribution, students on warning/unsatisfactory, appeal queue, evidence tracking.

### Enrollment Verification

**Purpose:** Real-time enrollment status for Title IV compliance, insurance, employment verification.

**Data Flow:** Banner enrollment → Canonical layer → Verification API → Third-party request logging

**Features:**
- One-click enrollment verification letter generation
- NSLDS roster auto-submission
- Third-party verification request tracking with evidence

---

## Evidence Drill-Down: Universal Mechanism

Every number, chart, alert, and decision in EDU Reporter is backed by **traceable evidence**.

### Drill-Down UI Pattern

```
[Dashboard Number] ← click → [Evidence Detail Panel]
    ↓
[Trace ID: req-abc-123]
    ↓
[Source Signals] → [Processing Logic] → [Decision] → [Output]
    ↓
[Evidence Record] → [Signature] → [Timestamp] → [Actor]
```

### Evidence Detail Panel Components

1. **Trace ID** — Unique request identifier that spans all layers
2. **Source Signals** — Raw data from Banner, Blackboard, Concourse, or regulatory sources
3. **Processing Logic** — Algorithm version, formula, rule ID, confidence score
4. **Decision** — Gate 530 decision (allow/deny/escalate), reason, actor
5. **Evidence Record** — Ed25519-signed payload, JCS-canonicalized, SHA-256 hash
6. **Verification** — One-click signature verification, chain integrity check

### Example: "Why is this student flagged as CRITICAL risk?"

```json
{
  "trace_id": "req-abc-123",
  "student_syn_id": "SYN-4819",
  "risk_tier": "CRITICAL",
  "source_signals": {
    "banner": { "gpa": 1.85, "credit_hours_attempted": 12, "credit_hours_completed": 6 },
    "blackboard": { "days_since_login": 12, "assignments_submitted": 3, "assignments_total": 10, "time_on_task_hours": 4.2 }
  },
  "scoring_logic": {
    "algorithm_version": "risk-v2.1",
    "formula": "IF gpa < 2.0 AND days_since_login > 7 THEN CRITICAL",
    "confidence": 0.97
  },
  "gate_530_decision": {
    "action": "allow",
    "reason": "Risk scoring permitted for advisor role",
    "dimension": "operational",
    "confidence": 0.99
  },
  "evidence": {
    "signature": "Ed25519-SHA256-...",
    "public_key": "base64-...",
    "canonical_payload": "{...}",
    "timestamp": "2026-01-15T14:30:00Z"
  }
}
```

---

## EDU Reporter UI Architecture

### Tech Stack (Frontend)
- **React 18** with TypeScript
- **TanStack Query** for server state management
- **TanStack Table** for data grids (intervention queue, evaluation tables)
- **Recharts** for charts and visualizations
- **Tailwind CSS** for styling
- **React Router** for navigation between dashboards

### Component Structure
```
src/
├── App.tsx                          # Router, auth context, role provider
├── contexts/
│   ├── AuthContext.tsx              # SSO, role, permissions
│   ├── RoleLensContext.tsx          # Current role lens (advisor, faculty, etc.)
│   └── EvidenceContext.tsx          # Evidence drill-down panel state
├── components/
│   ├── Layout/                      # Sidebar, header, role switcher
│   ├── Dashboard/                   # Dashboard container, grid layout
│   ├── EvidencePanel/               # Slide-out evidence detail panel
│   ├── Charts/                      # Recharts wrappers (risk trend, heat map, etc.)
│   ├── Tables/                      # TanStack Table wrappers (sortable, filterable)
│   └── Cards/                       # Summary cards, metric cards, alert cards
├── dashboards/
│   ├── PredictivePersistence/       # UC-01
│   ├── TranscriptEvaluation/          # UC-02
│   ├── AccreditationGap/              # UC-03
│   ├── CourseAlignment/               # UC-04
│   ├── GradingLoad/                   # UC-05
│   ├── AlliedHealth/                  # UC-06
│   └── RegulatoryWatchtower/          # UC-08
├── views/
│   ├── MonitoredFilings/              # IPEDS, CBM, NSLDS, FISAP, Clery
│   ├── Operational/                   # Licensure lookup, SAP, enrollment
│   └── Admin/                         # Rule management, audit trail, settings
├── hooks/
│   ├── useApi.ts                      # TanStack Query wrappers for IOS+ API
│   ├── useEvidence.ts                 # Evidence drill-down hook
│   ├── useRoleLens.ts                 # Role-based data filtering
│   └── useExport.ts                   # PDF/CSV export with evidence
└── utils/
    ├── formatters.ts                  # Number, date, currency formatting
    ├── riskColors.ts                  # Color mapping for risk tiers
    └── exportHelpers.ts               # Evidence package generation
```

### API Integration

All frontend requests go through the IOS+ middleware API with:
1. **JWT authentication** in Authorization header
2. **Role context** in X-Role-Lens header
3. **Trace ID** propagation (X-Trace-ID generated client-side, echoed in response)

```typescript
// API client pattern
const apiClient = {
  getDashboard: (dashboard: string, params: Record<string, string>) => 
    fetch(`/v1/reports/${dashboard}?${new URLSearchParams(params)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Role-Lens': currentRole,
        'X-Trace-ID': generateTraceId()
      }
    }),
  
  getEvidence: (traceId: string) =>
    fetch(`/v1/evidence/${traceId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
};
```

---

## Performance & Scale

| Metric | Target | Implementation |
|--------|--------|---------------|
| Dashboard load time | < 2 seconds | Materialized views, caching, pagination |
| Risk score refresh | Every 6 hours | Cron job + incremental update |
| Transcript eval queue | Real-time | Event-driven from upload trigger |
| Accreditation heat map | Daily refresh | Nightly batch + on-demand update |
| Evidence drill-down | < 500ms | Indexed trace_id lookup in COS+ |
| Concurrent users | 500+ | Connection pooling, read replicas, CDN for static assets |
| Export (PDF/CSV) | < 5 seconds | Streaming export with evidence package |

---

## Security & Compliance

| Control | Implementation |
|---------|---------------|
| Data in transit | TLS 1.3 for all API calls |
| Data at rest | AES-256 encryption on COS+ database |
| PII handling | Pseudonymized in all dashboards; de-pseudonymization requires approval |
| Role enforcement | Every API call validated against RBAC; UI adapts to role lens |
| Evidence integrity | Every report generation logs evidence record; tamper-evident via Ed25519 |
| Audit trail | All dashboard interactions logged in WORM-protected audit_events |
| Export security | Evidence packages include full trace chain; no PII in aggregate exports |

---

## Future Enhancements (Post-Phase 5)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Student Self-Service Portal** | Degree-plan-to-licensure, SAP status, enrollment verification | Medium |
| **Natural Language Queries** | "Show me at-risk nursing students in section 401" → Copilot bounded synthesis | Medium |
| **Predictive Modeling** | ML models for attrition prediction beyond rule-based scoring | Low |
| **Mobile App** | Advisor push notifications for critical alerts | Low |
| **External Reporting** | Automated submission to accreditors, state boards, federal agencies | Low |

---

*Document version: v2.0*
*Last updated: 2026-01-21*
*Author: SMEPro Technologies Engineering*
